import { setText, toggleClass } from '../utils/dom';
import { TARGETING_MODES } from '../data/tower';
import type { QualityTier } from '../data/quality';

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
  /** Plan §4.3: cast on hotkey (default) versus click-to-place. */
  instantCast?: boolean;
  onInstantCastChange?: (enabled: boolean) => void;
  /** UI plan §9.D: the four-position Graphics control. */
  currentQuality?: 'auto' | QualityTier;
  onQualityChange?: (pref: 'auto' | QualityTier) => void;
}

/**
 * Mirrors the HUD dropdown (plan §2.3), from the same table, so the two can
 * never offer different modes. The HUD is where the choice now lives; this
 * stays because it is where a player who has always changed it here will look.
 */
const DEFAULT_TARGETING_MODES: Array<{ id: string; label: string }> =
  TARGETING_MODES.map(m => ({ id: m.id, label: `${m.label} — ${m.hint}` }));

/**
 * One-line summary of what a tier costs (UI plan §9.D).
 *
 * The strings are short on purpose: a Settings panel hint, not a tooltip. The
 * numbers are intentionally not named — a player who has not read the doc
 * does not know that 1× means 60 fps on a desktop and 30 fps on a phone, and
 * the answer to "is the low tier OK for me" is the same either way.
 */
function qualityHint(pref: 'auto' | QualityTier, active: QualityTier): string {
  const prefix = pref === 'auto' ? 'Auto: ' : '';
  switch (active) {
    case 'high':   return prefix + 'High: full particles, glow pass, 2× buffer';
    case 'medium': return prefix + 'Medium: half particles, glow pass, 1.5× buffer';
    case 'low':    return prefix + 'Low: quarter particles, no glow, 1× buffer';
  }
}

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
  private instantCastInput: HTMLInputElement | null = null;
  /** Quality segmented buttons, indexed by preference id (UI plan §9.D). */
  private qualityButtons: Map<'auto' | QualityTier, HTMLButtonElement> = new Map();
  private qualityHint: HTMLElement | null = null;

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
    this.instantCastInput = null;
    this.qualityButtons.clear();
    this.qualityHint = null;
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

  /** Push the live instant-cast preference in (plan §4.3). */
  setInstantCast(enabled: boolean): void {
    this.api.instantCast = enabled;
    if (this.instantCastInput) this.instantCastInput.checked = enabled;
  }

  /**
   * Push the live quality preference in (UI plan §9.D).
   *
   * Reflects it on the segmented control and re-states the per-tier hint, so
   * the panel can never disagree with `Game.qualityPreference`.
   */
  setQuality(pref: 'auto' | QualityTier, currentTier: QualityTier): void {
    this.api.currentQuality = pref;
    for (const [key, btn] of this.qualityButtons) {
      toggleClass(btn, 'active', key === pref);
    }
    if (this.qualityHint) {
      this.qualityHint.textContent = qualityHint(pref, currentTier);
    }
  }

  private render(): void {
    if (!this.root) return;
    this.root.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Settings';
    this.root.appendChild(title);

    // ── Graphics section (UI plan §9.D) ──
    if (this.api.onQualityChange) {
      this.root.appendChild(this.renderGraphicsSection());
    }

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

    // ── Abilities section ──
    if (this.api.onInstantCastChange) {
      this.root.appendChild(this.renderAbilitySection());
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
        + 'stops at a draft. The safest offer is taken after 10 seconds.'
      : 'Take the safest offer automatically after 10 seconds instead of waiting for '
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

  /**
   * Plan §4.3. Default **on**, so nothing changes for a player who never opens
   * this panel: the hotkey casts, exactly as it always has, and the ability
   * places itself on the densest cluster in range. Turning it off is opting
   * *in* to aiming, which is worth roughly +30% on the three placeable
   * abilities and is the whole reward for the extra click.
   */
  private renderAbilitySection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'settings-section';

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'settings-section-title';
    sectionTitle.textContent = 'Abilities';
    section.appendChild(sectionTitle);

    const desc = document.createElement('p');
    desc.className = 'settings-desc';
    desc.textContent = 'Instant cast fires Rain of Arrows, Frost Nova and Meteor Strike the moment '
      + 'you press the hotkey, aimed at the densest cluster in range. Turn it off to place them '
      + 'yourself: the hotkey arms the ability and the next click on the battlefield drops it, '
      + 'hitting harder where you put it. Escape cancels.';
    section.appendChild(desc);

    const label = document.createElement('label');
    label.className = 'settings-checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.api.instantCast ?? true;
    this.instantCastInput = input;
    input.addEventListener('change', () => {
      this.api.instantCast = input.checked;
      this.api.onInstantCastChange?.(input.checked);
    });
    label.appendChild(input);
    const text = document.createElement('span');
    text.textContent = 'Instant cast';
    label.appendChild(text);
    section.appendChild(label);

    return section;
  }

  /**
   * The Graphics section (UI plan §9.D).
   *
   * A four-button segmented control — Auto | High | Medium | Low — with a
   * single-line hint under it that names what the current tier costs in
   * particles, glow and resolution. Sits above Save Data because the cost
   * it charges is the *player's* frame time, and the Save Data confirmation
   * is a two-step affordance that should not be a tap away from a default.
   */
  private renderGraphicsSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'settings-section';

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'settings-section-title';
    sectionTitle.textContent = 'Graphics';
    section.appendChild(sectionTitle);

    const desc = document.createElement('p');
    desc.className = 'settings-desc';
    desc.textContent = 'Trade visual fidelity for frame time. "Auto" picks a tier '
      + 'from your device, then runs a 2-second probe on the first wave and '
      + 'demotes one step if the frame budget is missed. Once you pick a tier '
      + 'yourself, the probe is gone.';
    section.appendChild(desc);

    const segmented = document.createElement('div');
    segmented.className = 'settings-segmented';
    segmented.setAttribute('role', 'radiogroup');
    segmented.setAttribute('aria-label', 'Graphics quality');

    const current = this.api.currentQuality ?? 'auto';
    // `currentTier` is the *active* tier — separate from the preference when
    // the preference is `'auto'`, because the auto-detect may have demoted.
    // The panel is fed both; the hint describes the tier, not the preference.
    const tier = this.api.currentQuality as 'auto' | QualityTier;
    const initialTier: QualityTier = tier === 'auto' || tier === undefined ? 'high' : tier;
    const options: Array<{ key: 'auto' | QualityTier; label: string }> = [
      { key: 'auto', label: 'Auto' },
      { key: 'high', label: 'High' },
      { key: 'medium', label: 'Medium' },
      { key: 'low', label: 'Low' },
    ];
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-segmented-btn';
      btn.dataset.qualityKey = opt.key;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(opt.key === current));
      btn.textContent = opt.label;
      if (opt.key === current) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.api.onQualityChange?.(opt.key);
      });
      segmented.appendChild(btn);
      this.qualityButtons.set(opt.key, btn);
    }
    section.appendChild(segmented);

    const hint = document.createElement('p');
    hint.className = 'settings-desc settings-quality-hint';
    hint.textContent = qualityHint(current, initialTier);
    section.appendChild(hint);
    this.qualityHint = hint;

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
    desc.textContent = 'How the tower chooses which enemy to attack — also available on the HUD, next to the wave controls. "Manual Aim" (hold mouse) always overrides this.';
    section.appendChild(desc);

    this.targetingSelect = document.createElement('select');
    this.targetingSelect.className = 'settings-select';
    for (const m of modes) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === (this.api.currentTargetingMode ?? 'priority')) opt.selected = true;
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
