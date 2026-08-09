// stenographer/src/services/pipeline.ts
//
// The one path from "a URL" to "a note in the vault". The modal collects
// intent; this module does the work; main.ts wires commands to it. Keeping the
// orchestration here means the modal never touches an API and the services
// never touch the vault.

import { Notice, TFile, normalizePath, type App } from 'obsidian';
import {
    StenographerError,
    type EngineId,
    type SourceMetadata,
    type TranscribeRequest,
    type TranscriptResult,
} from '../types/stenographer';
import type { StenographerSettings } from '../settings/settings';
import { formatFrontmatter } from '../utils/yamlFrontmatter';
import { slugifyTitle, todayPrefix, uniquePath } from '../utils/filename';
import { chooseEngine, detectPlatform, normalizeUrl, sourceUrlFieldName } from '../utils/urls';
import { renderTranscriptBlock } from '../transcript/lfm';
import * as supadata from './supadataService';
import * as assemblyai from './assemblyAiService';

export interface PipelineResult {
    file: TFile;
    metadata: SourceMetadata | null;
    transcript: TranscriptResult;
}

/**
 * Run a transcription request end to end.
 *
 * `activeFile` is whatever note the user triggered from — used only for the
 * optional back-link, and tolerated as null when the command ran with no note
 * open.
 */
export async function runTranscription(
    app: App,
    settings: StenographerSettings,
    request: TranscribeRequest,
    activeFile: TFile | null,
): Promise<PipelineResult> {
    const url = normalizeUrl(request.url);
    if (url === null) {
        throw new StenographerError(`"${request.url}" is not a URL Stenographer can read.`, 'BAD_URL');
    }

    const progress = new Notice('Stenographer: starting…', 0);
    const report = (message: string): void => {
        progress.setMessage(`Stenographer: ${message}`);
    };

    try {
        // Metadata first — it names the file, so a failure here is survivable
        // but the result is a less useful note. Only Supadata provides it.
        let metadata: SourceMetadata | null = null;
        if (settings.supadataApiKey !== '') {
            report('fetching metadata…');
            metadata = await supadata.fetchMetadata(url, settings.supadataApiKey);
        }

        report('requesting transcript…');
        const transcript = await fetchTranscript(settings, request, url, report);

        if (transcript.segments.length === 0 && (transcript.plainText ?? '') === '') {
            throw new StenographerError(
                'The provider returned an empty transcript. The media may have no speech, ' +
                'or captions may be disabled — try mode "generate".',
                'EMPTY_TRANSCRIPT',
            );
        }

        report('writing note…');
        const file = await writeNote(app, settings, url, metadata, transcript);

        if (settings.linkBackFromActiveNote && activeFile !== null && activeFile.path !== file.path) {
            await appendBackLink(app, activeFile, file, url);
        }

        if (settings.openAfterCreate) {
            await app.workspace.getLeaf(false).openFile(file);
        }

        progress.hide();
        const lineCount = transcript.segments.length;
        new Notice(
            `Stenographer: ${file.basename} — ${lineCount > 0 ? `${lineCount} timed segments` : 'untimed transcript'} via ${transcript.engine}.`,
        );

        return { file, metadata, transcript };
    } catch (error) {
        progress.hide();
        throw error;
    }
}

/** Resolve the engine and delegate. */
async function fetchTranscript(
    settings: StenographerSettings,
    request: TranscribeRequest,
    url: string,
    report: (message: string) => void,
): Promise<TranscriptResult> {
    const timeoutMs = settings.jobTimeoutSeconds * 1000;

    if (request.engine === 'assemblyai') {
        // Guard the one routing mistake that produces a confusing provider
        // error rather than an actionable one.
        if (detectPlatform(url) !== null) {
            throw new StenographerError(
                'AssemblyAI cannot ingest a YouTube or social media page — it needs a direct ' +
                'audio file URL. Use Supadata for this link.',
                'ENGINE_MISMATCH',
            );
        }
        return assemblyai.transcribe(url, settings.assemblyAiApiKey, {
            diarize: request.diarize,
            lang: request.lang,
            timeoutMs,
            onProgress: report,
        });
    }

    return supadata.fetchTranscript(url, settings.supadataApiKey, {
        lang: request.lang,
        mode: request.mode,
        timeoutMs,
        onProgress: report,
    });
}

/** Build frontmatter + LFM body and create the note. */
async function writeNote(
    app: App,
    settings: StenographerSettings,
    url: string,
    metadata: SourceMetadata | null,
    transcript: TranscriptResult,
): Promise<TFile> {
    const s = settings;
    const frontmatter: Record<string, unknown> = {};

    frontmatter[s.titleFieldName] = metadata?.title ?? 'Untitled transcript';

    // `youtube_url` / `apple_podcasts_url` / … when the host is recognized and
    // the setting is on; the configurable generic key otherwise. One key, not
    // both — a note carrying the same URL twice invites them to drift apart.
    const platformField = s.platformSpecificUrlField ? sourceUrlFieldName(url) : null;
    frontmatter[platformField ?? s.sourceFieldName] = url;
    if (metadata?.authorName != null) frontmatter[s.channelFieldName] = metadata.authorName;
    if (metadata?.createdAt != null) frontmatter[s.publishedFieldName] = metadata.createdAt.slice(0, 10);
    if (metadata?.durationSeconds != null) frontmatter[s.durationFieldName] = Math.round(metadata.durationSeconds);
    if (metadata?.thumbnailUrl != null) frontmatter[s.thumbnailFieldName] = metadata.thumbnailUrl;
    if (metadata?.platform != null) frontmatter.platform = metadata.platform;
    if (s.includeProviderTags && metadata?.tags.length) frontmatter.tags = metadata.tags;
    if (transcript.lang != null) frontmatter.language = transcript.lang;
    frontmatter[s.engineFieldName] = transcript.engine;
    frontmatter[s.transcribedDateFieldName] = new Date().toISOString();

    const body = renderTranscriptBlock(transcript, {
        targetChars: s.lineTargetChars,
        includeSpeakers: s.includeSpeakers,
    });

    const description = s.includeDescription ? (metadata?.description ?? null) : null;
    const sections = [
        `---\n${formatFrontmatter(frontmatter)}\n---`,
        `# ${metadata?.title ?? 'Untitled transcript'}`,
        description !== null ? `> ${description.replace(/\r?\n/g, ' ')}` : null,
        `[Watch or listen at the source](${url})`,
        body,
    ].filter((section): section is string => section !== null);

    const stem = slugifyTitle(metadata?.title ?? null, `Transcript ${Date.now()}`);
    const basename = s.datePrefixFilenames ? `${todayPrefix()} ${stem}` : stem;

    await ensureFolder(app, s.transcriptFolder);
    const path = uniquePath(app.vault, s.transcriptFolder, basename);

    return app.vault.create(path, `${sections.join('\n\n')}\n`);
}

/**
 * Create the target folder, and any missing parents, if they do not exist.
 *
 * Existence is checked twice, deliberately. `getAbstractFileByPath` consults
 * Obsidian's index, which does NOT reliably include symlinked directories —
 * and symlinked folders are common in vaults that alias content from a repo.
 * For those, the index says "missing", `createFolder` then hits a directory
 * that really is on disk, and the whole run dies on an EEXIST for a folder the
 * user can plainly see. `adapter.exists` asks the filesystem instead. The
 * catch is the third belt: a race or an unindexed case still shouldn't lose a
 * transcript that has already been paid for.
 */
async function ensureFolder(app: App, folder: string): Promise<void> {
    const normalized = normalizePath(folder).replace(/^\/+|\/+$/g, '');
    if (normalized === '' || normalized === '.') return;

    const segments = normalized.split('/');
    let current = '';
    for (const segment of segments) {
        current = current === '' ? segment : `${current}/${segment}`;

        if (app.vault.getAbstractFileByPath(current) !== null) continue;
        if (await app.vault.adapter.exists(current)) continue;

        try {
            await app.vault.createFolder(current);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!/already exists/i.test(message)) throw error;
        }
    }
}

/**
 * Append the dual reference the spec asks for: the vault-internal wikilink to
 * the transcript AND the external source URL, so the note the user was reading
 * keeps both halves of the provenance.
 */
async function appendBackLink(
    app: App,
    activeFile: TFile,
    transcriptFile: TFile,
    sourceUrl: string,
): Promise<void> {
    const line = `- Transcript: [[${transcriptFile.basename}]] — source: ${sourceUrl}`;
    const existing = await app.vault.read(activeFile);
    if (existing.includes(`[[${transcriptFile.basename}]]`)) return;

    const separator = existing.endsWith('\n') ? '' : '\n';
    await app.vault.modify(activeFile, `${existing}${separator}${line}\n`);
}

/** Resolve which engine a request should use, given settings and URL shape. */
export function resolveEngine(
    settings: StenographerSettings,
    url: string,
): EngineId | null {
    const keys = {
        supadata: settings.supadataApiKey.trim() !== '',
        assemblyai: settings.assemblyAiApiKey.trim() !== '',
    };

    if (settings.defaultEngine === 'supadata') return keys.supadata ? 'supadata' : null;
    if (settings.defaultEngine === 'assemblyai') return keys.assemblyai ? 'assemblyai' : null;

    // 'auto' — the URL-shape rules are the single source of routing truth.
    return chooseEngine(url, keys);
}
