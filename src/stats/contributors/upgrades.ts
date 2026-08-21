import { world } from '../../data/arena';
import { UPGRADES } from '../../data/upgrades';
import { computeUpgradeValue } from '../../types';
import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/**
 * Tower upgrades — the additive backbone every other system multiplies on top
 * of. Each upgrade contributes to exactly one bucket; nothing here reads
 * another stat, so the order upgrades appear in `UPGRADES` cannot matter.
 */
export function contributeUpgrades(ctx: StatContext, acc: StatAccumulator): void {
  const a = acc.source('upgrade', 'Upgrades');
  for (const u of UPGRADES) {
    const level = ctx.upgrades[u.id] ?? 0;
    if (level <= 0) continue;
    const total = computeUpgradeValue(u, level);
    switch (u.id) {
      case 'damage': a.add('baseDamage', total, u.name); break;
      case 'fireRate': a.add('fireRate', total, u.name); break;
      case 'range': a.add('range', total, u.name); break;
      case 'critChance': a.add('critChance', total, u.name); break;
      case 'critDamage': a.add('critMultiplier', total, u.name); break;
      case 'manaRegen': a.add('manaRegen', total, u.name); break;
      case 'goldMulti': a.add('goldAdditive', total, u.name); break;
      case 'health': a.add('maxHp', total, u.name); break;
      case 'healthRegen': a.add('healthRegen', total, u.name); break;
      case 'defense': a.add('defense', total, u.name); break;
      case 'armor': a.add('armor', total, u.name); break;
      case 'lifesteal': a.add('lifesteal', total, u.name); break;
      case 'thorns': a.add('thorns', total, u.name); break;
      case 'shockwave':
        a.add('shockwaveSize', world(110 + (total - 1) * 5), u.name);
        a.add('shockwaveCooldown', total, u.name);
        break;
      case 'landMines':
        a.add('landMineDamage', total, u.name);
        a.add('landMineFrequency', Math.max(5, 15 - level / 10), u.name);
        break;
      case 'defenseShield':
        a.add('shieldRechargeTime', total, u.name);
        // Capped at five charges; the levels past that only shave recharge time.
        a.add('shieldMaxCharges', Math.min(5, Math.ceil(level / 11)), u.name);
        break;
      case 'maxMana': a.add('maxMana', total, u.name); break;
      case 'xpGain': a.add('xpGainMultiplier', total, u.name); break;
      case 'abilityCostReduction': a.add('abilityCostMultiplier', total, u.name); break;
      case 'upgradeDiscount': a.add('upgradeCostDiscount', total, u.name); break;
      case 'waveGold': a.add('waveGold', total, u.name); break;
      case 'goldOnKill': a.add('goldOnKill', total, u.name); break;
      case 'critGold': a.add('critGold', total, u.name); break;
      case 'doubleShotChance': a.add('doubleShotChance', total, u.name); break;
      case 'quickShotChance': a.add('quickShotChance', total, u.name); break;
      case 'quickShotTime': a.add('quickShotTime', total, u.name); break;
      case 'wall':
        a.add('wallFraction', total, u.name);
        // Enemies stop at the wall rather than the tower hull.
        a.add('wallContactExtra', world(36), u.name);
        break;
      default:
        break;
    }
  }
}
