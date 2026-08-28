import { ABILITIES } from '../data/abilities';
import { Modal } from './Modal';

interface BindGroup {
  title: string;
  binds: Array<{ keys: string[]; action: string }>;
}

/**
 * Static bindings, mirroring the `keydown` handler in `main.ts` and the
 * modifier handling in `UpgradePanel`. Ability hotkeys come from `ABILITIES`
 * so a new ability documents itself.
 */
function buildGroups(): BindGroup[] {
  return [
    {
      title: 'Abilities',
      binds: ABILITIES.map(a => ({ keys: [a.hotkey], action: `Cast ${a.name}` })),
    },
    {
      title: 'The battlefield',
      binds: [
        { keys: ['Click'], action: 'Collect a loot orb at full value (it drifts home for 40% on its own)' },
        { keys: ['Hold'], action: 'Aim manually — the tower shoots where you point instead of auto-acquiring' },
        { keys: ['Hold still'], action: 'Charge a shot for 1.2s, then release: heavy damage, pierce and splash' },
        { keys: ['Click'], action: 'Place an armed ability (with Instant cast turned off)' },
        { keys: ['Esc'], action: 'Cancel ability placement' },
      ],
    },
    {
      title: 'Waves & speed',
      binds: [
        { keys: ['Space'], action: 'Call the next wave early — banks gold momentum for every second skipped' },
        { keys: ['R'], action: 'Restart the current wave' },
        { keys: ['P'], action: 'Toggle auto-progress' },
        { keys: ['-'], action: 'Slow the game down' },
        { keys: ['='], action: 'Speed the game up' },
      ],
    },
    {
      title: 'Upgrades',
      binds: [
        { keys: ['Shift', '+ click'], action: 'Buy up to the next multiple of 10' },
        { keys: ['Ctrl', '+ click'], action: 'Buy as many levels as gold allows' },
      ],
    },
    {
      title: 'Interface',
      binds: [
        { keys: ['?'], action: 'Show or hide this list' },
        { keys: ['Esc'], action: 'Close this list' },
        { keys: ['—'], action: 'Progress → Codex: the in-game glossary for every stat and mechanic' },
      ],
    },
  ];
}

/**
 * Keyboard-shortcut reference (plan §4.8).
 *
 * The hotkeys already existed but were discoverable only by reading the
 * ability bar or the source — wave navigation, speed control and the bulk-buy
 * modifiers were documented nowhere at all.
 */
export class KeybindsOverlay {
  private readonly root: HTMLElement;
  private modal: Modal | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  isOpen(): boolean {
    return this.modal !== null;
  }

  toggle(): void {
    if (this.isOpen()) this.hide();
    else this.show();
  }

  show(): void {
    if (this.modal) return;
    const modal = new Modal({
      id: 'keybinds',
      title: 'Keyboard shortcuts',
      width: 560,
      onClose: () => { this.modal = null; },
      root: this.root,
    });
    this.modal = modal;
    modal.cardElement.classList.add('keybinds-card');
    const card = modal.body;

    const groups = document.createElement('div');
    groups.className = 'keybinds-groups';
    for (const group of buildGroups()) {
      groups.appendChild(this.renderGroup(group));
    }
    card.appendChild(groups);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-claim';
    btn.textContent = 'Close';
    btn.addEventListener('click', () => this.hide());
    card.appendChild(btn);

    modal.open();
  }

  hide(): void {
    const modal = this.modal;
    this.modal = null;
    modal?.destroy();
  }

  private renderGroup(group: BindGroup): HTMLElement {
    const section = document.createElement('div');
    section.className = 'keybinds-group';

    const heading = document.createElement('h3');
    heading.className = 'keybinds-group-title';
    heading.textContent = group.title;
    section.appendChild(heading);

    for (const bind of group.binds) {
      const row = document.createElement('div');
      row.className = 'keybinds-row';

      const keys = document.createElement('div');
      keys.className = 'keybinds-keys';
      for (const key of bind.keys) {
        // A token starting with "+" is a connector ("+ click"), not a key —
        // rendering it as a <kbd> would claim there is a key called "+ click".
        if (key.startsWith('+')) {
          const sep = document.createElement('span');
          sep.className = 'keybinds-sep';
          sep.textContent = key;
          keys.appendChild(sep);
          continue;
        }
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        keys.appendChild(kbd);
      }
      row.appendChild(keys);

      const action = document.createElement('div');
      action.className = 'keybinds-action';
      action.textContent = bind.action;
      row.appendChild(action);

      section.appendChild(row);
    }
    return section;
  }
}
