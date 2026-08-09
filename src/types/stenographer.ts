// stenographer/src/types/stenographer.ts
//
// Shared shapes across engines. Every engine normalizes into these types so
// the note-writer never learns which provider produced the transcript.

/** Which transcription backend produced a result. */
export type EngineId = 'supadata' | 'assemblyai';

/**
 * Supadata's transcript acquisition mode.
 * - `native`   — only return a transcript the platform already has (fast, cheap)
 * - `generate` — always run AI transcription (works on caption-less video)
 * - `auto`     — native if present, otherwise generate
 */
export type SupadataMode = 'native' | 'generate' | 'auto';

/**
 * One timed line of transcript. Times are milliseconds from the start of the
 * media — both Supadata (`offset`/`duration`) and AssemblyAI (`start`/`end`)
 * report in ms, so ms is the lossless common denominator. Formatting to
 * `[HH:MM:SS]` happens once, at render time.
 */
export interface TranscriptSegment {
    offsetMs: number;
    durationMs: number;
    text: string;
    /** Diarized speaker label (AssemblyAI "A"/"B"/…). Null when unknown. */
    speaker: string | null;
}

/**
 * A normalized transcript. `segments` may be empty when the engine could only
 * return prose — in that case `plainText` carries it, and the renderer emits an
 * untimed transcript block rather than failing.
 */
export interface TranscriptResult {
    engine: EngineId;
    lang: string | null;
    availableLangs: string[];
    segments: TranscriptSegment[];
    plainText: string | null;
}

/**
 * Provider metadata destined for frontmatter. Every field is nullable: a
 * TikTok post and a raw podcast MP3 populate very different subsets, and a
 * missing field must never block note creation.
 */
export interface SourceMetadata {
    platform: string | null;
    mediaType: string | null;
    id: string | null;
    url: string;
    title: string | null;
    description: string | null;
    authorName: string | null;
    authorUsername: string | null;
    durationSeconds: number | null;
    thumbnailUrl: string | null;
    createdAt: string | null;
    tags: string[];
}

/** What the modal hands to the transcription pipeline. */
export interface TranscribeRequest {
    url: string;
    engine: EngineId;
    /** ISO 639-1 preferred transcript language, or null for provider default. */
    lang: string | null;
    mode: SupadataMode;
    /** Ask AssemblyAI for speaker diarization. Ignored by Supadata. */
    diarize: boolean;
}

/** Errors that carry a stable code so callers can branch without string-matching. */
export class StenographerError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'StenographerError';
    }
}
