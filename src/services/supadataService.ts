// stenographer/src/services/supadataService.ts
//
// Supadata is the platform engine: it ingests a YouTube / TikTok / Instagram /
// X / Facebook URL directly and returns captions or an AI transcript, with no
// audio extraction on our side. That property is the entire reason it is the
// primary engine — AssemblyAI and Deepgram require a direct media URL.
//
// Contract verified against https://docs.supadata.ai/get-transcript (2026-08):
//   GET /v1/metadata?url=…                    → unified metadata
//   GET /v1/transcript?url=…&text=false       → 200 result | 202 { jobId }
//   GET /v1/transcript/{jobId}                → queued|active|completed|failed
// Auth is the `x-api-key` header. Videos over ~20 minutes return 202.

import { requestUrl } from 'obsidian';
import {
    StenographerError,
    type SourceMetadata,
    type SupadataMode,
    type TranscriptResult,
    type TranscriptSegment,
} from '../types/stenographer';

const BASE_URL = 'https://api.supadata.ai/v1';

/** Supadata's own guidance is a 1s poll; jobs expire after an hour. */
const POLL_INTERVAL_MS = 1000;

interface SupadataChunk {
    text?: unknown;
    offset?: unknown;
    duration?: unknown;
    lang?: unknown;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function get(
    path: string,
    params: Record<string, string>,
    apiKey: string,
): Promise<{ status: number; body: unknown }> {
    if (apiKey.trim() === '') {
        throw new StenographerError(
            'No Supadata API key configured. Add one in Stenographer settings.',
            'NO_API_KEY',
        );
    }

    const query = new URLSearchParams(params).toString();
    const url = query === '' ? `${BASE_URL}${path}` : `${BASE_URL}${path}?${query}`;

    // Obsidian's requestUrl rather than fetch — marketplace requirement, and it
    // sidesteps CORS by threading through the Electron main process.
    const response = await requestUrl({
        url,
        method: 'GET',
        headers: { 'x-api-key': apiKey },
        throw: false,
    });

    return { status: response.status, body: response.json };
}

/** Map a non-2xx status onto a coded error with a message worth showing a user. */
function raiseForStatus(status: number, body: unknown, context: string): never {
    const detail =
        typeof body === 'object' && body !== null && 'message' in body
            ? asString((body as Record<string, unknown>).message)
            : null;

    switch (status) {
        case 401:
        case 403:
            throw new StenographerError(
                `Supadata rejected the request (${status}) — check your API key and plan. ${detail ?? ''}`.trim(),
                'AUTH_FAILED',
            );
        case 404:
            throw new StenographerError(
                'Supadata could not find that video — it may be private, region-locked, or deleted.',
                'NOT_FOUND',
            );
        case 206:
            throw new StenographerError(
                'No transcript is available for that video. Try mode "generate" to have one produced.',
                'TRANSCRIPT_UNAVAILABLE',
            );
        case 429:
            throw new StenographerError(
                'Supadata rate limit hit. Wait a moment and retry.',
                'RATE_LIMITED',
            );
        default:
            throw new StenographerError(
                `Supadata ${context} failed (HTTP ${status}). ${detail ?? ''}`.trim(),
                'HTTP_ERROR',
            );
    }
}

/**
 * Unified metadata for any supported platform URL. Returns null on failure
 * rather than throwing: metadata is a nice-to-have for frontmatter, and losing
 * it should never cost the user a transcript they already paid credits for.
 */
export async function fetchMetadata(url: string, apiKey: string): Promise<SourceMetadata | null> {
    try {
        const { status, body } = await get('/metadata', { url }, apiKey);
        if (status < 200 || status >= 300) return null;
        if (typeof body !== 'object' || body === null) return null;

        const data = body as Record<string, unknown>;
        const author = (data.author ?? {}) as Record<string, unknown>;
        const media = (data.media ?? {}) as Record<string, unknown>;

        return {
            platform: asString(data.platform),
            mediaType: asString(data.type),
            id: asString(data.id),
            url: asString(data.url) ?? url,
            title: asString(data.title),
            description: asString(data.description),
            authorName: asString(author.displayName) ?? asString(author.username),
            authorUsername: asString(author.username),
            durationSeconds: asNumber(media.duration),
            thumbnailUrl: asString(media.thumbnailUrl),
            createdAt: asString(data.createdAt),
            tags: asStringArray(data.tags),
        };
    } catch (error) {
        console.error('Stenographer: Supadata metadata fetch failed', error);
        return null;
    }
}

function toSegments(content: unknown): TranscriptSegment[] {
    if (!Array.isArray(content)) return [];
    return content.flatMap((raw): TranscriptSegment[] => {
        if (typeof raw !== 'object' || raw === null) return [];
        const chunk = raw as SupadataChunk;
        const text = asString(chunk.text);
        if (text === null) return [];
        return [{
            offsetMs: asNumber(chunk.offset) ?? 0,
            durationMs: asNumber(chunk.duration) ?? 0,
            text,
            speaker: null, // Supadata does not diarize.
        }];
    });
}

function toResult(body: unknown): TranscriptResult {
    const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const segments = toSegments(data.content);

    return {
        engine: 'supadata',
        lang: asString(data.lang),
        availableLangs: asStringArray(data.availableLangs),
        segments,
        // A completed async job may hand back prose instead of chunks; keep it
        // rather than discarding a transcript we were charged for.
        plainText: segments.length === 0 ? asString(data.content) : null,
    };
}

export interface SupadataTranscriptOptions {
    lang: string | null;
    mode: SupadataMode;
    /** Give up on a pending job after this many ms. */
    timeoutMs: number;
    /** Called with a human-readable status while an async job runs. */
    onProgress?: (message: string) => void;
}

/**
 * Fetch a transcript, transparently handling the sync (200) and async (202)
 * paths. Callers never learn which one happened.
 */
export async function fetchTranscript(
    url: string,
    apiKey: string,
    options: SupadataTranscriptOptions,
): Promise<TranscriptResult> {
    const params: Record<string, string> = {
        url,
        text: 'false', // timestamped chunks — the whole point of an LFM transcript
        mode: options.mode,
    };
    if (options.lang !== null) params.lang = options.lang;

    const { status, body } = await get('/transcript', params, apiKey);

    if (status === 202) {
        const jobId =
            typeof body === 'object' && body !== null
                ? asString((body as Record<string, unknown>).jobId)
                : null;
        if (jobId === null) {
            throw new StenographerError(
                'Supadata accepted the job but returned no job ID.',
                'MALFORMED_RESPONSE',
            );
        }
        return pollJob(jobId, apiKey, options);
    }

    if (status < 200 || status >= 300) raiseForStatus(status, body, 'transcript');

    return toResult(body);
}

async function pollJob(
    jobId: string,
    apiKey: string,
    options: SupadataTranscriptOptions,
): Promise<TranscriptResult> {
    const deadline = Date.now() + options.timeoutMs;
    let elapsedSeconds = 0;

    while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        elapsedSeconds += POLL_INTERVAL_MS / 1000;

        const { status, body } = await get(`/transcript/${jobId}`, {}, apiKey);
        if (status < 200 || status >= 300) raiseForStatus(status, body, 'job polling');

        const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
        const jobStatus = asString(data.status);

        if (jobStatus === 'completed') return toResult(data);

        if (jobStatus === 'failed') {
            throw new StenographerError(
                `Supadata job failed: ${asString(data.error) ?? 'no reason given'}`,
                'JOB_FAILED',
            );
        }

        options.onProgress?.(`Transcribing… ${Math.round(elapsedSeconds)}s (${jobStatus ?? 'pending'})`);
    }

    throw new StenographerError(
        `Supadata job did not finish within ${Math.round(options.timeoutMs / 1000)}s. ` +
        'Raise the timeout in settings for very long recordings.',
        'TIMEOUT',
    );
}
