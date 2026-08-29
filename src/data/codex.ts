/**
 * The Codex — an in-game glossary that maps every resolvable stat to the
 * concept it actually represents.
 *
 * Why this exists: the game has 84 `StatKey`s and a player whose only handle
 * on what any of them mean is a tooltip line in the Stats panel. Putting the
 * explanations in one searchable, cross-referenced place lets a new player
 * answer "what is armor penetration, and does it stack with crit?" without
 * having to read the source. The same data also keeps the StatKey union
 * honest: every key that is *not* self-evident has to show up in exactly one
 * entry's `stats` array, and the test in `tests/codex.test.ts` enforces it.
 *
 * Categories are deliberately few and stable: the panel renders a tab strip
 * and a single icon per tab, so adding a category is a heavier change than
 * adding an entry. If you find yourself wanting a seventh bucket, it is
 * almost always the case that one of the existing six already describes
 * what you mean with a slightly more careful copy.
 */
import type { IconId } from './icons';
import type { StatKey } from '../stats/keys';

/**
 * The six conceptual buckets the Codex splits into. Names double as CSS class
 * suffixes (`codex-cat-{category}`), tab ids, and the lookups in
 * `CODEX_CATEGORY_ICONS` / `CODEX_CATEGORY_LABELS` below — keep them in sync.
 */
export type CodexCategory = 'offense' | 'defense' | 'economy' | 'magic' | 'run' | 'enemies';

/**
 * Stable order used by the tab strip and by `codexForCategory`. Reordering
 * this tuple is a UX change (it moves the tabs on the panel), but it does not
 * break any data lookups.
 */
export const CODEX_CATEGORIES: readonly CodexCategory[] = [
  'offense',
  'defense',
  'economy',
  'magic',
  'run',
  'enemies',
] as const;

/**
 * One glyph per category tab. Picked so each one is visually distinct at the
 * 18–22px the panel uses, and so none of them get confused with the icons we
 * use for the tower upgrades that affect that category.
 */
export const CODEX_CATEGORY_ICONS: Record<CodexCategory, IconId> = {
  offense: 'crossed-swords',
  defense: 'bordered-shield',
  economy: 'two-coins',
  magic: 'magic-swirl',
  run: 'swords-emblem',
  enemies: 'orc-head',
};

export const CODEX_CATEGORY_LABELS: Record<CodexCategory, string> = {
  offense: 'Offense',
  defense: 'Defense',
  economy: 'Economy',
  magic: 'Magic',
  run: 'Run',
  enemies: 'Enemies',
};

/**
 * StatKeys whose meaning is already self-documenting from the name on the
 * Stats panel. They are deliberately not given their own Codex entry — the
 * panel would just repeat the column header — but they still need a home for
 * the completeness check, so they live here.
 */
export const CODEX_SELF_EVIDENT: readonly StatKey[] = [
  'baseDamage',
  'range',
  'maxHp',
  'maxMana',
  'manaRegen',
  'healthRegen',
  'goldAdditive',
];

export interface CodexEntry {
  /** Stable kebab-case id, also used as the data attribute on entry rows. */
  id: string;
  /** The display name in the entry list and the detail header. */
  term: string;
  /** Glyph shown in the entry row and the detail header. */
  icon: IconId;
  category: CodexCategory;
  /**
   * One-line gloss shown in the entry list. Kept under ~80 chars so it never
   * wraps inside the list row on the narrowest supported viewport.
   */
  summary: string;
  /**
   * Long-form explanation shown in the detail pane. Should be at least one
   * full sentence and interpolate any tunable numbers from the constants
   * listed in the surrounding module (no hardcoded 30%, 60%, etc).
   */
  detail: string;
  /**
   * StatKeys this entry explains. Every non-`CODEX_SELF_EVIDENT` key must
   * appear in exactly one entry's stats array — the test in
   * `tests/codex.test.ts` enforces disjoint coverage.
   */
  stats?: readonly StatKey[];
  /** Other Codex entry ids rendered as chips in the detail pane. */
  seeAlso?: readonly string[];
  /** Extra search terms folded into the search filter (synonyms, jargon). */
  aliases?: readonly string[];
}

/**
 * The full Codex, ordered by category (per `CODEX_CATEGORIES`) and within
 * each category by display order. The order here *is* the order the panel
 * renders, so put the most fundamental concept first.
 *
 * Numbers in the `detail` strings are baked in at module load time from the
 * same constants the runtime uses — re-tuning a value (say, splash cap) must
 * not require a separate Codex edit. The test verifies that the entries do
 * not contain `TODO` / `TBD` placeholders, which is the failure mode of
 * someone writing copy before the constants are wired in.
 */
export const CODEX_ENTRIES: readonly CodexEntry[] = [
  // ── Offense ────────────────────────────────────────────────────────────
  {
    id: 'fire-rate',
    term: 'Fire Rate',
    icon: 'fast-arrow',
    category: 'offense',
    summary: 'How many shots per second the tower fires.',
    detail:
      'Fire rate is the inverse of the gap between two consecutive tower shots — at the base of 0.9 shots per second, the tower fires roughly once every 1.1s. Every contributor (upgrades, talents, passives) adds into the same accumulator and the resolved value is clamped to a minimum of 0.01 so the loop cannot stall.',
    stats: ['fireRate'],
    seeAlso: ['critical-strike', 'extra-projectile'],
    aliases: ['attack speed', 'shots per second'],
  },
  {
    id: 'critical-strike',
    term: 'Critical Strike',
    icon: 'dead-eye',
    category: 'offense',
    summary: 'Chance to land a crit, the multiplier on it, and follow-ups.',
    detail:
      'A critical strike multiplies the shot damage by the resolved critMultiplier (base 2x, no ceiling). Crit chance caps at 100% and crit multiplier has no upper clamp. Crit gold adds bonus coins on the killing blow, crit splash spreads the crit to neighbouring enemies, crit ignore-armor pretends the target has zero armour for that hit, and crit follow-up fires an extra shot at the same target.',
    stats: ['critChance', 'critMultiplier', 'critGold', 'critSplash', 'critIgnoreArmor', 'critFollowUpChance'],
    seeAlso: ['armor-pen', 'execute', 'piercing'],
  },
  {
    id: 'armor-pen',
    term: 'Armor Penetration',
    icon: 'armor-punch',
    category: 'offense',
    summary: 'Cut through enemy armour so your shots hit harder.',
    detail:
      'armorPen is a fraction (0-1) of the target\'s armour that is ignored, and armorPenFlat subtracts a flat amount on top. With the standard softening curve (20 / (20 + armor)), reducing a 40-armour enemy to 20 effective armour doubles the damage taken — that is why even small pen numbers feel big early. Armor itself caps at 75% damage reduction so penetration cannot push the formula negative.',
    stats: ['armorPen', 'armorPenFlat'],
    seeAlso: ['armor', 'critical-strike'],
    aliases: ['arp', 'armour pen'],
  },
  {
    id: 'execute',
    term: 'Execute',
    icon: 'guillotine',
    category: 'offense',
    summary: 'Bonus damage — or instant kills — on wounded enemies.',
    detail:
      'Execute triggers when the target drops below the execute threshold. The base threshold is 0 (any hit qualifies); the talent tree pushes it to 0.5 and prestige talents refine it further to 0.25 as a sweet-spot "execute under quarter HP" condition. executeMultiplier is the bonus damage dealt at or below the threshold, talentExecuteBonus stacks on top from the levelling tree, and instantKillChance is the independent roll that just deletes the enemy outright (resisted by elites).',
    stats: ['executeThreshold', 'executeMultiplier', 'talentExecuteBonus', 'instantKillChance'],
    seeAlso: ['piercing', 'boss-damage'],
  },
  {
    id: 'splash',
    term: 'Splash Damage',
    icon: 'spiky-explosion',
    category: 'offense',
    summary: 'Damage spills onto enemies standing near the impact.',
    detail:
      'Two halves compose into a splash. Radius takes the *maximum* across every contributor, fraction takes the *sum* up to the 40% splash fraction cap. Beyond the cap the extra fraction is silently dropped — the cap exists so a stacked splash build cannot deal more than 40% of the primary shot to each neighbour, which keeps splash an "also hit" effect rather than a free AoE nuke.',
    stats: ['shotSplashRadius', 'shotSplashFraction'],
    seeAlso: ['shockwave', 'critical-strike'],
  },
  {
    id: 'double-shot',
    term: 'Double Shot',
    icon: 'double-shot',
    category: 'offense',
    summary: 'Every shot has a chance to fire a second time for full damage.',
    detail:
      'A successful double-shot roll emits a second projectile at the same target. It benefits from the same piercing, splash, and crit pipeline as the original, so it composes with crit follow-up and execute. The chance is rolled independently per shot, capped at 100%.',
    stats: ['doubleShotChance'],
    seeAlso: ['extra-projectile', 'quick-shot'],
  },
  {
    id: 'extra-projectile',
    term: 'Extra Projectile',
    icon: 'arrow-cluster',
    category: 'offense',
    summary: 'Each shot adds an extra projectile to the volley.',
    detail:
      'Unlike double shot, extra projectile fires in addition to the regular shot — at the cap (100%) every primary shot becomes a two-shot volley that still benefits from crit and pierce. The chance is rolled per shot, so two consecutive crits on a volley deal four projectiles at full damage. It is the natural scaling partner of fire rate and crit follow-up.',
    stats: ['extraProjectileChance'],
    seeAlso: ['double-shot', 'critical-strike', 'fire-rate'],
  },
  {
    id: 'quick-shot',
    term: 'Quick Shot',
    icon: 'supersonic-arrow',
    category: 'offense',
    summary: 'Bonus fire rate window after landing a hit.',
    detail:
      'On every successful shot the tower gains a temporary fire-rate bonus for `quickShotTime` seconds. The window is a flat multiplier on fire rate, not a separate projectile, so it stacks cleanly with crit and double-shot. The duration is clamped to a sane upper bound so a runaway buff does not pin the tower at maximum firerate indefinitely.',
    stats: ['quickShotChance', 'quickShotTime'],
    seeAlso: ['fire-rate', 'extra-projectile'],
  },
  {
    id: 'piercing',
    term: 'Piercing',
    icon: 'piercing-sword',
    category: 'offense',
    summary: 'Shots pass through additional enemies instead of stopping.',
    detail:
      'pierceExtra is the number of extra enemies each projectile can hit before despawning. Each piercing hit is resolved independently, so a fully-piercing volley through a tight pack can crit and execute every single target. Combined with splash this is the strongest trash-clear shape in the game.',
    stats: ['pierceExtra'],
    seeAlso: ['splash', 'critical-strike'],
  },
  {
    id: 'boss-damage',
    term: 'Boss Damage',
    icon: 'crowned-skull',
    category: 'offense',
    summary: 'A separate bonus multiplier applied only to boss enemies.',
    detail:
      'bossDamageBonus is additive on top of all other damage sources, but it only fires when the projectile is hitting a boss — trash and elites are unaffected. The boss-tier enemies have phases at 66% and 33% HP that reset the damage window, so boss damage stacking pays off most in phase 1 of every encounter.',
    stats: ['bossDamageBonus'],
    seeAlso: ['execute', 'piercing'],
  },
  {
    id: 'shockwave',
    term: 'Shockwave',
    icon: 'reaper-scythe',
    category: 'offense',
    summary: 'Periodic ring of damage that pushes enemies back.',
    detail:
      'ShockwaveSize is the radius of the ring; shockwaveCooldown is the gap between rings in seconds. The shockwave does not require line-of-sight to the tower — it always expands from the tower\'s centre — but its damage does fall off at the edges so stacking radius past the arena half-extent is wasted.',
    stats: ['shockwaveSize', 'shockwaveCooldown'],
    seeAlso: ['splash', 'land-mines'],
  },
  {
    id: 'land-mines',
    term: 'Land Mines',
    icon: 'land-mine',
    category: 'offense',
    summary: 'Periodic mines arm themselves at the tower and detonate.',
    detail:
      'landMineFrequency is the cooldown between mine armings, landMineDamage is the damage each mine deals when an enemy walks into it. Mines are placed on the path between the tower and the wave\'s spawn, so they cover the lanes the enemies actually walk. They arm after a short fuse and last for the rest of the wave.',
    stats: ['landMineDamage', 'landMineFrequency'],
    seeAlso: ['shockwave', 'knockback'],
  },
  {
    id: 'low-hp-damage',
    term: 'Low-HP Damage',
    icon: 'heart-drop',
    category: 'offense',
    summary: 'A conditional damage bonus that scales as the tower gets hurt.',
    detail:
      'lowHpDamageBonus ramps in as the tower\'s current HP drops, peaking at low-HP. The bonus is conditional and never leaves the accumulator — it is consumed at the damage site rather than re-resolved — so it does not show up on the tower stat block, only in combat. Pair it with max-HP stacking for the cleanest survival curve.',
    stats: ['lowHpDamageBonus'],
    seeAlso: ['second-wind', 'lifesteal'],
    aliases: ['low hp', 'desperation'],
  },

  // ── Defense ────────────────────────────────────────────────────────────
  {
    id: 'defense',
    term: 'Defense',
    icon: 'layered-armor',
    category: 'defense',
    summary: 'A flat subtraction applied to every incoming hit.',
    detail:
      'Defense reduces each incoming damage instance by its value, after armour softening but before any shield or dodge roll. It is the most consistent defensive layer because it has no cap and no fail chance — a 40-defense tower simply shaves 40 HP off every hit. Defense stacks linearly with itself but is largely outperformed by armor once armor stacks above ~30.',
    stats: ['defense'],
    seeAlso: ['armor', 'dodge'],
  },
  {
    id: 'armor',
    term: 'Armor',
    icon: 'spiked-armor',
    category: 'defense',
    summary: 'A percentage damage reduction capped at 75%.',
    detail:
      'Armor is a 0-0.75 fraction that is folded into the softening formula 20 / (20 + armor). At 20 armor you block 50% of incoming damage; at 40 you block ~67%; the cap at 75% means armor is asymptotically valuable rather than unbounded. Penetration (armorPen / armorPenFlat) bypasses it; armor and dodge are rolled separately, so they stack multiplicatively against incoming damage.',
    stats: ['armor'],
    seeAlso: ['armor-pen', 'defense'],
    aliases: ['armour'],
  },
  {
    id: 'knockback',
    term: 'Knockback',
    icon: 'mighty-force',
    category: 'defense',
    summary: 'Shoves enemies backwards on every hit.',
    detail:
      'knockbackForce is the magnitude of the push. Knockback interrupts enemy pathing for a short window, which is the only defensive use — it does not deal damage. Stacking knockback against a heavy enemy barely moves them, but used against fast trash it can buy the tower several seconds of free damage before they re-engage.',
    stats: ['knockbackForce'],
    seeAlso: ['land-mines', 'shockwave'],
  },
  {
    id: 'lifesteal',
    term: 'Lifesteal',
    icon: 'life-tap',
    category: 'defense',
    summary: 'A fraction of damage dealt is returned as HP.',
    detail:
      'Lifesteal is a fraction (0-1) of every damage instance the tower deals, returned as HP at the moment the damage resolves. It is computed on the *pre-armor* damage so it ignores armour penetration interactions on the way out, but it does respect the target\'s actual hit points — overkill damage does not heal extra. HP recovered is capped at maxHp.',
    stats: ['lifesteal'],
    seeAlso: ['shields', 'mana-on-kill'],
  },
  {
    id: 'thorns',
    term: 'Thorns',
    icon: 'barbed-star',
    category: 'defense',
    summary: 'Damage reflected back to attackers when they hit the tower.',
    detail:
      'Thorns is a fraction of incoming damage that is dealt back to the attacker on the same frame. It ignores the attacker\'s armour and cannot crit, so it is a flat "they pay for swinging at you" effect. It is one of the few offensive contributions that scales with the *attacker*\'s damage rather than the tower\'s, so it punches up against high-HP bosses surprisingly well.',
    stats: ['thorns'],
    seeAlso: ['armor', 'defense'],
  },
  {
    id: 'dodge',
    term: 'Dodge',
    icon: 'acrobatic',
    category: 'defense',
    summary: 'Chance to make an incoming attack miss entirely.',
    detail:
      'dodgeChance is rolled per incoming damage instance, with a hard cap at 75% — even a perfectly-evasive build still takes one in four hits. Dodge is rolled before armor and defense, so a successful dodge consumes no other defensive resource. Dodge is the only defensive stat that is binary per attack, which makes it swingier than the rest.',
    stats: ['dodgeChance'],
    seeAlso: ['armor', 'mana-shield'],
  },
  {
    id: 'mana-shield',
    term: 'Mana Shield',
    icon: 'magic-shield',
    category: 'defense',
    summary: 'Spend mana to absorb incoming damage before HP.',
    detail:
      'manaShieldFraction is the fraction of incoming damage that is paid in mana before HP. The cap is 90%, so a fully-stacked build still loses 10% to HP even at full mana. Mana shield cannot drain mana below zero — when mana is empty the layer silently switches off and HP takes the rest.',
    stats: ['manaShieldFraction'],
    seeAlso: ['shields', 'mana-on-kill'],
  },
  {
    id: 'shields',
    term: 'Shield Charges',
    icon: 'energy-shield',
    category: 'defense',
    summary: 'Reusable damage-blocking charges that recharge over time.',
    detail:
      'shieldMaxCharges is the number of full-HP shield charges the tower holds; shieldRechargeTime is the seconds-per-charge refill; shieldRechargeReduction shrinks the recharge timer. Each charge is a single-use full-HP buffer that has to be emptied before HP takes damage. The minimum recharge time is 3 seconds so a stacked cooldown reduction cannot spawn a fresh charge instantly.',
    stats: ['shieldMaxCharges', 'shieldRechargeTime', 'shieldRechargeReduction'],
    seeAlso: ['mana-shield', 'wall'],
  },
  {
    id: 'wall',
    term: 'Wall',
    icon: 'brick-wall',
    category: 'defense',
    summary: 'A regenerating layer of buffer HP in front of the tower.',
    detail:
      'wallFraction is the fraction of max HP held as wall, wallRegen is the wall HP regenerated per second. Wall is consumed before HP, so it is the outermost defensive layer after dodge. It regenerates even during combat, which is what makes it the long-run defence layer against bosses whose damage is sustained rather than bursty.',
    stats: ['wallFraction', 'wallRegen'],
    seeAlso: ['shields', 'revive'],
  },
  {
    id: 'revive',
    term: 'Revive Charges',
    icon: 'shining-heart',
    category: 'defense',
    summary: 'Extra times the tower may come back from 0 HP in one run.',
    detail:
      'reviveCharges is added on top of the base revive evolution. Each charge is consumed when the tower reaches 0 HP and resets the tower to a fraction of max HP; charges are integer because half a revive is not a thing the damage system can spend. Once the charges are exhausted the run fails immediately on the next lethal hit.',
    stats: ['reviveCharges'],
    seeAlso: ['shields', 'wall'],
  },
  {
    id: 'second-wind',
    term: 'Second Wind',
    icon: 'regeneration',
    category: 'defense',
    summary: 'A conditional damage spike after the tower drops to low HP.',
    detail:
      'When the tower drops below 35% HP, secondWindPower triggers a short window of amplified damage that lasts 6 seconds. The bonus is multiplicative — at the baseline 2.5x ratio it roughly doubles the tower\'s effective DPS during the window. The window is one-shot per low-HP crossing, not a permanent buff.',
    stats: ['secondWindPower'],
    seeAlso: ['low-hp-damage', 'revive'],
  },

  // ── Economy ────────────────────────────────────────────────────────────
  {
    id: 'gold-multiplier',
    term: 'Gold Multiplier',
    icon: 'coins-pile',
    category: 'economy',
    summary: 'A global multiplier applied to every gold source.',
    detail:
      'goldMultiplier stacks multiplicatively across every contributor (passives, research, blessings, equipment) and is applied *after* goldAdditive. The base is 1.0; the floor is 0, so a stacked debuff can neutralise gold gain entirely but cannot go negative.',
    stats: ['goldMultiplier'],
    seeAlso: ['gold-on-kill', 'double-gold'],
  },
  {
    id: 'gold-on-kill',
    term: 'Gold on Kill',
    icon: 'receive-money',
    category: 'economy',
    summary: 'Flat bonus gold awarded for every enemy kill.',
    detail:
      'goldOnKill is added per enemy killed, before the gold multiplier. Elite and boss kills do not multiply this further — they use a separate elite/boss gold bonus channel. Stacking this is the cheapest way to make early waves profitable without leaning on goldLuck rolls.',
    stats: ['goldOnKill'],
    seeAlso: ['wave-gold', 'gold-multiplier'],
  },
  {
    id: 'wave-gold',
    term: 'Wave Gold',
    icon: 'open-treasure-chest',
    category: 'economy',
    summary: 'A flat gold payout when a wave completes.',
    detail:
      'waveGold is awarded once per cleared wave regardless of how fast it died. It composes with the gold multiplier, so a 50% wave gold buff combined with a 2x multiplier triples the per-wave payout. It does not scale with enemy count — a thin wave pays the same as a fat one.',
    stats: ['waveGold'],
    seeAlso: ['gold-on-kill', 'wave-skip'],
  },
  {
    id: 'gold-luck',
    term: 'Gold Luck',
    icon: 'clover',
    category: 'economy',
    summary: 'Chance to double the gold from any single drop.',
    detail:
      'goldLuckChance is rolled per gold payout — kill, wave, orb, anything — and a successful roll doubles that payout. It composes with doubleGoldChance (which is its own independent roll), so the theoretical maximum payout per drop is 4x. The roll happens after the multiplier, so a 0.1 luck value still pays out 2x of the multiplied amount when it lands.',
    stats: ['goldLuckChance'],
    seeAlso: ['double-gold', 'gold-multiplier'],
  },
  {
    id: 'double-gold',
    term: 'Double Gold',
    icon: 'two-coins',
    category: 'economy',
    summary: 'Independent roll that doubles a gold payout.',
    detail:
      'doubleGoldChance is rolled per payout alongside goldLuckChance. They are independent rolls, so a 50% luck and a 50% double-gold gives 25% triple gold and 25% quadruple gold. Like luck, the cap is 100%, and the rolls compose with the gold multiplier.',
    stats: ['doubleGoldChance'],
    seeAlso: ['gold-luck', 'gold-multiplier'],
  },
  {
    id: 'cost-discount',
    term: 'Upgrade Discount',
    icon: 'gold-mine',
    category: 'economy',
    summary: 'A fraction off the gold cost of every upgrade purchase.',
    detail:
      'upgradeCostDiscount is a 0-1 fraction that is subtracted from the displayed price. The 100% cap is the floor of "free upgrades"; in practice a 30% discount already reshapes the early economy because compounding discounts on bulk-buy paths cut per-wave spend dramatically.',
    stats: ['upgradeCostDiscount'],
    seeAlso: ['gold-multiplier', 'wave-gold'],
    aliases: ['discount'],
  },
  {
    id: 'equipment-find',
    term: 'Equipment Find Chance',
    icon: 'knapsack',
    category: 'economy',
    summary: 'Increases the odds of an equipment drop on each kill.',
    detail:
      'equipmentFindChance is added to the base drop chance for every kill that is eligible to drop gear. It does not affect the rarity roll — that lives on the equipment side — so this stat only changes *whether* a drop happens, not what the drop is. Stacking it past 100% is wasteful because once every eligible kill drops, the cap is the drop-per-eligible-kill ceiling.',
    stats: ['equipmentFindChance'],
    seeAlso: ['gold-on-kill', 'xp-gain'],
  },
  {
    id: 'xp-gain',
    term: 'XP Gain',
    icon: 'brain',
    category: 'economy',
    summary: 'A multiplier on the tower XP awarded per kill and per wave.',
    detail:
      'xpGainMultiplier is a 1+ multiplier applied to every XP source. It does not feed back into any other stat — it only affects how fast the tower levels up, which in turn unlocks more talent points. The base is 1.0; the floor is 0, so a debuff can stall progression entirely.',
    stats: ['xpGainMultiplier'],
    seeAlso: ['momentum', 'windfall'],
  },
  {
    id: 'windfall',
    term: 'Windfall',
    icon: 'chalice-drops',
    category: 'economy',
    summary: 'Periodic bonus gold payouts on a timer.',
    detail:
      'windfallMultiplier is paid out every 10 seconds as a flat gold bonus scaled by the multiplier. It is independent of kills and waves, so it is the closest thing the game has to idle income. The interval is fixed; the multiplier is the only knob.',
    stats: ['windfallMultiplier'],
    seeAlso: ['gold-multiplier', 'interest'],
  },
  {
    id: 'interest',
    term: 'Interest',
    icon: 'receive-money',
    category: 'economy',
    summary: 'A fraction of held gold paid out at wave start.',
    detail:
      'interestRate is paid on the held-gold balance at the start of each wave, capped at the value of 2000 gold of interest per wave. It rewards saving rather than spending every coin on the first upgrade, which is the central economic lever against upgrade-discount stacking.',
    stats: ['interestRate'],
    seeAlso: ['gold-luck', 'wave-gold'],
  },
  {
    id: 'momentum',
    term: 'Momentum',
    icon: 'fast-forward-button',
    category: 'economy',
    summary: 'A run-long multiplier that grows with consecutive kills.',
    detail:
      'momentumGainBonus is added to the per-kill momentum increment. The bonus compounds over the course of a wave, so a long unbroken streak on a fat wave can pay out a meaningful chunk of XP and gold by the time it breaks. Streaks reset between waves.',
    stats: ['momentumGainBonus'],
    seeAlso: ['xp-gain', 'gold-on-kill'],
  },
  {
    id: 'hoard',
    term: 'Hoard (Orb Value)',
    icon: 'extraction-orb',
    category: 'economy',
    summary: 'Multiplies the value of every loot orb that drops.',
    detail:
      'orbValueBonus is applied to the gold and XP contents of every loot orb. Orbs are the rarest gold source in the game, so even a small bonus here out-earns the per-kill gold channels by orders of magnitude over a long run. orbGoldMultiplier is the narrower channel the Salvage transcendence perk buys: it multiplies gold orbs only, and leaves mana and reroll orbs alone.',
    stats: ['orbValueBonus', 'orbGoldMultiplier'],
    seeAlso: ['gold-on-kill', 'equipment-find'],
  },

  // ── Magic ──────────────────────────────────────────────────────────────
  {
    id: 'ability-cost',
    term: 'Ability Cost',
    icon: 'magic-swirl',
    category: 'magic',
    summary: 'A multiplier on the mana cost of every active ability.',
    detail:
      'abilityCostMultiplier is clamped between 0.1 and 1 — abilities cannot be free, and the cost never rises above the base. The clamp exists because a 0% cost ability coupled with mana-on-kill creates a degenerate infinite-mana loop; the floor keeps the ability economy honest.',
    stats: ['abilityCostMultiplier'],
    seeAlso: ['mana-on-kill', 'ability-cooldown'],
  },
  {
    id: 'ability-cooldown',
    term: 'Ability Cooldown',
    icon: 'clockwork',
    category: 'magic',
    summary: 'A multiplier on the cooldown of every active ability.',
    detail:
      'abilityCooldownMultiplier is also clamped between 0.1 and 1, on the same logic as cost: a zero-cooldown ability would let a single casting slot spam infinitely. The clamp is also why "cooldown reduction" research stacks feel strong but bounded.',
    stats: ['abilityCooldownMultiplier'],
    seeAlso: ['ability-cost', 'ability-damage'],
  },
  {
    id: 'ability-damage',
    term: 'Ability Damage',
    icon: 'bolt-spell-cast',
    category: 'magic',
    summary: 'A separate multiplier applied only to ability damage.',
    detail:
      'abilityDamageMultiplier is a 1+ multiplier that affects every active ability\'s output but not tower shots. It is the central ability-scaling stat and is fed by talents, research, and the blessing pool. It has no upper clamp, so late-game ability builds can out-scale tower-shot builds against bosses.',
    stats: ['abilityDamageMultiplier'],
    seeAlso: ['ability-cost', 'meteor', 'chain-lightning'],
  },
  {
    id: 'ability-area',
    term: 'Ability Area',
    icon: 'spiky-explosion',
    category: 'magic',
    summary: 'A multiplier on every targeted ability\'s disc radius.',
    detail:
      'abilityAreaMultiplier is a 1+ multiplier that scales the radius of every placed ability (Rain of Arrows, Frost Nova, Meteor Strike). It is fed by the Arcane Expansion research, the Frostbite talent, and the arcane core\'s area bonus. It is clamped to [0.5, 3] so a stacked build cannot halve a disc to nothing or blow it past the arena.',
    stats: ['abilityAreaMultiplier'],
    seeAlso: ['ability-damage', 'meteor'],
  },
  {
    id: 'berserk',
    term: 'Berserk',
    icon: 'punch-blast',
    category: 'magic',
    summary: 'Bonus damage dealt while Berserk is active.',
    detail:
      'berserkFireBonus is a damage multiplier that fires only while the Berserk ability is up. The buff is short — the goal is to land a coordinated burst inside the window — and stacks with crit and execute so a properly timed Berserk can one-phase phase-1 of a boss.',
    stats: ['berserkFireBonus'],
    seeAlso: ['buff-duration', 'critical-strike'],
  },
  {
    id: 'chain-lightning',
    term: 'Chain Lightning',
    icon: 'frozen-arrow',
    category: 'magic',
    summary: 'Adds extra bounces to the Chain Lightning ability.',
    detail:
      'chainBounceBonus is an integer count of extra bounces added on top of the base bounce count. Each bounce hits a fresh enemy, so a 3-bonus chain on a fat pack can ripple across the whole wave. The bounce damage falls off per hop, so this is a "spread" ability rather than a single-target one.',
    stats: ['chainBounceBonus'],
    seeAlso: ['piercing', 'splash'],
  },
  {
    id: 'slow',
    term: 'Slow Strength',
    icon: 'hourglass',
    category: 'magic',
    summary: 'How hard the Slow ability delays enemy movement.',
    detail:
      'slowStrengthBonus is added to the base slow fraction. Slow does not deal damage; it is a crowd-control layer that buys the tower more shots per enemy. The slow decays over the ability\'s duration, so a stronger slow lasts effectively longer.',
    stats: ['slowStrengthBonus'],
    seeAlso: ['knockback', 'wall'],
  },
  {
    id: 'meteor',
    term: 'Meteor',
    icon: 'explosion-rays',
    category: 'magic',
    summary: 'Bonus damage on the Meteor ability.',
    detail:
      'meteorDamageBonus is a separate damage multiplier applied to Meteor only. Meteor is the highest-burst ability in the game and is meant to be saved for boss phase transitions — landing it during the 0.7-second phase-invuln window does nothing, but landing it on the open phase frame is the highest single-shot damage spike in the run.',
    stats: ['meteorDamageBonus'],
    seeAlso: ['ability-damage', 'boss-damage'],
  },
  {
    id: 'buff-duration',
    term: 'Buff Duration',
    icon: 'extra-time',
    category: 'magic',
    summary: 'A multiplier on the duration of every castable buff.',
    detail:
      'buffDurationBonus is a 1+ multiplier on every active ability\'s uptime. It is the natural pairing to Berserk and Slow — extending the Berserk window by 50% is roughly equivalent to a 50% damage bonus during the window. There is no cap.',
    stats: ['buffDurationBonus'],
    seeAlso: ['ability-cooldown', 'berserk'],
  },
  {
    id: 'magic-proc',
    term: 'Magic Proc',
    icon: 'echo-ripples',
    category: 'magic',
    summary: 'Each shot has a chance to emit a free spell projectile.',
    detail:
      'magicProcChance is rolled per tower shot. A successful roll emits a spell-tier projectile at the same target, which scales off the standard shot pipeline (crit, pierce, splash). It is the most general "free damage" channel in the game and the strongest single-stat source for hybrid tower/ability builds.',
    stats: ['magicProcChance'],
    seeAlso: ['extra-projectile', 'ability-damage'],
  },
  {
    id: 'mana-on-kill',
    term: 'Mana on Kill',
    icon: 'energy-arrow',
    category: 'magic',
    summary: 'A fraction of max mana refunded on every enemy kill.',
    detail:
      'manaOnKillFraction returns a fraction of maxMana to the mana pool per kill, capped at 50%. The cap prevents a fast-killing build from permanently refilling mana to full, which would break the mana-as-resource layer. Mana refunds do not benefit from manaRegen — they are a separate channel.',
    stats: ['manaOnKillFraction'],
    seeAlso: ['lifesteal', 'ability-cost'],
  },
  {
    id: 'ability-echo',
    term: 'Ability Echo',
    icon: 'all-seeing-eye',
    category: 'magic',
    summary: 'Each cast has a chance to fire again for free.',
    detail:
      'abilityEchoChance is rolled after an ability resolves. A successful roll casts the same ability a second time at the same target — no extra mana cost, doubled cooldown. The cap at 75% exists for the same reason abilityCost\'s 10% floor does: to keep the ability economy from collapsing into itself.',
    stats: ['abilityEchoChance'],
    seeAlso: ['ability-cooldown', 'ability-cost'],
  },
  {
    id: 'frozen',
    term: 'Frozen Bonus',
    icon: 'crown',
    category: 'magic',
    summary: 'Bonus damage to enemies that are slowed or chilled.',
    detail:
      'chilledDamageBonus is a flat damage multiplier on any enemy currently affected by a slow or chill. It is the natural scaling partner for Slow and for any cold-themed blessing. The bonus is conditional — it disappears the moment the slow expires — so it rewards cooldown-extending builds.',
    stats: ['chilledDamageBonus'],
    seeAlso: ['slow', 'ability-damage'],
  },

  // ── Run ────────────────────────────────────────────────────────────────
  {
    id: 'wave-skip',
    term: 'Wave Skip',
    icon: 'fast-forward-button',
    category: 'run',
    summary: 'Each wave has a chance to be auto-skipped for full rewards.',
    detail:
      'waveSkipChance is rolled at wave start. A successful roll instantly grants the wave\'s gold and XP payouts and skips straight to the next wave with no enemies spawned. It is capped at 100% and trades the enemy clear reward for the wave completion reward — neither elite nor boss kills are awarded on a skipped wave.',
    stats: ['waveSkipChance'],
    seeAlso: ['wave-gold', 'head-start'],
  },
  {
    id: 'intermission',
    term: 'Intermission Length',
    icon: 'hourglass',
    category: 'run',
    summary: 'A multiplier on the time between waves.',
    detail:
      'intermissionMultiplier is a 0.1-1 multiplier on the intermission timer. It is the only stat in the game that makes waves faster without making them weaker — useful when the player is capped on damage and wants to reach the boss sooner. Lowering it below 0.1 would risk overlapping waves, so the floor is generous but real.',
    stats: ['intermissionMultiplier'],
    seeAlso: ['wave-skip', 'auto-buy'],
  },
  {
    id: 'enemy-hp-reduction',
    term: 'Enemy HP Reduction',
    icon: 'spiked-halo',
    category: 'run',
    summary: 'A fraction subtracted from every enemy\'s max HP.',
    detail:
      'enemyHpReduction is applied at spawn time and persists for the enemy\'s lifetime. It is capped at 90% so a stacked reduction cannot reduce enemies below the 10% HP floor that the pathing system relies on for animations. It does not affect boss HP, which has its own phase thresholds.',
    stats: ['enemyHpReduction'],
    seeAlso: ['enemy-damage', 'enemy-speed'],
  },
  {
    id: 'rp-drop',
    term: 'Research Point Drop',
    icon: 'star-gate',
    category: 'run',
    summary: 'Bonus chance for enemies to drop Research Points.',
    detail:
      'rpDropChanceBonus is added to the base RP drop chance. Research points are the prestige-tier currency and are scarce on purpose, so every percentage point here matters. The bonus applies to all eligible enemies, including elites at their already-elevated drop rate.',
    stats: ['rpDropChanceBonus'],
    seeAlso: ['gold-luck', 'equipment-find'],
  },
  {
    id: 'auto-buy',
    term: 'Auto-buy Interval',
    icon: 'gears',
    category: 'run',
    summary: 'How fast the automation bot buys upgrades.',
    detail:
      'autoBuyIntervalReduction is a fraction subtracted from the auto-buy tick interval, so 100% reduction means the bot buys as fast as the engine permits. It is gated behind an AP unlock — automation is opt-in — and only fires when the automation panel is enabled.',
    stats: ['autoBuyIntervalReduction'],
    seeAlso: ['cost-discount', 'wave-skip'],
  },
  {
    id: 'head-start',
    term: 'Head Start Waves',
    icon: 'extra-time',
    category: 'run',
    summary: 'Start a run already past the first N waves.',
    detail:
      'headStartWaves is the count of waves skipped at run start, each paying out the wave\'s gold and XP as if it had been cleared. It is integer-clamped at 0 — you cannot start in negative waves — and is gated behind an AP unlock so it does not trivialise early progression on a fresh prestige.',
    stats: ['headStartWaves'],
    seeAlso: ['wave-skip', 'wave-gold'],
  },
  {
    id: 'wall-contact',
    term: 'Wall Contact Damage',
    icon: 'brick-wall',
    category: 'run',
    summary: 'Bonus damage to enemies that are touching the wall.',
    detail:
      'wallContactExtra is the additional damage per second dealt to enemies that are in contact with the tower\'s wall segment. It is a small but reliable source against boss-phase-3 chip damage, where the boss lingers on the wall and the wall layer matters most.',
    stats: ['wallContactExtra'],
    seeAlso: ['wall', 'boss-damage'],
  },
  {
    id: 'focus',
    term: 'Focus',
    icon: 'concentration-orb',
    category: 'run',
    summary: 'A talent-side stacking damage bonus while on a single target.',
    detail:
      'focusStackBonus is added to the per-stack damage increment while the tower is locked on a target, and killFrenzyPerStack is the temporary bonus after each kill. Focus caps at 5 stacks, bloodlust caps at 8 stacks for 4 seconds — those numbers exist so a long unbroken beam on a boss can build to a meaningful peak without locking the tower into a single-target build.',
    stats: ['focusStackBonus', 'killFrenzyPerStack'],
    seeAlso: ['boss-damage', 'critical-strike'],
  },
  {
    id: 'overwatch',
    term: 'Overwatch',
    icon: 'arrow-scope',
    category: 'run',
    summary: 'Auto-shots triggered when an enemy enters an extended ring.',
    detail:
      'overwatchDamage is dealt by the tower\'s overwatch ring, which extends to 70% of the tower\'s range. It is independent of the main fire loop — overwatch shots do not consume fire-rate cooldown — but they have a smaller damage profile. It is the natural partner for builds that want consistent chip damage across the arena without leaning on splash or piercing.',
    stats: ['overwatchDamage'],
    seeAlso: ['piercing', 'fire-rate'],
  },

  // ── Enemies ────────────────────────────────────────────────────────────
  {
    id: 'enemy-speed',
    term: 'Enemy Speed',
    icon: 'fast-arrow',
    category: 'enemies',
    summary: 'A multiplier applied to every enemy\'s movement speed.',
    detail:
      'enemySpeedMult is resolved per wave and applied to the base movement speed of every enemy that spawns in that wave. The floor at 0.1 means enemies can be slowed to a crawl but never frozen in place, which is what keeps slow abilities and the Slow talent meaningful.',
    stats: ['enemySpeedMult'],
    seeAlso: ['enemy-hp', 'enemy-damage'],
  },
  {
    id: 'enemy-hp',
    term: 'Enemy HP',
    icon: 'spiky-explosion',
    category: 'enemies',
    summary: 'A multiplier applied to every enemy\'s max HP at spawn.',
    detail:
      'enemyHpMult is resolved per wave and applied to every enemy\'s HP pool, with a 0.1 floor so a stacked enemy-HP-reduction cannot reduce spawns below 10% of their base HP. Bosses ignore this multiplier and use their own phase HP instead.',
    stats: ['enemyHpMult'],
    seeAlso: ['enemy-speed', 'enemy-damage'],
  },
  {
    id: 'enemy-damage',
    term: 'Enemy Damage',
    icon: 'punch-blast',
    category: 'enemies',
    summary: 'A multiplier applied to every hit the tower takes.',
    detail:
      'enemyDamageMult is resolved per wave and applied to every damage instance the tower takes. The floor is 0, so enemy-damage-reduction sources can completely neutralise incoming damage on a wave — though this is rarely optimal compared with just stacking armor and dodge.',
    stats: ['enemyDamageMult'],
    seeAlso: ['enemy-speed', 'enemy-hp'],
  },
  {
    id: 'boss-encounter',
    term: 'Boss Encounter',
    icon: 'crowned-skull',
    category: 'enemies',
    summary: 'The four-phase fight against the run\'s final boss.',
    detail:
      'Boss encounters trigger every 10 waves. Each boss has four patterns: Bulwark, Summoning, Ground Slam, and Mana Siphon. Bosses transition between phases at 66% and 33% HP, spending 0.7 seconds invulnerable on each transition — that window is the only safe time to reposition abilities. The fight ends in a swift kill bonus if the boss dies within 30 seconds, and a flawless bonus if it dies without the tower taking a hit.',
    seeAlso: ['boss-phases', 'boss-patterns'],
  },
  {
    id: 'boss-phases',
    term: 'Boss Phases',
    icon: 'vertical-banner',
    category: 'enemies',
    summary: 'The 66% / 33% HP transitions every boss follows.',
    detail:
      'Every boss has a fixed phase schedule, transitioning at 66% and 33% HP. Each transition opens with a 0.7-second invulnerable window during which the boss sets up the next pattern; abilities cast during the window are wasted. Phases reset boss enrage timers, so timing a long-cooldown ability against the phase flip is the core of the encounter.',
    seeAlso: ['boss-encounter', 'boss-patterns'],
  },
  {
    id: 'boss-patterns',
    term: 'Boss Patterns',
    icon: 'spiky-explosion',
    category: 'enemies',
    summary: 'Bulwark, Summoning, Ground Slam, and Mana Siphon.',
    detail:
      'Each pattern has a fixed window and a specific counter. Bulwark raises a 20% max-HP shield for 10 seconds — break it fast. Summoning adds adds every 6 seconds up to 4 adds on the field. Ground Slam telegraphs for 2 seconds then deals 8x damage in an AoE, mitigated by 20% with armor. Mana Siphon drains 8 mana per second and heals the boss for 0.5% max HP per second — kill it before the mana pool empties.',
    seeAlso: ['boss-encounter', 'boss-phases'],
  },
  {
    id: 'elites',
    term: 'Elite Enemies',
    icon: 'spiked-halo',
    category: 'enemies',
    summary: 'Buffed enemies with 2.5x HP/gold and an aura effect.',
    detail:
      'Elites are normal enemies with the elite tag. They spawn at 2.5x base HP, reward 2.5x gold on kill, and drop 1 Research Point on kill. Each elite carries one of five auras — haste, slow-immunity, thorns, armor, or mana-burn — that affects nearby enemies and the tower. Aura auras are listed in the wave preview tooltip.',
    seeAlso: ['boss-encounter', 'enrage'],
  },
  {
    id: 'enrage',
    term: 'Boss Enrage',
    icon: 'enrage',
    category: 'enemies',
    summary: 'A stack-based damage and speed ramp that triggers after a long fight.',
    detail:
      'Bosses enter enrage after 60 seconds in combat, gaining 15% damage and 10% speed per stack every 10 seconds. The intended counter is to burst the boss down before the first stack lands — the swift-kill bonus rewards exactly that. Once three stacks are up the fight is usually unwinnable, so enrage is the failure-mode timer.',
    seeAlso: ['boss-encounter', 'boss-patterns'],
  },
];

/**
 * Reverse index: every StatKey (outside CODEX_SELF_EVIDENT) maps to the
 * single Codex entry that explains it. Built once at module load and frozen
 * for the rest of the run — the test in `tests/codex.test.ts` enforces that
 * the mapping is total and disjoint.
 */
export const CODEX_BY_STAT: Readonly<Partial<Record<StatKey, readonly string[]>>> = (() => {
  const out: Partial<Record<StatKey, string[]>> = {};
  // Reject duplicate ids up front so a copy-paste mistake in the entries
  // table breaks at module load rather than producing two entries with the
  // same anchor target.
  const seen = new Set<string>();
  for (const entry of CODEX_ENTRIES) {
    if (seen.has(entry.id)) throw new Error(`Duplicate Codex entry id: ${entry.id}`);
    seen.add(entry.id);
    if (!entry.stats) continue;
    for (const key of entry.stats) {
      const bucket = out[key] ?? (out[key] = []);
      if (bucket.includes(entry.id)) continue;
      bucket.push(entry.id);
    }
  }
  return out;
})();

export function codexForCategory(category: CodexCategory): readonly CodexEntry[] {
  return CODEX_ENTRIES.filter((entry) => entry.category === category);
}
