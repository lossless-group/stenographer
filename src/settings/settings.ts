// stenographer/src/settings/settings.ts

import type { EngineId, SupadataMode } from '../types/stenographer';

export interface StenographerSettings {
    // --- Providers ---
    supadataApiKey: string;
    assemblyAiApiKey: string;

    /** 'auto' routes by URL shape; an explicit engine forces one backend. */
    defaultEngine: 'auto' | EngineId;
    defaultMode: SupadataMode;
    /** ISO 639-1 code, or '' for the provider's default language. */
    defaultLang: string;
    diarize: boolean;
    jobTimeoutSeconds: number;

    // --- Note creation ---
    transcriptFolder: string;
    datePrefixFilenames: boolean;
    openAfterCreate: boolean;
    /** Write a backlink + source URL into the note that was active on trigger. */
    linkBackFromActiveNote: boolean;

    // --- Transcript rendering ---
    lineTargetChars: number;
    includeSpeakers: boolean;

    // --- Frontmatter field names ---
    /**
     * Write the source URL under a platform-specific key (`youtube_url`,
     * `apple_podcasts_url`, …) instead of the generic source field.
     */
    platformSpecificUrlField: boolean;
    /**
     * Write the provider's own tags into frontmatter. Off by default —
     * provider tags are SEO keywords chosen by the uploader, not vocabulary
     * from your vault, and they pollute a tag namespace you curate by hand.
     */
    includeProviderTags: boolean;
    /** Write the provider's description as a blockquote under the title. */
    includeDescription: boolean;
    titleFieldName: string;
    sourceFieldName: string;
    channelFieldName: string;
    publishedFieldName: string;
    durationFieldName: string;
    thumbnailFieldName: string;
    transcribedDateFieldName: string;
    engineFieldName: string;
}

export const DEFAULT_SETTINGS: StenographerSettings = {
    supadataApiKey: '',
    assemblyAiApiKey: '',

    defaultEngine: 'auto',
    defaultMode: 'auto',
    defaultLang: '',
    diarize: true,
    jobTimeoutSeconds: 600,

    transcriptFolder: 'Transcripts',
    datePrefixFilenames: false,
    openAfterCreate: true,
    linkBackFromActiveNote: true,

    lineTargetChars: 220,
    includeSpeakers: true,

    platformSpecificUrlField: true,
    includeProviderTags: false,
    includeDescription: true,
    titleFieldName: 'title',
    sourceFieldName: 'source',
    channelFieldName: 'channel',
    publishedFieldName: 'date_published',
    durationFieldName: 'duration_seconds',
    thumbnailFieldName: 'thumbnail',
    transcribedDateFieldName: 'date_transcribed',
    engineFieldName: 'transcript_engine',
};
