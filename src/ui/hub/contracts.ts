import { SLOT_NAMES, contractText } from '../../content/contracts';
import { RELIC_BY_ID } from '../../content/relics';
import { formatNumber } from '../../core/format';
import { relicRank } from '../../meta/collection';
import { contractLead, contractPay, contractTier, heatNeeded, takeBlocked } from '../../meta/contracts';
import { WEAPON_BY_ID } from '../../content/weapons';
import { heat } from '../../meta/pacts';
import type { Profile } from '../../meta/profile';
import { starGifts } from '../../meta/stars';
import type { ContractSpec } from '../../content/types';
import { icon } from '../icon';

export interface ContractActions {
  /** Take a card: the next run is its, at once. */
  take(id: string): void;
  /** Reroll a card, free: its slot's band and rider stay. */
  reroll(id: string): boolean;
  /** Pin a card to the Next line, or unpin it. */
  pin(id: string): boolean;
  /** Open the Pacts, to set the heat a card needs. */
  pacts(): void;
  /** Leave for the home view. */
  done(): void;
}

/** Roman ranks, for a rider's next rank. */
const RANKS = ['', 'I', 'II', 'III', 'IV', 'V'];

/**
 * The Contract board (plans/late-game/10 §2): three stacked cards, Quick,
 * Steady and Hard, each with what it asks, what it pays now, and Take,
 * reroll and pin. A view like the Pacts: no tab, opened from the home view
 * or the Next line.
 */
export class ContractsView {
  readonly root: HTMLElement;
  private readonly doneN: HTMLElement;
  private readonly list: HTMLElement;
  private profile: Profile | null = null;

  constructor(host: HTMLElement, private readonly actions: ContractActions) {
    this.root = document.createElement('div');
    this.root.className = 'pacts contracts';
    this.root.innerHTML = `
      <header class="view-head">
        <h2 class="view-title">Contracts</h2>
        <span class="contracts-done"></span>
      </header>
      <ul class="entry-list pacts-list contracts-list"></ul>
      <button type="button" class="btn tactics-done">Done</button>`;
    this.doneN = this.root.querySelector('.contracts-done')!;
    this.list = this.root.querySelector('.contracts-list')!;
    this.root.querySelector('.tactics-done')!.addEventListener('click', () => actions.done());
    host.appendChild(this.root);
  }

  show(profile: Profile): void {
    this.profile = profile;
    this.render();
  }

  private render(): void {
    const p = this.profile;
    if (!p) return;
    const done = p.contracts.done;
    this.doneN.textContent = done > 0 ? `${formatNumber(done)} done` : '';
    this.list.replaceChildren(...p.contracts.board.map((c) => this.card(p, c)));
  }

  private card(p: Profile, c: ContractSpec): HTMLElement {
    const tier = contractTier(p, c);
    const pay = contractPay(p, tier);
    const li = document.createElement('li');
    li.className = `entry contracts-card is-${c.slot}${p.contracts.pinned === c.id ? ' is-pinned' : ''}`;

    const head = document.createElement('div');
    head.className = 'entry-head';
    const name = document.createElement('span');
    name.className = 'entry-name contracts-slot';
    name.textContent = SLOT_NAMES[c.slot];
    const pips = document.createElement('span');
    pips.className = 'contracts-pips';
    pips.textContent = '●'.repeat(tier) + '○'.repeat(4 - tier);
    pips.setAttribute('aria-label', `Tier ${tier} of 4`);
    const pays = document.createElement('span');
    pays.className = 'entry-count contracts-pay';
    // Starlight as `payStarlight` will pay it: grown by the Stargazers.
    const sl = pay.starlight > 0 ? Math.round(pay.starlight * starGifts(p).starlight) : 0;
    pays.textContent = `${sl > 0 ? `✦ ${formatNumber(sl)} · ` : ''}${formatNumber(pay.shards)}`;
    pays.setAttribute('aria-label', `Pays ${sl > 0 ? `${formatNumber(sl)} Starlight and ` : ''}${formatNumber(pay.shards)} shards`);
    head.append(icon('wanted-reward'), name, pips, pays);

    const text = document.createElement('p');
    text.className = 'entry-text contracts-text';
    text.textContent = contractText(c);
    li.append(head, text);

    // Heat (§2): shown when the card needs it; a Pacts link when it isn't set yet.
    const need = heatNeeded(c);
    const blocked = takeBlocked(p, c);
    if (need > 0) {
      const line = document.createElement('p');
      line.className = 'entry-text contracts-heat';
      if (blocked) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'btn contracts-pacts';
        link.textContent = `Pacts · heat ${heat(p)} of ${need}`;
        link.addEventListener('click', () => this.actions.pacts());
        line.append(link);
      } else {
        line.textContent = `Your heat: ${heat(p)} ✓`;
      }
      li.append(line);
    }
    // A card that names a weapon hands it over: the run starts with it mounted.
    const lead = contractLead(c);
    if (lead) {
      const line = document.createElement('p');
      line.className = 'entry-text contracts-lead';
      line.textContent = `Starts with ${WEAPON_BY_ID[lead].name} mounted.`;
      li.append(line);
    }
    if (c.rider) {
      const rider = document.createElement('p');
      rider.className = 'entry-text contracts-rider';
      const next = Math.min(3, relicRank(p, c.rider) + 1);
      rider.textContent = `+ ${RELIC_BY_ID[c.rider].name} rank ${RANKS[next]}`;
      li.append(rider);
    }

    const row = document.createElement('div');
    row.className = 'contracts-actions';
    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'btn btn-primary contracts-take';
    take.textContent = 'Take';
    take.disabled = blocked !== null;
    if (blocked) take.title = blocked;
    take.addEventListener('click', () => this.actions.take(c.id));
    const reroll = document.createElement('button');
    reroll.type = 'button';
    reroll.className = 'tactics-btn contracts-reroll';
    reroll.textContent = '↻';
    reroll.setAttribute('aria-label', `Reroll the ${SLOT_NAMES[c.slot]} contract`);
    reroll.addEventListener('click', () => {
      if (this.actions.reroll(c.id)) this.render();
    });
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'tactics-btn contracts-pin';
    pin.textContent = '⚑';
    const pinned = p.contracts.pinned === c.id;
    pin.setAttribute('aria-pressed', String(pinned));
    pin.setAttribute('aria-label', pinned ? 'Unpin from the Next line' : 'Pin to the Next line');
    pin.addEventListener('click', () => {
      if (this.actions.pin(c.id)) this.render();
    });
    row.append(take, reroll, pin);
    li.append(row);
    return li;
  }
}
