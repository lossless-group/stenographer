// stenographer/src/utils/urls.ts
//
// URL classification. This is the whole basis of engine routing, so it lives
// apart from the services and stays free of Obsidian imports.

import type { EngineId } from '../types/stenographer';

/** Hosts Supadata ingests natively, by platform. */
const PLATFORM_HOSTS: ReadonlyArray<readonly [platform: string, patterns: readonly string[]]> = [
    ['youtube', ['youtube.com', 'youtu.be', 'youtube-nocookie.com']],
    ['tiktok', ['tiktok.com']],
    ['instagram', ['instagram.com']],
    ['twitter', ['twitter.com', 'x.com']],
    ['facebook', ['facebook.com', 'fb.watch']],
];

/**
 * Slugs used to name the platform-specific frontmatter URL field
 * (`youtube_url`, `apple_podcasts_url`, …).
 *
 * Deliberately SEPARATE from PLATFORM_HOSTS above. That list drives engine
 * routing and must contain only what Supadata can actually ingest; this list
 * is about naming a field and can safely recognize hosts we cannot transcribe
 * directly (Apple Podcasts, Spotify) so the note still records where the
 * episode came from. Conflating the two would route an Apple Podcasts link to
 * an engine that will reject it.
 */
const SOURCE_LABELS: ReadonlyArray<readonly [slug: string, patterns: readonly string[]]> = [
    ['youtube', ['youtube.com', 'youtu.be', 'youtube-nocookie.com']],
    ['apple_podcasts', ['podcasts.apple.com', 'itunes.apple.com']],
    ['spotify', ['spotify.com']],
    ['soundcloud', ['soundcloud.com']],
    ['vimeo', ['vimeo.com']],
    ['tiktok', ['tiktok.com']],
    ['instagram', ['instagram.com']],
    ['twitter', ['twitter.com', 'x.com']],
    ['facebook', ['facebook.com', 'fb.watch']],
    ['overcast', ['overcast.fm']],
    ['pocket_casts', ['pca.st', 'pocketcasts.com']],
    ['substack', ['substack.com']],
    ['descript', ['share.descript.com', 'descript.com']],
    ['zoom', ['zoom.us']],
];

/** Extensions that indicate a URL points straight at a media file. */
const MEDIA_EXTENSIONS = [
    '.mp3', '.m4a', '.mp4', '.wav', '.flac', '.ogg', '.opus',
    '.aac', '.webm', '.mov', '.mkv', '.m4v', '.wma',
] as const;

/** Parse loosely — bare `youtube.com/watch?v=…` should still classify. */
function parse(raw: string): URL | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
        return null;
    }
}

export function isProbablyUrl(raw: string): boolean {
    return parse(raw) !== null;
}

/** Normalize to an absolute https URL, or null when unparseable. */
export function normalizeUrl(raw: string): string | null {
    return parse(raw)?.toString() ?? null;
}

/**
 * The platform Supadata would recognize, or null for anything else
 * (including direct media files, which are not "platform" URLs).
 */
export function detectPlatform(raw: string): string | null {
    const url = parse(raw);
    if (!url) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const [platform, patterns] of PLATFORM_HOSTS) {
        if (patterns.some(p => host === p || host.endsWith(`.${p}`))) return platform;
    }
    return null;
}

/**
 * The frontmatter key this URL should be written under — `youtube_url`,
 * `apple_podcasts_url`, and so on. Returns null for hosts we don't recognize,
 * so the caller can fall back to the configurable generic field rather than
 * inventing a key out of some CDN's hostname.
 */
export function sourceUrlFieldName(raw: string): string | null {
    const url = parse(raw);
    if (!url) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const [slug, patterns] of SOURCE_LABELS) {
        if (patterns.some(p => host === p || host.endsWith(`.${p}`))) return `${slug}_url`;
    }
    return null;
}

/** True when the URL path ends in a recognized audio/video extension. */
export function isDirectMediaUrl(raw: string): boolean {
    const url = parse(raw);
    if (!url) return false;
    const path = url.pathname.toLowerCase();
    return MEDIA_EXTENSIONS.some(ext => path.endsWith(ext));
}

/**
 * Pick the engine for a URL.
 *
 * Platform URLs (YouTube et al.) can ONLY go to Supadata — AssemblyAI and
 * Deepgram require a direct media URL, and extracting one from YouTube is
 * exactly the server-side work this plugin deliberately does not do.
 *
 * Direct media URLs prefer AssemblyAI when a key is present, because it is the
 * only engine here that does speaker diarization; Supadata's `generate` mode
 * is the fallback when there is no AssemblyAI key.
 */
export function chooseEngine(
    raw: string,
    keys: { supadata: boolean; assemblyai: boolean },
): EngineId | null {
    if (detectPlatform(raw) !== null) return keys.supadata ? 'supadata' : null;
    if (isDirectMediaUrl(raw)) {
        if (keys.assemblyai) return 'assemblyai';
        if (keys.supadata) return 'supadata';
        return null;
    }
    // Unknown shape — Supadata still accepts arbitrary public file URLs in
    // `generate` mode, so let it try rather than refusing outright.
    if (keys.supadata) return 'supadata';
    if (keys.assemblyai) return 'assemblyai';
    return null;
}

/** Extract the first http(s) URL from a blob of markdown/selection text. */
export function firstUrlIn(text: string): string | null {
    // Handles bare URLs, markdown links, and angle-bracket autolinks by simply
    // grabbing the first http(s) run and trimming trailing markdown punctuation.
    const match = /https?:\/\/[^\s<>()\[\]"']+/i.exec(text);
    if (!match) return null;
    return match[0].replace(/[.,;:!?]+$/, '');
}
