import { setText, toggleClass } from '../utils/dom';

export interface SettingsAPI {
  onClearSave: () => void;
  onVolumeChange: (v: number) => void;
  onMuteToggle: () => void;
  onTargetingModeChange?: (mode: string) => void;
  initialVolume: number;
  isMuted: boolean;
  currentTargetingMode?: string;
  targetingModes?: Array<{ id: string; label: string }>;
  /** Plan §1.1: auto-resolve the blessing draft so an idle run never stalls. */
  autoPickBlessings?: boolean;
  /** True when automation is running, which forces the setting on. */
  autoPickBlessingsForced?: boolean;
  onAutoPickBlessingsChange?: (enabled: boolean) => void;
}

const DEFAULT_TARGETING_MODES: Array<{ id: string; label: string }> = [
  { id: 'nearest', label: 'Nearest' },
  { id: 'lowest_hp', label: 'Lowest HP' },
  { id: 'strongest', label: 'Strongest (highest maxHP)' },
  { id: 'boss', label: 'Boss priority' },
  { id: 'flying', label: 'Flying priority' },
  { id: 'last', label: 'Furthest (backline)' },
];

export class SettingsPanel {
  private api: SettingsAPI;
  private root: HTMLElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private confirmState = false;
  private volumeSlider: HTMLInputElement | null = null;
  private volumeLabel: HTMLElement | null = null;
  private muteBtn: HTMLButtonElement | null = null;
  private targetingSelect: HTMLSelectElement | null = null;
  private autoPickInput: HTMLInputElement | null = null;

  constructor(api: SettingsAPI) {
    this.api = api;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    parent.className = 'settings-panel';
    this.render();
  }

  unmount(): void {
    this.root = null;
    this.confirmBtn = null;
    this.confirmState = false;
    this.volumeSlider = null;
    this.volumeLabel = null;
    this.muteBtn = null;
    this.targetingSelect = null;
    this.autoPickInput = null;
  }

  update(): void {
    // static panel
  }

  /**
   * Push the live auto-pick state in. `forced` disables the control rather than
   * hiding it, so the player can see *why* the setting is not theirs right now.
   */
  setAutoPickBlessings(enabled: boolean, forced: boolean): void {
    this.api.autoPickBlessings = enabled;
    this.api.autoPickBlessingsForced = forced;
    if (this.autoPickInput) {
      this.autoPickInput.checked = enabled;
      this.autoPickInput.disabled = forced;
    }
  }

  private render(): void {
    if (!this.root) return;
    this.root.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Settings';
    this.root.appendChild(title);

    // ── Audio section ──
    this.root.appendChild(this.renderAudioSection());

    // ── Targeting section ──
    const modes = this.api.targetingModes ?? DEFAULT_TARGETING_MODES;
    if (this.api.onTargetingModeChange) {
      this.root.appendChild(this.renderTargetingSection(modes));
    }

    // ── Blessings section ──
    if (this.api.onAutoPickBlessingsChange) {
      this.root.appendChild(this.renderBlessingSection());
    }

    // ── Save Data section ──
    this.root.appendChild(this.renderSaveSection());
  }

  /**
   * Plan §1.1: the draft pauses the intermission, so an unattended run needs a
   * way to resolve it. The setting defaults off — a player at the keyboard
   * should get to choose — and is forced on once automation is unlocked,
   * because at that point nobody is watching.
   */
  private renderBlessingSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'settings-section';

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'settings-section-title';
    sectionTitle.textContent = 'Blessings';
    section.appendChild(sectionTitle);

    const desc = document.createElement('p');
    desc.className = 'settings-desc';
    desc.textContent = this.api.autoPickBlessingsForced
      ? 'Auto-pick is forced on while automation is unlocked, so an idle run never '
        + 'stops at a draft. The safest offer is taken after 20 seconds.'
      : 'Take the safest offer automatically after 20 seconds instead of waiting for '
        + 'a click. The draft never blocks the simulation either way.';
    section.appendChild(desc);

    const label = document.createElement('label');
    label.className = 'settings-checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.api.autoPickBlessings ?? false;
    input.disabled = this.api.autoPickBlessingsForced ?? false;
    this.autoPickInput = input;
    input.addEventListener('change', () => {
      this.api.autoPickBlessings = input.checked;
      this.api.onAutoPickBlessingsChange?.(input.checked);
    });
    label.appendChild(input);
    const text = document.createElement('span');
    text.textContent = 'Auto-pick blessings';
    label.appendChild(text);
    section.appendChild(label);

    return section;
  }

  private renderAudioSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'settings-section';

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'settings-section-title';
    sectionTitle.textContent = 'Audio';
    section.appendChild(sectionTitle);

    const desc = document.createElement('p');
    desc.className = 'settings-desc';
    desc.textContent = 'Master volume for sound effects and ambient pad. Settings are saved automatically.';
    section.appendChild(desc);

    const row = document.createElement('div');
    row.className = 'settings-row';

    this.volumeLabel = document.createElement('span');
    this.volumeLabel.className = 'settings-volume-value';
    this.volumeLabel.textContent = `${Math.round(this.api.initialVolume * 100)}%`;
    row.appendChild(this.volumeLabel);

    this.volumeSlider = document.createElement('input');
    this.volumeSlider.type = 'range';
    this.volumeSlider.min = '0';
    this.volumeSlider.max = '100';
    this.volumeSlider.step = '1';
    this.volumeSlider.value = String(Math.round(this.api.initialVolume * 100));
    this.volumeSlider.className = 'settings-volume-slider';
    this.volumeSlider.setAttribute('aria-label', 'Master volume');
    this.volumeSlider.addEventListener('input', () => {
      if (!this.volumeSlider || !this.volumeLabel) return;
      const v = parseInt(this.volumeSlider.value, 10) / 100;
      setText(this.volumeLabel, `${Math.round(v * 100)}%`);
      this.api.onVolumeChange(v);
    });
    row.appendChild(this.volumeSlider);

    this.muteBtn = document.createElement('button');
    this.muteBtn.type = 'button';
    this.muteBtn.className = 'btn-mute';
    this.muteBtn.textContent = this.api.isMuted ? 'Unmute' : 'Mute';
    this.muteBtn.addEventListener('click', () => {
      this.api.onMuteToggle();
      this.api.isMuted = !this.api.isMuted;

      if (this.muteBtn) {
        setText(this.muteBtn, this.api.isMuted ? 'Unmute' : 'Mute');
      }
    });
    row.appendChild(this.muteBtn);

    section.appendChild(row);
    return section;
  }

  private renderTargetingSection(modes: Array<{ id: string; label: string }>): HTMLElement {
    const section = document.createElement('div');
    section.className = 'settings-section';

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'settings-section-title';
    sectionTitle.textContent = 'Targeting';
    section.appendChild(sectionTitle);

    const desc = document.createElement('p');
    desc.className = 'settings-desc';
    desc.textContent = 'How the tower chooses which enemy to attack. "Manual Aim" (hold mouse) always overrides this.';
    section.appendChild(desc);

    this.targetingSelect = document.createElement('select');
    this.targetingSelect.className = 'settings-select';
    for (const m of modes) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === (this.api.currentTargetingMode ?? 'nearest')) opt.selected = true;
      this.targetingSelect.appendChild(opt);
    }
    this.targetingSelect.addEventListener('change', () => {
      if (!this.targetingSelect || !this.api.onTargetingModeChange) return;
      this.api.onTargetingModeChange(this.targetingSelect.value);
    });
    section.appendChild(this.targetingSelect);
    return section;
  }

  private renderSaveSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'settings-section';

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'settings-section-title';
    sectionTitle.textContent = 'Save Data';
    section.appendChild(sectionTitle);

    const desc = document.createElement('p');
    desc.className = 'settings-desc';
    desc.textContent = 'Clearing your save will delete all progress and reset the game to its initial state. This cannot be undone.';
    section.appendChild(desc);

    this.confirmBtn = document.createElement('button');
    this.confirmBtn.type = 'button';
    this.confirmBtn.className = 'btn-clear-save';
    this.confirmBtn.textContent = 'Clear Save';
    this.confirmBtn.addEventListener('click', () => this.handleClearClick());
    section.appendChild(this.confirmBtn);

    return section;
  }

  private handleClearClick(): void {
    if (!this.confirmBtn) return;

    if (!this.confirmState) {
      this.confirmState = true;
      setText(this.confirmBtn, 'Click again to confirm — this destroys all progress!');
      toggleClass(this.confirmBtn, 'is-confirming', true);
      setTimeout(() => {
        this.confirmState = false;
        if (this.confirmBtn) {
          setText(this.confirmBtn, 'Clear Save');
          toggleClass(this.confirmBtn, 'is-confirming', false);
        }
      }, 4000);
      return;
    }

    this.confirmState = false;
    this.api.onClearSave();
  }
}
