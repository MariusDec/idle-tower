export interface SettingsAPI {
  onClearSave: () => void;
  onVolumeChange: (v: number) => void;
  onMuteToggle: () => void;
  onTargetingModeChange?: (mode: string) => void;
  initialVolume: number;
  initialMuted: boolean;
  currentTargetingMode?: string;
  targetingModes?: Array<{ id: string; label: string }>;
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
  }

  update(): void {
    // static panel
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

    // ── Save Data section ──
    this.root.appendChild(this.renderSaveSection());
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
      this.volumeLabel.textContent = `${Math.round(v * 100)}%`;
      this.api.onVolumeChange(v);
    });
    row.appendChild(this.volumeSlider);

    this.muteBtn = document.createElement('button');
    this.muteBtn.type = 'button';
    this.muteBtn.className = 'btn-mute';
    this.muteBtn.textContent = this.api.initialMuted ? 'Unmute' : 'Mute';
    this.muteBtn.addEventListener('click', () => {
      this.api.onMuteToggle();
      if (this.muteBtn) {
        this.muteBtn.textContent = this.api.initialMuted ? 'Unmute' : 'Mute';
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
      this.confirmBtn.textContent = 'Click again to confirm — this destroys all progress!';
      this.confirmBtn.classList.add('is-confirming');
      setTimeout(() => {
        this.confirmState = false;
        if (this.confirmBtn) {
          this.confirmBtn.textContent = 'Clear Save';
          this.confirmBtn.classList.remove('is-confirming');
        }
      }, 4000);
      return;
    }

    this.confirmState = false;
    this.api.onClearSave();
  }
}
