import type { GameState, TalentBranch, TalentId } from '../types';
import { TALENTS, TALENTS_BY_BRANCH, TALENT_BY_ID } from '../data/talentTree';
import { setText, toggleClass, setStyle } from '../utils/dom';

export interface TalentAPIDeps {
  allocated: Record<string, number>;
  unspentPoints: number;
  canAllocate: (id: string) => boolean;
  allocate: (id: string) => boolean;
  refundBranch: (branch: TalentBranch) => void;
}

const BRANCH_DISPLAY: { id: TalentBranch; label: string; color: string }[] = [
  { id: 'offense', label: 'Offense', color: '#e74c3c' },
  { id: 'defense', label: 'Defense', color: '#2ecc71' },
  { id: 'utility', label: 'Utility', color: '#f1c40f' },
  { id: 'magic', label: 'Magic', color: '#9b59b6' },
];

const RESPEK_COST_GOLD = 500;

export class TalentPanel {
  private readonly deps: TalentAPIDeps;
  private root: HTMLElement | null = null;
  private unspentEl!: HTMLElement;
  private talentRows = new Map<TalentId, HTMLElement>();
  private talentPointsEls = new Map<TalentId, HTMLElement>();
  private talentBtnEls = new Map<TalentId, HTMLButtonElement>();
  private respecBtns = new Map<TalentBranch, HTMLButtonElement>();

  constructor(deps: TalentAPIDeps) {
    this.deps = deps;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.renderInto(parent);
  }

  update(_state: GameState): void {
    if (!this.root) return;
    setText(this.unspentEl, `${this.deps.unspentPoints} unspent`);

    for (const talent of TALENTS) {
      const row = this.talentRows.get(talent.id);
      const ptsEl = this.talentPointsEls.get(talent.id);
      const btn = this.talentBtnEls.get(talent.id);
      if (!row || !ptsEl || !btn) continue;

      const current = this.deps.allocated[talent.id] ?? 0;
      setText(ptsEl, `${current} / ${talent.maxPoints}`);

      if (current >= talent.maxPoints) {
        toggleClass(row, 'talent-maxed', true);
        toggleClass(row, 'talent-available', false);
        toggleClass(row, 'talent-locked', false);
        btn.disabled = true;
        setText(btn, 'Maxed');
      } else if (this.deps.canAllocate(talent.id)) {
        toggleClass(row, 'talent-maxed', false);
        toggleClass(row, 'talent-available', true);
        toggleClass(row, 'talent-locked', false);
        btn.disabled = false;
        setText(btn, 'Buy');
      } else {
        toggleClass(row, 'talent-maxed', false);
        toggleClass(row, 'talent-available', false);
        toggleClass(row, 'talent-locked', true);
        btn.disabled = true;
        setText(btn, 'Locked');
      }
    }

    for (const branch of BRANCH_DISPLAY) {
      const btn = this.respecBtns.get(branch.id);
      if (!btn) continue;
      const hasPoints = TALENTS_BY_BRANCH[branch.id].some(t => (this.deps.allocated[t.id] ?? 0) > 0);
      btn.disabled = !hasPoints;
    }
  }

  private unmount(): void {
    this.root = null;
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'talent-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Talent Tree';
    parent.appendChild(title);

    const unspentBar = document.createElement('div');
    unspentBar.className = 'talent-unspent-bar';
    const unspentLabel = document.createElement('span');
    unspentLabel.textContent = 'Talent Points: ';
    this.unspentEl = document.createElement('span');
    this.unspentEl.className = 'talent-unspent-value';
    this.unspentEl.textContent = '0 unspent';
    unspentBar.appendChild(unspentLabel);
    unspentBar.appendChild(this.unspentEl);
    parent.appendChild(unspentBar);

    const grid = document.createElement('div');
    grid.className = 'talent-grid';

    for (const branch of BRANCH_DISPLAY) {
      grid.appendChild(this.renderBranchColumn(branch));
    }
    parent.appendChild(grid);
  }

  private renderBranchColumn(branch: { id: TalentBranch; label: string; color: string }): HTMLElement {
    const col = document.createElement('div');
    col.className = 'talent-column';

    const header = document.createElement('div');
    header.className = 'talent-col-header';
    setStyle(header, '--branch-color', branch.color);
    header.textContent = branch.label;
    col.appendChild(header);

    const talents = TALENTS_BY_BRANCH[branch.id];
    for (const talent of talents) {
      col.appendChild(this.renderTalentRow(talent));
    }

    const respecBtn = document.createElement('button');
    respecBtn.type = 'button';
    respecBtn.className = 'btn btn-respec';
    respecBtn.textContent = `Respec (${RESPEK_COST_GOLD}g)`;
    respecBtn.addEventListener('click', () => this.deps.refundBranch(branch.id));
    this.respecBtns.set(branch.id, respecBtn);
    col.appendChild(respecBtn);

    return col;
  }

  private renderTalentRow(talent: typeof TALENTS[number]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'talent-row talent-locked';
    row.dataset.talentId = talent.id;
    this.talentRows.set(talent.id, row);

    const icon = document.createElement('div');
    icon.className = 'talent-icon';
    setStyle(icon, '--talent-color', talent.color);
    icon.textContent = talent.glyph;
    row.appendChild(icon);

    const info = document.createElement('div');
    info.className = 'talent-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'talent-name-row';
    const name = document.createElement('span');
    name.className = 'talent-name';
    name.textContent = talent.name;
    nameRow.appendChild(name);

    const tierBadge = document.createElement('span');
    tierBadge.className = 'talent-tier-badge';
    tierBadge.textContent = `T${talent.tier}`;
    nameRow.appendChild(tierBadge);

    if (talent.exclusive) {
      const excl = document.createElement('span');
      excl.className = 'talent-exclusive-badge';
      excl.textContent = 'Exclusive';
      nameRow.appendChild(excl);
    }
    info.appendChild(nameRow);

    const desc = document.createElement('div');
    desc.className = 'talent-desc';
    desc.textContent = talent.description;
    info.appendChild(desc);

    const meta = document.createElement('div');
    meta.className = 'talent-meta';
    const pts = document.createElement('span');
    pts.className = 'talent-points';
    pts.textContent = '0 / 3';
    this.talentPointsEls.set(talent.id, pts);
    meta.appendChild(pts);

    if (talent.prerequisites.length > 0) {
      const prereq = document.createElement('span');
      prereq.className = 'talent-prereq';
      prereq.textContent = `Requires: ${talent.prerequisites.map(id => TALENT_BY_ID[id]?.name ?? id).join(', ')}`;
      meta.appendChild(prereq);
    }
    info.appendChild(meta);
    row.appendChild(info);

    const action = document.createElement('div');
    action.className = 'talent-action';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-buy';
    btn.textContent = 'Locked';
    btn.disabled = true;
    btn.addEventListener('click', () => this.deps.allocate(talent.id));
    this.talentBtnEls.set(talent.id, btn);
    action.appendChild(btn);
    row.appendChild(action);

    return row;
  }
}
