// stenographer/src/services/assemblyAiService.ts
//
// AssemblyAI is the diarization engine: it is the only backend here that knows
// WHO said what. It requires a direct, publicly reachable media URL — it will
// not ingest a YouTube page — so routing sends it podcast MP3s and raw audio
// links, never platform URLs. See utils/urls.ts::chooseEngine.
//
// Contract verified 2026-08:
//   POST /v2/transcript   { audio_url, speaker_labels }  → { id, status }
//   GET  /v2/transcript/{id}                             → queued|processing|completed|error
// Auth is the raw key in the `authorization` header — NO "Bearer " prefix.
// (The API-reference page shows Bearer; the speech-to-text guide explicitly
// contradicts it and the raw form is what the service accepts.)

import { requestUrl } from 'obsidian';
import {
    StenographerError,
    type TranscriptResult,
    type TranscriptSegment,
} from '../types/stenographer';

const BASE_URL = 'https://api.assemblyai.com/v2';
const POLL_INTERVAL_MS = 3000;

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function headers(apiKey: string): Record<string, string> {
    if (apiKey.trim() === '') {
        throw new StenographerError(
            'No AssemblyAI API key configured. Add one in Stenographer settings.',
            'NO_API_KEY',
        );
    }
    return {
        authorization: apiKey,
        'content-type': 'application/json',
    };
}

function raiseForStatus(status: number, body: unknown): never {
    const detail =
        typeof body === 'object' && body !== null && 'error' in body
            ? asString((body as Record<string, unknown>).error)
            : null;

    if (status === 401) {
        throw new StenographerError(
            'AssemblyAI rejected the API key (401).',
            'AUTH_FAILED',
        );
    }
    throw new StenographerError(
        `AssemblyAI request failed (HTTP ${status}). ${detail ?? ''}`.trim(),
        'HTTP_ERROR',
    );
}

export interface AssemblyAiOptions {
    diarize: boolean;
    lang: string | null;
    timeoutMs: number;
    onProgress?: (message: string) => void;
}

/**
 * Submit a media URL and poll to completion.
 *
 * Utterances are preferred over words: they arrive already grouped by speaker
 * turn, which is exactly the shape an LFM transcript line wants. Falling back
 * to the flat `text` keeps a non-diarized result usable.
 */
export async function transcribe(
    audioUrl: string,
    apiKey: string,
    options: AssemblyAiOptions,
): Promise<TranscriptResult> {
    const body: Record<string, unknown> = { audio_url: audioUrl };
    if (options.diarize) body.speaker_labels = true;
    if (options.lang !== null) body.language_code = options.lang;

    const submission = await requestUrl({
        url: `${BASE_URL}/transcript`,
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify(body),
        throw: false,
    });

    if (submission.status < 200 || submission.status >= 300) {
        raiseForStatus(submission.status, submission.json);
    }

    const submitted = (submission.json ?? {}) as Record<string, unknown>;
    const id = asString(submitted.id);
    if (id === null) {
        throw new StenographerError(
            'AssemblyAI accepted the job but returned no transcript ID.',
            'MALFORMED_RESPONSE',
        );
    }

    return pollJob(id, apiKey, options);
}

async function pollJob(
    id: string,
    apiKey: string,
    options: AssemblyAiOptions,
): Promise<TranscriptResult> {
    const deadline = Date.now() + options.timeoutMs;
    let elapsedSeconds = 0;

    while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        elapsedSeconds += POLL_INTERVAL_MS / 1000;

        const response = await requestUrl({
            url: `${BASE_URL}/transcript/${id}`,
            method: 'GET',
            headers: headers(apiKey),
            throw: false,
        });

        if (response.status < 200 || response.status >= 300) {
            raiseForStatus(response.status, response.json);
        }

        const data = (response.json ?? {}) as Record<string, unknown>;
        const status = asString(data.status);

        if (status === 'completed') return toResult(data);

        if (status === 'error') {
            throw new StenographerError(
                `AssemblyAI transcription failed: ${asString(data.error) ?? 'no reason given'}`,
                'JOB_FAILED',
            );
        }

        options.onProgress?.(`Transcribing… ${Math.round(elapsedSeconds)}s (${status ?? 'pending'})`);
    }

    throw new StenographerError(
        `AssemblyAI job did not finish within ${Math.round(options.timeoutMs / 1000)}s. ` +
        'Raise the timeout in settings for long recordings.',
        'TIMEOUT',
    );
}

function toResult(data: Record<string, unknown>): TranscriptResult {
    const segments = toSegments(data.utterances);
    const text = asString(data.text);

    return {
        engine: 'assemblyai',
        lang: asString(data.language_code),
        availableLangs: [],
        segments,
        plainText: segments.length === 0 ? text : null,
    };
}

function toSegments(utterances: unknown): TranscriptSegment[] {
    if (!Array.isArray(utterances)) return [];
    return utterances.flatMap((raw): TranscriptSegment[] => {
        if (typeof raw !== 'object' || raw === null) return [];
        const utterance = raw as Record<string, unknown>;
        const text = asString(utterance.text);
        if (text === null) return [];

        const start = asNumber(utterance.start) ?? 0;
        const end = asNumber(utterance.end) ?? start;

        return [{
            offsetMs: start,
            durationMs: Math.max(0, end - start),
            text,
            speaker: asString(utterance.speaker),
        }];
    });
}
