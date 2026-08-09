// stenographer/src/utils/filename.ts
//
// Filename derivation and collision policy for created transcript notes.

import type { Vault } from 'obsidian';

/** Characters Obsidian (and the underlying filesystems) reject in filenames. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

/**
 * Slugify a provider title into a safe filename stem. Falls back to a stable
 * placeholder rather than producing an empty name — a title of only emoji or
 * only punctuation is rare but entirely possible on TikTok and Shorts.
 */
export function slugifyTitle(title: string | null, fallback: string): string {
    const cleaned = (title ?? '')
        .replace(ILLEGAL, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned === '' ? fallback : cleaned.slice(0, 120);
}

/** `YYYY-MM-DD` in local time, matching the vault's own date conventions. */
export function todayPrefix(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Join a folder and basename into a vault-relative `.md` path. */
export function joinVaultPath(folder: string, basename: string): string {
    const normalized = folder.replace(/^\/+|\/+$/g, '');
    return normalized === '' ? `${basename}.md` : `${normalized}/${basename}.md`;
}

/**
 * Resolve collisions by appending ` 2`, ` 3`, … — Obsidian's own convention
 * for duplicate note names. Never overwrites: a transcript can represent
 * minutes of paid API time, and silently clobbering one is unrecoverable.
 */
export function uniquePath(vault: Vault, folder: string, basename: string): string {
    let candidate = joinVaultPath(folder, basename);
    let counter = 2;
    while (vault.getAbstractFileByPath(candidate) !== null) {
        candidate = joinVaultPath(folder, `${basename} ${counter}`);
        counter += 1;
    }
    return candidate;
}
