// stenographer/src/settings/settings-tab.ts

import { App, PluginSettingTab, Setting } from 'obsidian';
import type StenographerPlugin from '../../main';
import type { StenographerSettings } from './settings';

export class StenographerSettingTab extends PluginSettingTab {
    plugin: StenographerPlugin;

    constructor(app: App, plugin: StenographerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Collapsible <details> section, mirroring Metafetch's settings panel.
     * Built with document.createElement because Obsidian's typed createEl
     * overloads for 'details'/'summary' reject cls/attr options under
     * exactOptionalPropertyTypes.
     */
    private createSection(title: string, opts: { open?: boolean } = {}): HTMLElement {
        const details = document.createElement('details');
        details.className = 'stenographer-settings-section';
        if (opts.open !== false) details.setAttribute('open', '');

        const summary = document.createElement('summary');
        summary.textContent = title;
        summary.className = 'stenographer-settings-summary';
        details.appendChild(summary);

        this.containerEl.appendChild(details);
        return details;
    }

    private note(parent: HTMLElement, text: string): void {
        const el = parent.createEl('p', { text });
        el.addClass('setting-item-description');
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Stenographer Settings' });

        // ============================================================
        // Provider: Supadata (platform URLs)
        // ============================================================
        const supadata = this.createSection('Provider: Supadata — YouTube & social');
        this.note(
            supadata,
            'Ingests a YouTube, TikTok, Instagram, X, or Facebook URL directly and returns ' +
            'captions or an AI transcript. This is the only engine that accepts a platform ' +
            'page URL, so it handles every YouTube link.',
        );

        new Setting(supadata)
            .setName('Supadata API key')
            .setDesc('Sent as the x-api-key header. Get one at https://supadata.ai/')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.supadataApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.supadataApiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(supadata)
            .setName('Transcript mode')
            .setDesc(
                'native = only use captions the platform already has (fastest, cheapest). ' +
                'generate = always run AI transcription. auto = native, falling back to generate.',
            )
            .addDropdown(dropdown => dropdown
                .addOption('auto', 'auto')
                .addOption('native', 'native')
                .addOption('generate', 'generate')
                .setValue(this.plugin.settings.defaultMode)
                .onChange(async (value) => {
                    this.plugin.settings.defaultMode = value as StenographerSettings['defaultMode'];
                    await this.plugin.saveSettings();
                }));

        // ============================================================
        // Provider: AssemblyAI (direct media URLs)
        // ============================================================
        const assembly = this.createSection('Provider: AssemblyAI — podcasts & raw audio');
        this.note(
            assembly,
            'The only engine here that identifies speakers. It needs a direct, publicly ' +
            'reachable media URL (an .mp3, .m4a, .wav …) — it cannot ingest a YouTube page. ' +
            'Optional: leave the key empty and Supadata handles everything.',
        );

        new Setting(assembly)
            .setName('AssemblyAI API key')
            .setDesc('Sent raw in the authorization header (no Bearer prefix).')
            .addText(text => text
                .setPlaceholder('Optional — enables speaker diarization')
                .setValue(this.plugin.settings.assemblyAiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.assemblyAiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(assembly)
            .setName('Identify speakers')
            .setDesc('Request speaker diarization, and render "**A**:" style labels in the transcript.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.diarize)
                .onChange(async (value) => {
                    this.plugin.settings.diarize = value;
                    await this.plugin.saveSettings();
                }));

        // ============================================================
        // Routing
        // ============================================================
        const routing = this.createSection('Routing');

        new Setting(routing)
            .setName('Default engine')
            .setDesc(
                'auto sends platform URLs to Supadata and direct media files to AssemblyAI ' +
                'when its key is set. Forcing an engine overrides that.',
            )
            .addDropdown(dropdown => dropdown
                .addOption('auto', 'auto (recommended)')
                .addOption('supadata', 'always Supadata')
                .addOption('assemblyai', 'always AssemblyAI')
                .setValue(this.plugin.settings.defaultEngine)
                .onChange(async (value) => {
                    this.plugin.settings.defaultEngine = value as StenographerSettings['defaultEngine'];
                    await this.plugin.saveSettings();
                }));

        new Setting(routing)
            .setName('Preferred language')
            .setDesc('ISO 639-1 code, e.g. "en" or "es". Leave empty for the provider default.')
            .addText(text => text
                .setPlaceholder('en')
                .setValue(this.plugin.settings.defaultLang)
                .onChange(async (value) => {
                    this.plugin.settings.defaultLang = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(routing)
            .setName('Job timeout (seconds)')
            .setDesc('How long to wait for a long recording before giving up. Multi-hour podcasts need more.')
            .addSlider(slider => slider
                .setLimits(60, 3600, 60)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.jobTimeoutSeconds)
                .onChange(async (value: number) => {
                    this.plugin.settings.jobTimeoutSeconds = value;
                    await this.plugin.saveSettings();
                }));

        // ============================================================
        // Note creation
        // ============================================================
        const notes = this.createSection('Note creation');

        new Setting(notes)
            .setName('Transcript folder')
            .setDesc('Vault-relative folder for created notes. Created if missing.')
            .addText(text => text
                .setPlaceholder('Transcripts')
                .setValue(this.plugin.settings.transcriptFolder)
                .onChange(async (value) => {
                    this.plugin.settings.transcriptFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(notes)
            .setName('Prefix filenames with the date')
            .setDesc('Produces "2026-08-08 Video Title.md" instead of "Video Title.md".')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.datePrefixFilenames)
                .onChange(async (value) => {
                    this.plugin.settings.datePrefixFilenames = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(notes)
            .setName('Open the note when it is ready')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openAfterCreate)
                .onChange(async (value) => {
                    this.plugin.settings.openAfterCreate = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(notes)
            .setName('Link back from the note you were in')
            .setDesc(
                'Writes a line into the originally-active note carrying BOTH the wikilink to ' +
                'the new transcript and the original source URL, so neither reference is lost.',
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.linkBackFromActiveNote)
                .onChange(async (value) => {
                    this.plugin.settings.linkBackFromActiveNote = value;
                    await this.plugin.saveSettings();
                }));

        // ============================================================
        // Transcript rendering
        // ============================================================
        const rendering = this.createSection('Transcript rendering', { open: false });
        this.note(
            rendering,
            'Transcripts are written as an LFM ":::transcript" block with [HH:MM:SS] ' +
            'timestamps, so Astro-Knots sites can hydrate them into an interactive player ' +
            'while the note stays readable as plain markdown.',
        );

        new Setting(rendering)
            .setName('Characters per line')
            .setDesc(
                'Caption tracks arrive as 2-5 word fragments. Adjacent fragments are merged up ' +
                'to this length before a new timestamped line starts. A speaker change always ' +
                'starts a new line regardless.',
            )
            .addSlider(slider => slider
                .setLimits(80, 600, 20)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.lineTargetChars)
                .onChange(async (value: number) => {
                    this.plugin.settings.lineTargetChars = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(rendering)
            .setName('Show speaker labels')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeSpeakers)
                .onChange(async (value) => {
                    this.plugin.settings.includeSpeakers = value;
                    await this.plugin.saveSettings();
                }));

        // ============================================================
        // Frontmatter field names
        // ============================================================
        const fields = this.createSection('Frontmatter field names', { open: false });
        this.note(fields, 'Keys written into the created note. Defaults follow the spec schema.');

        new Setting(fields)
            .setName('Write the provider\'s tags')
            .setDesc(
                'Off by default. Provider tags are SEO keywords chosen by the uploader, not ' +
                'vocabulary from your vault — turning this on will mix them into a tag namespace ' +
                'you curate by hand.',
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeProviderTags)
                .onChange(async (value) => {
                    this.plugin.settings.includeProviderTags = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(fields)
            .setName('Include the provider\'s description')
            .setDesc(
                'Adds the video or episode description as a blockquote under the title. ' +
                'On YouTube this is often a wall of sponsor links and timestamps.',
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeDescription)
                .onChange(async (value) => {
                    this.plugin.settings.includeDescription = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(fields)
            .setName('Platform-specific URL field')
            .setDesc(
                'Write the source URL as youtube_url, apple_podcasts_url, soundcloud_url, and so ' +
                'on, based on the link. Unrecognized hosts fall back to the generic Source field ' +
                'below. Turn this off to always use the generic field.',
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.platformSpecificUrlField)
                .onChange(async (value) => {
                    this.plugin.settings.platformSpecificUrlField = value;
                    await this.plugin.saveSettings();
                }));

        const rows: Array<[label: string, desc: string, key: keyof StenographerSettings, placeholder: string]> = [
            ['Title', 'Video or episode title', 'titleFieldName', 'title'],
            ['Source', 'Fallback URL key, used when the host is unrecognized or the toggle above is off', 'sourceFieldName', 'source'],
            ['Channel', 'Channel, host, or uploader', 'channelFieldName', 'channel'],
            ['Published', 'Original publication date', 'publishedFieldName', 'date_published'],
            ['Duration', 'Runtime in seconds', 'durationFieldName', 'duration_seconds'],
            ['Thumbnail', 'Poster image URL', 'thumbnailFieldName', 'thumbnail'],
            ['Transcribed', 'When Stenographer produced the transcript', 'transcribedDateFieldName', 'date_transcribed'],
            ['Engine', 'Which backend produced it', 'engineFieldName', 'transcript_engine'],
        ];

        for (const [label, desc, key, placeholder] of rows) {
            new Setting(fields)
                .setName(`${label} field`)
                .setDesc(desc)
                .addText(text => text
                    .setPlaceholder(placeholder)
                    .setValue(this.plugin.settings[key] as string)
                    .onChange(async (value) => {
                        // Never persist an empty key — fall back to the default.
                        (this.plugin.settings[key] as string) = value.trim() || placeholder;
                        await this.plugin.saveSettings();
                    }));
        }

        // ============================================================
        // Status
        // ============================================================
        const hasAny =
            this.plugin.settings.supadataApiKey !== '' ||
            this.plugin.settings.assemblyAiApiKey !== '';
        const status = containerEl.createEl('div', {
            text: hasAny
                ? 'At least one provider key is configured.'
                : 'No provider keys configured — Stenographer cannot transcribe anything yet. ' +
                  'A Supadata key is the one to add first; it covers YouTube.',
        });
        status.addClass('setting-item-description');
        if (!hasAny) status.addClass('stenographer-settings-warning');
    }
}
