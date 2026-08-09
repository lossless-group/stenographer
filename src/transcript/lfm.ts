// stenographer/src/transcript/lfm.ts
//
// Renders a normalized TranscriptResult into the Lossless Flavored Markdown
// `:::transcript` container directive.
//
// The LFM invariant from the spec: the block must read correctly as plain
// markdown in any editor AND remain hydratable by an LFM-aware renderer. That
// rules out HTML wrappers and any syntax that only makes sense post-hydration.

import type { TranscriptResult, TranscriptSegment } from '../types/stenographer';

/** `[HH:MM:SS]`, or `[MM:SS]` under an hour — both trigger LFM timestamp linking. */
export function formatTimestamp(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return hours > 0
        ? `[${pad(hours)}:${pad(minutes)}:${pad(seconds)}]`
        : `[${pad(minutes)}:${pad(seconds)}]`;
}

/**
 * Merge adjacent segments that share a speaker until they reach roughly
 * `targetChars`. Caption tracks arrive as 2-5 word fragments; one line per
 * fragment produces an unreadable wall of timestamps.
 *
 * A speaker change always starts a new line, regardless of length — losing a
 * diarization boundary to save a line break would be a real loss of meaning.
 */
export function groupSegments(
    segments: readonly TranscriptSegment[],
    targetChars: number,
): TranscriptSegment[] {
    const grouped: TranscriptSegment[] = [];

    for (const segment of segments) {
        const text = segment.text.trim();
        if (!text) continue;

        const open = grouped[grouped.length - 1];
        const sameSpeaker = open !== undefined && open.speaker === segment.speaker;
        const hasRoom = open !== undefined && open.text.length + text.length + 1 <= targetChars;

        if (open !== undefined && sameSpeaker && hasRoom) {
            open.text = `${open.text} ${text}`;
            // Extend the window to the end of the segment just absorbed.
            open.durationMs = segment.offsetMs + segment.durationMs - open.offsetMs;
            continue;
        }

        grouped.push({
            offsetMs: segment.offsetMs,
            durationMs: segment.durationMs,
            text,
            speaker: segment.speaker,
        });
    }

    return grouped;
}

export interface RenderOptions {
    /** Approximate characters per rendered line before wrapping to a new one. */
    targetChars: number;
    /** Emit `**Speaker**:` prefixes when the engine returned diarization. */
    includeSpeakers: boolean;
}

/**
 * Produce the full `:::transcript` block. Always returns a well-formed block,
 * even for an empty transcript — a note with an empty transcript block is
 * debuggable; a note with a half-open directive corrupts every renderer
 * downstream of it.
 */
export function renderTranscriptBlock(
    result: TranscriptResult,
    options: RenderOptions,
): string {
    const lines: string[] = [':::transcript'];

    if (result.segments.length > 0) {
        for (const segment of groupSegments(result.segments, options.targetChars)) {
            const stamp = formatTimestamp(segment.offsetMs);
            const speaker =
                options.includeSpeakers && segment.speaker !== null
                    ? ` **${segment.speaker}**:`
                    : '';
            lines.push(`${stamp}${speaker} ${segment.text}`);
            lines.push('');
        }
        // Drop the trailing blank so the closing fence sits tight against text.
        if (lines[lines.length - 1] === '') lines.pop();
    } else if (result.plainText !== null && result.plainText.trim() !== '') {
        // No timing available — still a valid transcript, just untimed.
        lines.push(result.plainText.trim());
    }

    lines.push(':::');
    return lines.join('\n');
}
