import { ABILITIES } from '../data/abilities';
import { toggleClass } from '../utils/dom';

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
      title: 'Waves & speed',
      binds: [
        { keys: [',', '<'], action: 'Go to the previous wave' },
        { keys: ['.', '>'], action: 'Go to the next wave (up to your deepest)' },
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
  private wrap: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  isOpen(): boolean {
    return this.wrap !== null;
  }

  toggle(): void {
    if (this.isOpen()) this.hide();
    else this.show();
  }

  show(): void {
    if (this.wrap) return;
    const wrap = document.createElement('div');
    wrap.className = 'welcome-modal keybinds-modal';

    const backdrop = document.createElement('div');
    backdrop.className = 'welcome-modal-backdrop';
    backdrop.addEventListener('click', () => this.hide());
    wrap.appendChild(backdrop);

    const card = document.createElement('div');
    card.className = 'welcome-modal-card keybinds-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Keyboard shortcuts');

    const title = document.createElement('h2');
    title.className = 'welcome-modal-title';
    title.textContent = 'Keyboard shortcuts';
    card.appendChild(title);

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

    wrap.appendChild(card);
    this.root.appendChild(wrap);
    this.wrap = wrap;
    requestAnimationFrame(() => toggleClass(wrap, 'is-visible', true));
  }

  hide(): void {
    if (this.wrap && this.wrap.parentNode) {
      this.wrap.parentNode.removeChild(this.wrap);
    }
    this.wrap = null;
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
