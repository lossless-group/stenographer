// stenographer/src/utils/yamlFrontmatter.ts
//
// Regex-only frontmatter formatting — no YAML dependency, matching the house
// pattern established in Metafetch. Stenographer only ever WRITES frontmatter
// for notes it creates, so the reader half of Metafetch's utility is omitted.

/**
 * Formats a frontmatter object as YAML with consistent quoting.
 *
 * Strings are unconditionally double-quoted: titles routinely contain `:`,
 * `#`, and quotes, and video descriptions contain nearly everything, so
 * enumerating the YAML-unsafe cases is more fragile than always quoting.
 * Multi-line strings are folded to single-line — a description with newlines
 * would otherwise produce invalid YAML.
 */
export function formatFrontmatter(frontmatter: Record<string, unknown>): string {
    return Object.entries(frontmatter)
        .map(([key, value]) => formatEntry(key, value))
        .join('\n');
}

function formatEntry(key: string, value: unknown): string {
    if (value === null || value === undefined) return `${key}: null`;
    if (value === true) return `${key}: true`;
    if (value === false) return `${key}: false`;
    if (typeof value === 'number') return `${key}: ${value}`;

    if (Array.isArray(value)) {
        if (value.length === 0) return `${key}: []`;
        const items = value
            .map(item => `  - "${escapeScalar(String(item))}"`)
            .join('\n');
        return `${key}:\n${items}`;
    }

    if (typeof value === 'object') {
        // One level of nesting is enough for the `intelligence:` style blocks
        // the spec calls for; deeper structures are flattened to a scalar.
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) return `${key}: {}`;
        const nested = entries
            .map(([k, v]) => `  ${formatEntry(k, v).split('\n').join('\n  ')}`)
            .join('\n');
        return `${key}:\n${nested}`;
    }

    return `${key}: "${escapeScalar(String(value))}"`;
}

function escapeScalar(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, ' ')
        .trim();
}
