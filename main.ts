import { Editor, Notice, Plugin } from 'obsidian';
import { StenographerModal } from './src/modals/StenographerModal';
import { StenographerSettingTab } from './src/settings/settings-tab';
import { DEFAULT_SETTINGS, type StenographerSettings } from './src/settings/settings';
import { firstUrlIn } from './src/utils/urls';

export default class StenographerPlugin extends Plugin {
    // Obsidian 1.13.0 added `settings?: unknown` to the Plugin base class and
    // asks subclasses to narrow it with `declare` rather than redeclare it.
    // Assigned in loadSettings(), which onload() awaits before anything reads it.
    declare settings: StenographerSettings;

    async onload(): Promise<void> {
        await this.loadSettings();

        const ribbonIconEl = this.addRibbonIcon(
            'captions',
            'Generate transcript from URL',
            () => { this.openModal(null); },
        );
        ribbonIconEl.addClass('stenographer-ribbon-icon');

        this.addSettingTab(new StenographerSettingTab(this.app, this));
        this.registerCommands();
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    private registerCommands(): void {
        // Open empty — the paste-a-link case.
        this.addCommand({
            id: 'transcribe-link',
            name: 'Generate transcript from URL',
            callback: () => { this.openModal(null); },
        });

        // Open prefilled from the editor. Prefers the selection, falls back to
        // the current line, so "cursor sitting in a link" works without the
        // user having to select it precisely.
        this.addCommand({
            id: 'transcribe-link-in-note',
            name: 'Generate transcript from the URL under the cursor',
            editorCallback: (editor: Editor) => {
                const selection = editor.getSelection();
                const haystack = selection !== '' ? selection : editor.getLine(editor.getCursor().line);
                const url = firstUrlIn(haystack);

                if (url === null) {
                    new Notice('Stenographer: no link found in the selection or current line.');
                    return;
                }
                this.openModal(url);
            },
        });
    }

    private openModal(prefillUrl: string | null): void {
        new StenographerModal(
            this.app,
            this,
            prefillUrl,
            this.app.workspace.getActiveFile(),
        ).open();
    }

    async onunload(): Promise<void> {
        // Nothing persistent to tear down — every job is awaited inside its
        // own command invocation.
    }
}
