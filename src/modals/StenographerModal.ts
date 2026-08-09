// stenographer/src/modals/StenographerModal.ts

import { Modal, Notice, Setting, type App, type TFile } from 'obsidian';
import type StenographerPlugin from '../../main';
import type { EngineId, SupadataMode, TranscribeRequest } from '../types/stenographer';
import { detectPlatform, isProbablyUrl } from '../utils/urls';
import { resolveEngine, runTranscription } from '../services/pipeline';

/**
 * The single entry surface. Both commands open this — one with an empty URL,
 * one prefilled from the editor — so there is exactly one place where a
 * transcription is configured.
 */
export class StenographerModal extends Modal {
    private readonly plugin: StenographerPlugin;
    private readonly activeFile: TFile | null;

    private url: string;
    private engine: 'auto' | EngineId;
    private mode: SupadataMode;
    private lang: string;

    private routingEl: HTMLElement | null = null;

    constructor(app: App, plugin: StenographerPlugin, prefillUrl: string | null, activeFile: TFile | null) {
        super(app);
        this.plugin = plugin;
        this.activeFile = activeFile;
        this.url = prefillUrl ?? '';
        this.engine = plugin.settings.defaultEngine;
        this.mode = plugin.settings.defaultMode;
        this.lang = plugin.settings.defaultLang;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('stenographer-modal');

        contentEl.createEl('h2', { text: 'Transcribe a link' });

        new Setting(contentEl)
            .setName('URL')
            .setDesc('A YouTube, TikTok, Instagram, X, or Facebook link — or a direct audio file URL.')
            .addText(text => {
                text.setPlaceholder('https://www.youtube.com/watch?v=…')
                    .setValue(this.url)
                    .onChange(value => {
                        this.url = value;
                        this.updateRouting();
                    });
                text.inputEl.addClass('stenographer-url-input');
                // Enter submits — the common case is paste-and-go.
                text.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        void this.submit();
                    }
                });
                window.setTimeout(() => { text.inputEl.focus(); text.inputEl.select(); }, 0);
            });

        new Setting(contentEl)
            .setName('Engine')
            .addDropdown(dropdown => dropdown
                .addOption('auto', 'auto — route by link type')
                .addOption('supadata', 'Supadata (platform links)')
                .addOption('assemblyai', 'AssemblyAI (direct audio, speakers)')
                .setValue(this.engine)
                .onChange(value => {
                    this.engine = value as 'auto' | EngineId;
                    this.updateRouting();
                }));

        new Setting(contentEl)
            .setName('Mode')
            .setDesc('Supadata only: reuse existing captions, or generate a fresh transcript.')
            .addDropdown(dropdown => dropdown
                .addOption('auto', 'auto')
                .addOption('native', 'native — existing captions only')
                .addOption('generate', 'generate — always transcribe')
                .setValue(this.mode)
                .onChange(value => { this.mode = value as SupadataMode; }));

        new Setting(contentEl)
            .setName('Language')
            .setDesc('ISO 639-1 code. Empty uses the provider default.')
            .addText(text => text
                .setPlaceholder('en')
                .setValue(this.lang)
                .onChange(value => { this.lang = value.trim(); }));

        this.routingEl = contentEl.createEl('div');
        this.routingEl.addClass('stenographer-routing-note');
        this.updateRouting();

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('Cancel')
                .onClick(() => { this.close(); }))
            .addButton(button => button
                .setButtonText('Transcribe')
                .setCta()
                .onClick(() => { void this.submit(); }));
    }

    /**
     * Tell the user which engine will actually run, before they spend credits.
     * The "AssemblyAI can't take a YouTube link" rule is invisible until it
     * fails, so surface it here rather than in an error toast afterwards.
     */
    private updateRouting(): void {
        if (this.routingEl === null) return;

        if (this.url.trim() === '') {
            this.routingEl.setText('Paste a link to see which engine will handle it.');
            return;
        }
        if (!isProbablyUrl(this.url)) {
            this.routingEl.setText('That does not look like a URL.');
            return;
        }

        const platform = detectPlatform(this.url);

        if (this.engine === 'assemblyai' && platform !== null) {
            this.routingEl.setText(
                `AssemblyAI cannot ingest a ${platform} page — it needs a direct audio file URL. ` +
                'Switch to auto or Supadata.',
            );
            return;
        }

        const settings = { ...this.plugin.settings, defaultEngine: this.engine };
        const resolved = resolveEngine(settings, this.url);

        if (resolved === null) {
            this.routingEl.setText(
                'No API key is configured for an engine that can handle this link. ' +
                'Add a key in Stenographer settings.',
            );
            return;
        }

        const source = platform === null ? 'direct media' : platform;
        this.routingEl.setText(`${source} → ${resolved}`);
    }

    private async submit(): Promise<void> {
        const url = this.url.trim();
        if (url === '') {
            new Notice('Stenographer: enter a URL first.');
            return;
        }

        const settings = { ...this.plugin.settings, defaultEngine: this.engine };
        const engine = resolveEngine(settings, url);
        if (engine === null) {
            new Notice('Stenographer: no usable API key for that link. Check settings.');
            return;
        }

        const request: TranscribeRequest = {
            url,
            engine,
            lang: this.lang === '' ? null : this.lang,
            mode: this.mode,
            diarize: this.plugin.settings.diarize,
        };

        this.close();

        try {
            await runTranscription(this.app, this.plugin.settings, request, this.activeFile);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            new Notice(`Stenographer failed — ${message}`, 10000);
            console.error('Stenographer transcription error:', error);
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
