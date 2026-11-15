import type { RunState } from '../sim/state';
import { FLOOR_WAVES, floorOf, floorWave } from '../content/abyss';
import { STRATUM_BY_ID } from '../content/strata';
import { BOSS_BY_ID } from '../content/bosses';
import { RUSH_STAGES } from '../content/rush';
import { frameById } from '../content/frames';
import { pactLoad } from '../sim/pacts';
import { phasesOf } from '../sim/systems/boss';
import { BOSS_WAVE, runRegion, runWave } from '../sim/systems/waves';
import { formatDuration, formatNumber } from '../core/format';
import type { WeaponId } from '../content/types';
import { buildOf } from '../meta/results';
import { buildChips, buildKey, formChip, formKey } from './build';
import { setAriaLabel, setStyle, setText, toggleClass } from './dom';
import { icon, iconMarkup } from './icon';

/**
 * The battle HUD (§10.1): HP, wave, region and the run's shards on top, and
 * the boss bar while a boss stands; the build strip (U3), the XP bar, the
 * level, the speed toggle and the Autocaster switch (each once owned) and
 * the ultimate at the bottom, under the thumb; and manual zoom's buttons on
 * the right edge (camera-and-fog §5.4): `+ / −`, and a fit chip only while
 * zoomed in. Nothing else.
 */
export interface HudActions {
  pause(): void;
  ult(): void;
  speed(): void;
  autoUlt(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomFit(): void;
  /** Open the rift on the field (plans/late-game/02): the chip's path. */
  rift(): void;
  /** Claim the reliquary nearest to fading (plans/late-game/03): the chip's path. */
  reliquary(): void;
}

/** The HUD's reliquary chip (plans/late-game/03 §3.4): the share of the soonest one's window left, and how many wait. */
export interface ReliquaryChip {
  left: number;
  count: number;
}

/** The HUD's rift chip (plans/late-game/02 §2): its rarity, the share of its window left, and whether a draft holds it shut. */
export interface RiftChip {
  rarity: 'common' | 'rare' | 'legendary';
  left: number;
  blocked: boolean;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly wave: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly level: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly ult: HTMLButtonElement;
  private readonly ultLabel: HTMLElement;
  private readonly region: HTMLElement;
  private readonly shards: HTMLElement;
  private readonly speed: HTMLButtonElement;
  private readonly auto: HTMLButtonElement;
  private readonly waveLabel: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossPips: HTMLElement;
  private readonly build: HTMLElement;
  private readonly zoomIn: HTMLButtonElement;
  private readonly zoomOut: HTMLButtonElement;
  private readonly zoomFit: HTMLButtonElement;
  private readonly storedChip: HTMLElement;
  private readonly stored: HTMLElement;
  private readonly storedFill: HTMLElement;
  private readonly rift: HTMLButtonElement;
  private readonly riftLabel: HTMLElement;
  private readonly reliquary: HTMLButtonElement;
  private readonly reliquaryCount: HTMLElement;
  /** True once the `forms` explainer has been told: the strip ends in the Final Form chip (plans/late-game/07). */
  private formTold = false;
  /** The build as last drawn (`buildKey`), so the strip redraws only when it changes. */
  private buildDrawn = '';

  constructor(host: HTMLElement, actions: HudActions) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-row">
          <div class="hud-wave"><span class="hud-label hud-wave-label">Wave</span> <span class="hud-wave-n">1</span></div>
          <button type="button" class="hud-pause" aria-label="Pause">❚❚</button>
        </div>
        <div class="hud-hp" role="meter" aria-label="Tower health">
          <div class="hud-hp-fill"></div>
          <span class="hud-hp-text"></span>
        </div>
        <div class="hud-row hud-meta">
          <span class="hud-region"></span>
          <span class="hud-shards-group">
            <span class="hud-stored-chip" hidden></span>
            <span class="hud-shards" aria-label="Shards this run">${iconMarkup('crystal-cluster')}<span class="hud-shards-n">0</span></span>
          </span>
        </div>
        <div class="hud-stored" role="meter" aria-label="Stored Light" aria-valuemin="0" aria-valuemax="100" hidden><div class="hud-stored-fill"></div></div>
        <div class="hud-boss" hidden>
          <div class="hud-row"><span class="hud-boss-name"></span><span class="hud-boss-pips"></span></div>
          <div class="hud-boss-bar" role="meter" aria-label="Boss health"><div class="hud-boss-fill"></div></div>
        </div>
      </div>
      <div class="hud-zoom">
        <button type="button" class="hud-zoom-step hud-zoom-in" aria-label="Zoom in">+</button>
        <button type="button" class="hud-zoom-step hud-zoom-out" aria-label="Zoom out" disabled>−</button>
        <button type="button" class="hud-zoom-fit" aria-label="Show the whole light" hidden>Fit</button>
      </div>
      <div class="hud-bottom">
        <div class="hud-row hud-row-bottom">
          <div class="hud-level"><span class="hud-label">Lv</span> <span class="hud-level-n">1</span></div>
          <div class="hud-toggles">
            <button type="button" class="hud-speed" hidden>1×</button>
            <button type="button" class="hud-auto" hidden>Auto</button>
          </div>
          <button type="button" class="hud-reliquary" hidden aria-label="Claim the reliquary"><span class="hud-reliquary-count" hidden></span></button>
          <button type="button" class="hud-rift" hidden aria-label="Open the rift"><span class="hud-rift-label">Rift</span></button>
          <button type="button" class="hud-ult"><span class="hud-ult-label"></span></button>
        </div>
        <ul class="hud-build" aria-label="Build"></ul>
        <div class="hud-xp" role="meter" aria-label="Experience"><div class="hud-xp-fill"></div></div>
      </div>`;
    this.wave = this.root.querySelector('.hud-wave-n')!;
    this.hpFill = this.root.querySelector('.hud-hp-fill')!;
    this.hpText = this.root.querySelector('.hud-hp-text')!;
    this.level = this.root.querySelector('.hud-level-n')!;
    this.xpFill = this.root.querySelector('.hud-xp-fill')!;
    this.ult = this.root.querySelector('.hud-ult')!;
    this.ultLabel = this.root.querySelector('.hud-ult-label')!;
    this.region = this.root.querySelector('.hud-region')!;
    this.shards = this.root.querySelector('.hud-shards-n')!;
    this.speed = this.root.querySelector('.hud-speed')!;
    this.auto = this.root.querySelector('.hud-auto')!;
    this.waveLabel = this.root.querySelector('.hud-wave-label')!;
    this.boss = this.root.querySelector('.hud-boss')!;
    this.bossName = this.root.querySelector('.hud-boss-name')!;
    this.bossFill = this.root.querySelector('.hud-boss-fill')!;
    this.bossPips = this.root.querySelector('.hud-boss-pips')!;
    this.build = this.root.querySelector('.hud-build')!;
    this.storedChip = this.root.querySelector('.hud-stored-chip')!;
    this.stored = this.root.querySelector('.hud-stored')!;
    this.storedFill = this.root.querySelector('.hud-stored-fill')!;
    this.zoomOut = this.root.querySelector('.hud-zoom-out')!;
    this.zoomFit = this.root.querySelector('.hud-zoom-fit')!;
    this.zoomIn = this.root.querySelector('.hud-zoom-in')!;
    this.zoomIn.addEventListener('click', () => actions.zoomIn());
    this.zoomOut.addEventListener('click', () => actions.zoomOut());
    this.zoomFit.addEventListener('click', () => actions.zoomFit());
    this.speed.addEventListener('click', () => actions.speed());
    this.auto.addEventListener('click', () => actions.autoUlt());
    this.root.querySelector('.hud-pause')!.addEventListener('click', () => actions.pause());
    this.ult.addEventListener('click', () => actions.ult());
    this.rift = this.root.querySelector('.hud-rift')!;
    this.riftLabel = this.root.querySelector('.hud-rift-label')!;
    this.rift.addEventListener('click', () => actions.rift());
    this.reliquary = this.root.querySelector('.hud-reliquary')!;
    this.reliquary.prepend(icon('locked-chest'));
    this.reliquaryCount = this.root.querySelector('.hud-reliquary-count')!;
    this.reliquary.addEventListener('click', () => actions.reliquary());
    host.appendChild(this.root);
    this.hide();
  }

  show(): void {
    this.root.hidden = false;
    this.buildDrawn = '';
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Whether the build strip ends in the Final Form chip: once its explainer has been told. */
  setFormChip(on: boolean): void {
    if (on === this.formTold) return;
    this.formTold = on;
    this.buildDrawn = '';
  }

  /** The speed toggle (§6.2): hidden until Overdrive is owned. */
  setSpeed(max: number, current: number): void {
    this.speed.hidden = max <= 1;
    setText(this.speed, `${current}×`);
    setAriaLabel(this.speed, `Game speed ${current}×`);
    toggleClass(this.speed, 'is-fast', current > 1);
  }

  /** The Autocaster switch (§6.2): hidden until it is owned, lit while it is on. */
  setAutoUlt(owned: boolean, on: boolean): void {
    this.auto.hidden = !owned;
    this.auto.setAttribute('aria-pressed', String(on));
    setAriaLabel(this.auto, on ? 'Autocaster on' : 'Autocaster off');
    toggleClass(this.auto, 'is-on', on);
  }

  /**
   * Stored Light (plans/late-game/01 §2): a chip before the shards, lit at
   * the played rate while the wave counts as played and dimmed to the
   * hands-off rate while it doesn't, and a gauge draining as the run's bonus
   * is reserved against the pool. Both hidden while there is no pool.
   */
  setStored(frac: number, rate: number, left: number, played: boolean): void {
    const on = rate > 0 && (left > 0 || frac > 0);
    this.storedChip.hidden = !on;
    this.stored.hidden = !on;
    if (!on) return;
    setText(this.storedChip, `×${rate}`);
    toggleClass(this.storedChip, 'is-played', played);
    setAriaLabel(this.storedChip, played ? `Stored Light ×${rate}: playing` : `Stored Light ×${rate}: left alone`);
    const pct = Math.max(0, Math.min(1, frac));
    setStyle(this.storedFill, 'transform', `scaleX(${pct.toFixed(3)})`);
    const now = String(Math.round(pct * 100));
    if (this.stored.getAttribute('aria-valuenow') !== now) {
      this.stored.setAttribute('aria-valuenow', now);
      this.stored.setAttribute('aria-valuetext', `${formatNumber(Math.floor(left))} left`);
    }
  }

  /**
   * The rift chip (plans/late-game/02 §2): beside the ultimate while a rift
   * waits, its ring draining with the window and coloured by rarity; dimmed,
   * "after the draft", while a draft is open.
   */
  setReliquary(chip: ReliquaryChip | null): void {
    this.reliquary.hidden = chip === null;
    if (!chip) return;
    setStyle(this.reliquary, '--left', chip.left.toFixed(3));
    this.reliquaryCount.hidden = chip.count < 2;
    setText(this.reliquaryCount, String(chip.count));
    setAriaLabel(this.reliquary, chip.count > 1 ? `Claim a reliquary (${chip.count} waiting)` : 'Claim the reliquary');
  }

  setRift(chip: RiftChip | null): void {
    this.rift.hidden = chip === null;
    if (!chip) return;
    setStyle(this.rift, '--left', chip.left.toFixed(3));
    for (const r of ['common', 'rare', 'legendary'] as const) toggleClass(this.rift, `is-${r}`, chip.rarity === r);
    toggleClass(this.rift, 'is-blocked', chip.blocked);
    this.rift.disabled = chip.blocked;
    setText(this.riftLabel, chip.blocked ? 'After draft' : 'Rift');
    setAriaLabel(this.rift, chip.blocked ? 'A rift: after the draft' : `Open the rift (${chip.rarity})`);
  }

  /**
   * Manual zoom's state: the fit chip shows, and `−` works, only while
   * zoomed in; `+` stops at the close limit.
   */
  setZoomed(zoomedIn: boolean, atClose: boolean): void {
    this.zoomFit.hidden = !zoomedIn;
    this.zoomOut.disabled = !zoomedIn;
    this.zoomIn.disabled = atClose;
  }

  update(run: RunState): void {
    const region = runRegion(run);
    const wave = runWave(run);
    if (region.abyss) {
      // The Abyss (§9): "Floor 3 · I", "7/10", and the stratum's rule (plans/late-game/08); past the strata, the template's.
      const s = region.abyss.stratum ? STRATUM_BY_ID[region.abyss.stratum] : undefined;
      setText(this.waveLabel, s ? `Floor ${floorOf(wave)} · ${s.numeral}` : `Floor ${floorOf(wave)}`);
      setText(this.wave, `${floorWave(wave)}/${FLOOR_WAVES}`);
      const rule = s ? s.rule.name : region.rule?.name;
      setText(this.region, s ? `${s.name} · ${rule}` : rule ? `The Abyss · ${rule}` : 'The Abyss');
    } else if (region.rush) {
      // Boss Rush (N8): "Boss 3/8", and the clock, which is the record.
      setText(this.waveLabel, 'Boss');
      setText(this.wave, `${region.rush.stage}/${RUSH_STAGES}`);
      setText(this.region, `Boss Rush · ${formatDuration(run.time)}`);
    } else {
      // "7/20" in the region; past the boss, overtime counts on (§4.2).
      const overtime = run.wave > BOSS_WAVE;
      setText(this.waveLabel, overtime ? 'Overtime' : 'Wave');
      setText(this.wave, overtime ? `+${run.wave - BOSS_WAVE}` : `${wave}/${BOSS_WAVE}`);
      const heat = pactLoad(run.pacts).heat;
      const name = region.rule ? `${region.name} · ${region.rule.name}` : region.name;
      setText(this.region, heat > 0 ? `${name} · Heat ${heat}` : name);
    }
    this.updateBoss(run);
    this.updateBuild(run);
    setText(this.shards, formatNumber(Math.floor(run.shards)));
    const hp = Math.max(0, run.tower.hp);
    const max = run.stats.maxHp;
    const frac = max > 0 ? hp / max : 0;
    setStyle(this.hpFill, 'transform', `scaleX(${frac.toFixed(3)})`);
    setText(this.hpText, `${formatNumber(Math.ceil(hp))} / ${formatNumber(Math.round(max))}`);

    setText(this.level, String(run.level));
    setStyle(this.xpFill, 'transform', `scaleX(${Math.min(1, run.xp / run.xpNext).toFixed(3)})`);

    const name = frameById(run.frameId).ultimate.name;
    const ready = run.ult.charge >= 1;
    setText(this.ultLabel, ready ? name : `${Math.floor(run.ult.charge * 100)}%`);
    setStyle(this.ult, '--charge', run.ult.charge.toFixed(3));
    toggleClass(this.ult, 'is-ready', ready);
    setAriaLabel(this.ult, ready ? `${name}: ready` : `${name}: charging`);
  }

  /** The build strip (U3): what the tower holds, at what level, and what is silenced. */
  private updateBuild(run: RunState): void {
    const silenced = new Set<WeaponId>(run.weapons.filter((w) => w.silencedUntil > run.time).map((w) => w.id));
    const build = buildOf(run);
    const key = this.formTold ? `${buildKey(build, silenced)}|${formKey(run)}` : buildKey(build, silenced);
    if (key === this.buildDrawn) return;
    this.buildDrawn = key;
    const chips = buildChips(build, silenced);
    const crown = this.formTold ? formChip(run) : null;
    if (crown) chips.push(crown);
    this.build.replaceChildren(...chips);
  }

  /** The boss bar (§4.3): its name, its HP, a pip per phase. Only while it stands. */
  private updateBoss(run: RunState): void {
    const b = run.boss;
    const body = b && b.killedIn === null ? run.enemies.find((e) => e.id === b.enemy) : undefined;
    this.boss.hidden = !b || !body;
    if (!b || !body) return;
    const def = BOSS_BY_ID[b.id];
    setText(this.bossName, b.enraged ? `${def.name} · Enraged` : def.name);
    setStyle(this.bossFill, 'transform', `scaleX(${Math.max(0, body.hp / body.maxHp).toFixed(3)})`);
    setText(this.bossPips, phasesOf(run, def).map((_, i) => (i <= b.phase ? '◆' : '◇')).join(' '));
    toggleClass(this.boss, 'is-enraged', b.enraged);
  }
}
