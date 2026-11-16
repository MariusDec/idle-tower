import { ABYSS_INDEX, abyssStarlight } from '../../content/abyss';
import { STRATA, guardianFloorOf, stratumFoot } from '../../content/strata';
import { BOSS_BY_ID } from '../../content/bosses';
import { ENEMY_BY_ID } from '../../content/enemies';
import { REGIONS } from '../../content/regions';
import { RUSH_INDEX, RUSH_STAGES, rushStarlight } from '../../content/rush';
import type { RegionDef } from '../../content/types';
import { formatDuration, formatNumber } from '../../core/format';
import {
  abyssStart, act2Open, bossDown, inAbyss, inRush, regionRelics, regionTrophies, regionUnlocked, relicRank, rushOpen, selectedRegion,
} from '../../meta/collection';
import { BALANCE } from '../../content/balance';
import { bestHeat } from '../../meta/pacts';
import { regionTrials, trialWon, trialsOpen } from '../../meta/trials';
import { RELIC_BY_ID } from '../../content/relics';
import type { TrialReward } from '../../content/types';
import type { Profile } from '../../meta/profile';
import { motionReduced, setStyle } from '../dom';
import { icon } from '../icon';

/** What a Trial pays (N5), in a few words. */
function rewardText(r: TrialReward): string {
  switch (r.kind) {
    case 'relic':
      return `a rank of ${RELIC_BY_ID[r.relic].name}`;
    case 'trim':
      return `${r.name}, a cosmetic tower trim`;
    case 'notable':
      return `${r.name} — ${r.text}`;
    default: {
      const exhaustive: never = r;
      return exhaustive;
    }
  }
}

/** Six regions in Act 1 (§5.2); the ones not yet built show as the Blight. */
const ACT_REGIONS = 6;

/**
 * What the Map plays as it opens: nothing, the light spreading to a region
 * just cleared (§7.3), or a stratum's band lighting, top down, for a
 * guardian's first fall (plans/late-game/08 §3.2), by stratum index.
 */
export type MapSpread = boolean | { band: number };

/**
 * The Map (§5.2): the regions from the Fields upward, the light reaching as
 * far as the bosses have fallen. Each unlocked region is a card — best
 * wave, the boss trophy, enemies and relics found, its rule — and tapping
 * one sends the next run there. The next region waits as a dark silhouette.
 * Once the Blight falls, the Abyss opens above them all (§9), and each card
 * shows the heat its boss has fallen at.
 */
export class MapView {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly light: HTMLElement;

  /** Regions whose trials list is open (N5). */
  private readonly expanded = new Set<number>();
  private profile: Profile | null = null;

  constructor(
    host: HTMLElement,
    private readonly onSelect: (region: number) => void,
    /** Begin a Trial (N5): the next run, at once. */
    private readonly onTrial: (id: string) => void = () => {},
    /** Start the next descent at waypoint `floor` (plans/late-game/08 §4.4). */
    private readonly onWaypoint: (floor: number) => void = () => {},
  ) {
    this.root = document.createElement('div');
    this.root.className = 'map';
    this.root.innerHTML = `
      <header class="view-head"><h2 class="view-title">The Map</h2></header>
      <div class="map-scroll">
        <div class="map-light" aria-hidden="true"></div>
        <ol class="map-list"></ol>
      </div>`;
    this.list = this.root.querySelector('.map-list')!;
    this.light = this.root.querySelector('.map-light')!;
    host.appendChild(this.root);
  }

  /**
   * Draw the map. `spread` names a region just cleared: the light starts at
   * its old reach and rolls outward to the new one (§7.3).
   */
  show(profile: Profile, spread: MapSpread = false): void {
    this.profile = profile;
    const band = typeof spread === 'object' ? spread.band : null;
    spread = spread === true;
    const cleared = REGIONS.filter((r) => bossDown(profile, r.boss)).length;
    const reach = (n: number): string => `${Math.min(100, ((n + 0.5) / ACT_REGIONS) * 100).toFixed(1)}%`;
    if (spread && !motionReduced()) {
      setStyle(this.light, '--lit', reach(Math.max(0, cleared - 1)));
      this.light.classList.remove('is-spreading');
      // Next frame: let the old reach paint, then roll to the new one.
      requestAnimationFrame(() => {
        this.light.classList.add('is-spreading');
        setStyle(this.light, '--lit', reach(cleared));
      });
    } else {
      setStyle(this.light, '--lit', reach(cleared));
    }

    const chosen = inAbyss(profile) ? ABYSS_INDEX : inRush(profile) ? RUSH_INDEX : selectedRegion(profile).index;
    const items: HTMLElement[] = [];
    for (const r of REGIONS) {
      if (regionUnlocked(profile, r.index)) items.push(this.card(profile, r, r.index === chosen));
      else {
        // The next region shows as a silhouette with its boss's shadow (§5.2).
        items.push(this.silhouette(`Region ${r.index}`, `${BOSS_BY_ID[r.boss].name} waits beyond.`));
        break;
      }
    }
    if (REGIONS.every((r) => regionUnlocked(profile, r.index)) && REGIONS.length < ACT_REGIONS) {
      const last = REGIONS[REGIONS.length - 1];
      if (bossDown(profile, last.boss)) items.push(this.silhouette(`Region ${REGIONS.length + 1}`, 'The Blight runs deeper still.'));
    }
    if (act2Open(profile)) items.push(this.abyss(profile, chosen === ABYSS_INDEX, band));
    if (rushOpen(profile)) items.push(this.rush(profile, chosen === RUSH_INDEX));
    // The Fields at the bottom, the frontier at the top: the light climbs.
    this.list.replaceChildren(...items.reverse());
  }

  /** The Abyss's card (§9): the deepest floor cleared, what the next record pays, and its shaft. */
  private abyss(profile: Profile, chosen: boolean, band: number | null): HTMLElement {
    const best = profile.abyss.best;
    const start = abyssStart(profile);
    const rows: [string, string][] = [
      ['Deepest floor', String(best)],
      ['Next floor pays', `${formatNumber(abyssStarlight(best + 1) - abyssStarlight(best))} ✦`],
    ];
    if (start > 1) rows.push(['Starts at', `Floor ${start}`]);
    const card = this.pastCard(ABYSS_INDEX, 'The Abyss', 'over-infinity', chosen, rows,
      'Strata of six floors, each with its own rule. A Keeper ends each floor, a guardian each sixth.');
    card.append(this.shaft(profile, band));
    return card;
  }

  /**
   * The shaft (plans/late-game/08 §3.2): a band per stratum, descending from
   * the top. A felled guardian's band is lit; a reached one shows dimmed; the
   * next waits as a silhouette; deeper is dark. Once a guardian has fallen,
   * every band whose top is an open waypoint carries its own button, so
   * "Start here" always means the band it sits on.
   * `band`: a stratum whose guardian just fell lights from the top down.
   */
  private shaft(profile: Profile, band: number | null): HTMLElement {
    const ol = document.createElement('ol');
    ol.className = 'map-shaft';
    ol.setAttribute('aria-label', 'The strata');
    const felled = profile.abyss.felled;
    const best = profile.abyss.best;
    const start = abyssStart(profile);
    /** The waypoint button for the band whose first floor is `foot`; null while the top is the only way in. */
    const go = (foot: number): HTMLButtonElement | null => {
      if (felled < 1) return null;
      const here = start === foot;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn map-band-go${here ? ' btn-primary' : ''}`;
      b.textContent = here ? 'Starts here' : 'Start here';
      b.setAttribute('aria-pressed', String(here));
      b.setAttribute('aria-label', here ? `The next descent starts at floor ${foot}` : `Start the next descent at floor ${foot}`);
      b.addEventListener('click', () => this.onWaypoint(foot));
      return b;
    };
    let silhouette = false;
    STRATA.forEach((s, k) => {
      const li = document.createElement('li');
      const boss = BOSS_BY_ID[s.boss];
      const g = guardianFloorOf(k);
      const foot = stratumFoot(k);
      setStyle(li, '--band', s.tint);
      const reached = best >= foot - 1;
      const way = k <= felled ? go(foot) : null;
      if (k < felled) {
        // Guardian down: lit.
        li.className = `map-band is-felled${band === k && !motionReduced() ? ' is-lighting' : ''}`;
        li.append(this.bandHead(s.numeral, s.name, icon(boss.icon)), this.bandLine(`${boss.name} fell · floors ${foot}–${g}`));
        if (way) li.append(way);
      } else if (reached) {
        li.className = 'map-band is-reached';
        li.append(this.bandHead(s.numeral, s.name, null), this.bandLine(`Guardian: floor ${g}`));
        if (way) li.append(way);
      } else if (!silhouette) {
        silhouette = true;
        li.className = 'map-band is-silhouette';
        const shadow = icon(boss.icon);
        shadow.classList.add('map-band-shadow');
        li.append(shadow, this.bandLine(`Something waits at floor ${g}.`));
      } else {
        li.className = 'map-band is-deeper';
        li.setAttribute('aria-hidden', 'true');
      }
      ol.append(li);
    });
    // Past the authored strata, the dark goes on; the last guardian's fall opens a way straight into it.
    const deeper = document.createElement('li');
    const below = felled >= STRATA.length ? go(stratumFoot(STRATA.length)) : null;
    if (below) {
      deeper.className = 'map-band is-reached is-below';
      deeper.append(this.bandHead('', 'Deeper', null), this.bandLine(`Floor ${stratumFoot(STRATA.length)} and below`), below);
    } else {
      deeper.className = 'map-band is-deeper';
      deeper.setAttribute('aria-hidden', 'true');
    }
    ol.append(deeper);
    return ol;
  }

  private bandHead(numeral: string, name: string, mark: Element | null): HTMLElement {
    const head = document.createElement('p');
    head.className = 'map-band-head';
    const n = document.createElement('span');
    n.className = 'map-band-numeral';
    n.textContent = numeral;
    const t = document.createElement('span');
    t.className = 'map-band-name';
    t.textContent = name;
    head.append(n, t);
    if (mark) head.append(mark);
    return head;
  }

  private bandLine(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'map-band-line';
    p.textContent = text;
    return p;
  }

  /** Boss Rush's card (N8): the record, and what the next stage pays. */
  private rush(profile: Profile, chosen: boolean): HTMLElement {
    const { best, time } = profile.rush;
    const next = best < RUSH_STAGES
      ? ['Next boss pays', `${formatNumber(rushStarlight(best + 1, null) - rushStarlight(best, null))} ✦`] as const
      : ['A faster clear pays', 'more ✦'] as const;
    return this.pastCard(RUSH_INDEX, 'Boss Rush', 'crowned-skull', chosen, [
      ['Record', time !== null ? formatDuration(time) : `${best}/${RUSH_STAGES} bosses`],
      next,
    ], `Every boss, back to back, against the clock. The tower starts at level ${BALANCE.rush.level}.`);
  }

  /** A card past the regions: a mode the player picks like a region. */
  private pastCard(
    index: number, title: string, iconId: Parameters<typeof icon>[0], chosen: boolean,
    rows: readonly (readonly [string, string])[], text: string,
  ): HTMLElement {
    const li = document.createElement('li');
    li.className = `map-region is-abyss${chosen ? ' is-chosen' : ''}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-region-btn';
    btn.setAttribute('aria-pressed', String(chosen));
    btn.addEventListener('click', () => this.onSelect(index));
    const head = document.createElement('div');
    head.className = 'map-region-head';
    const name = document.createElement('span');
    name.className = 'map-region-name';
    name.textContent = title;
    const tag = document.createElement('span');
    tag.className = 'map-region-tag';
    tag.textContent = chosen ? 'Next run' : '';
    head.append(icon(iconId), name, tag);
    const stats = document.createElement('dl');
    stats.className = 'map-region-stats';
    for (const [label, value] of rows) {
      const d = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      d.append(dt, dd);
      stats.append(d);
    }
    const rule = document.createElement('p');
    rule.className = 'map-region-rule';
    rule.textContent = text;
    btn.append(head, stats, rule);
    li.append(btn);
    return li;
  }

  private card(profile: Profile, r: RegionDef, chosen: boolean): HTMLElement {
    const li = document.createElement('li');
    li.className = `map-region${chosen ? ' is-chosen' : ''}${bossDown(profile, r.boss) ? ' is-cleared' : ''}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-region-btn';
    btn.setAttribute('aria-pressed', String(chosen));
    btn.addEventListener('click', () => this.onSelect(r.index));

    const head = document.createElement('div');
    head.className = 'map-region-head';
    const name = document.createElement('span');
    name.className = 'map-region-name';
    name.textContent = r.name;
    const tag = document.createElement('span');
    tag.className = 'map-region-tag';
    tag.textContent = chosen ? 'Next run' : '';
    head.append(icon(r.icon), name, tag);

    const boss = BOSS_BY_ID[r.boss];
    const rec = profile.bosses[r.boss];
    const seen = r.pool.filter((p) => profile.seenEnemies.includes(p.enemy)).length;
    const relics = regionRelics(r.index);
    const found = relics.filter((x) => relicRank(profile, x.id) > 0).length;
    const stats = document.createElement('dl');
    stats.className = 'map-region-stats';
    const stat = (label: string, value: string): void => {
      const d = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      d.append(dt, dd);
      stats.append(d);
    };
    const best = profile.regions[r.index]?.bestWave ?? 0;
    // Past its boss, the record is told as overtime (§7.3), with its trophies (N4).
    stat('Best wave', best > 20 ? `20 · +${best - 20}` : String(best));
    const marks = regionTrophies(profile, r.index).length;
    if (marks > 0) stat('Trophies', '★'.repeat(marks) + '☆'.repeat(BALANCE.trophies.overtime.length - marks));
    stat('Enemies', `${seen}/${r.pool.length}`);
    stat('Relics', `${found}/${relics.length}`);
    // Act 2 (§9): the heat its boss has fallen at.
    if (act2Open(profile)) stat('Heat', String(bestHeat(profile, r.index)));

    const trophy = document.createElement('p');
    trophy.className = 'map-region-trophy';
    trophy.append(icon(boss.icon));
    trophy.append(rec?.kills
      ? ` ${boss.name} · fastest ${formatDuration(rec.fastest ?? 0)}`
      : ` ${boss.name} · ${rec ? 'stands' : 'unseen'}`);

    const rule = document.createElement('p');
    rule.className = 'map-region-rule';
    rule.textContent = r.rule ? `${r.rule.name}: ${r.rule.text}` : r.text;

    const enemies = document.createElement('p');
    enemies.className = 'map-region-enemies';
    enemies.textContent = r.pool.map((p) => (profile.seenEnemies.includes(p.enemy) ? ENEMY_BY_ID[p.enemy].name : '???')).join(' · ');

    btn.append(head, stats, trophy, rule, enemies);
    li.append(btn);
    if (trialsOpen(profile, r.index)) li.append(this.trials(profile, r.index));
    return li;
  }

  /** A cleared region's Trials (N5): a count that opens the list, each with its rules, reward and Begin. */
  private trials(profile: Profile, region: number): HTMLElement {
    const list = regionTrials(region);
    const won = list.filter((t) => trialWon(profile, t.id)).length;
    const open = this.expanded.has(region);
    const box = document.createElement('div');
    box.className = 'map-trials';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn map-trials-toggle';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.append(icon('checkered-flag'), ` Trials ${won}/${list.length}`);
    toggle.addEventListener('click', () => {
      if (open) this.expanded.delete(region);
      else this.expanded.add(region);
      if (this.profile) this.show(this.profile);
    });
    box.append(toggle);
    if (!open) return box;
    const ol = document.createElement('ol');
    ol.className = 'map-trials-list';
    for (const t of list) {
      const done = trialWon(profile, t.id);
      const row = document.createElement('li');
      row.className = `map-trial${done ? ' is-won' : ''}`;
      const name = document.createElement('p');
      name.className = 'map-trial-name';
      name.textContent = done ? `${t.name} ✓` : t.name;
      const rule = document.createElement('p');
      rule.className = 'map-trial-rule';
      rule.textContent = t.text;
      const pays = document.createElement('p');
      pays.className = 'map-trial-reward';
      pays.textContent = `${done ? 'Paid' : 'Pays'}: ${rewardText(t.reward)}`;
      const go = document.createElement('button');
      go.type = 'button';
      go.className = `btn map-trial-go${done ? '' : ' btn-primary'}`;
      go.textContent = done ? 'Again' : 'Begin';
      go.setAttribute('aria-label', `${done ? 'Run again' : 'Begin'}: ${t.name}`);
      go.addEventListener('click', () => this.onTrial(t.id));
      row.append(name, rule, pays, go);
      ol.append(row);
    }
    box.append(ol);
    return box;
  }

  private silhouette(title: string, line: string): HTMLElement {
    const li = document.createElement('li');
    li.className = 'map-region is-dark';
    const h = document.createElement('p');
    h.className = 'map-region-name';
    h.textContent = title;
    const p = document.createElement('p');
    p.className = 'map-region-rule';
    p.textContent = line;
    li.append(icon('locked-fortress'), h, p);
    return li;
  }
}
