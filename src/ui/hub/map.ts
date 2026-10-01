import { BOSS_BY_ID } from '../../content/bosses';
import { ENEMY_BY_ID } from '../../content/enemies';
import { REGIONS } from '../../content/regions';
import type { RegionDef } from '../../content/types';
import { formatDuration } from '../../core/format';
import { bossDown, regionRelics, regionUnlocked, relicRank, selectedRegion } from '../../meta/collection';
import type { Profile } from '../../meta/profile';
import { setStyle } from '../dom';
import { icon } from '../icon';

/** Six regions in Act 1 (§5.2); the ones not yet built show as the Blight. */
const ACT_REGIONS = 6;

/**
 * The Map (§5.2): the regions from the Fields upward, the light reaching as
 * far as the bosses have fallen. Each unlocked region is a card — best
 * wave, the boss trophy, enemies and relics found, its rule — and tapping
 * one sends the next run there. The next region waits as a dark silhouette.
 */
export class MapView {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly light: HTMLElement;

  constructor(host: HTMLElement, private readonly onSelect: (region: number) => void) {
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
  show(profile: Profile, spread = false): void {
    const cleared = REGIONS.filter((r) => bossDown(profile, r.boss)).length;
    const reach = (n: number): string => `${Math.min(100, ((n + 0.5) / ACT_REGIONS) * 100).toFixed(1)}%`;
    if (spread && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
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

    const chosen = selectedRegion(profile).index;
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
    // The Fields at the bottom, the frontier at the top: the light climbs.
    this.list.replaceChildren(...items.reverse());
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
    stat('Best wave', String(profile.regions[r.index]?.bestWave ?? 0));
    stat('Enemies', `${seen}/${r.pool.length}`);
    stat('Relics', `${found}/${relics.length}`);

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
    return li;
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
