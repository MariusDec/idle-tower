import { EVOLUTION_OF } from '../content/evolutions';
import type { FusionId, PassiveId, WeaponId } from '../content/types';
import type { Card } from '../sim/state';
import { cardFace } from './draft';
import { bindLongPress } from './longPress';

/**
 * Hold a build chip to see its card (U3): the same face the draft drew, for
 * what the chip stands for now. One binding per host covers every strip it
 * will ever hold (the HUD's, the pause menu's, the results'), however often
 * they redraw.
 */

/** What a chip stands for, as a card: `buildChips` writes it on the chip. */
function chipCard(el: HTMLElement): Card | null {
  const { kind, id, level, fusion } = el.dataset;
  if (!id) return null;
  if (kind === 'passive') return { kind: 'passive', id: id as PassiveId, level: Number(level) };
  if (kind !== 'weapon') return null;
  if (fusion) return { kind: 'fusion', id: fusion as FusionId };
  if (el.classList.contains('is-evolved')) return { kind: 'evolution', id: EVOLUTION_OF[id as WeaponId].id };
  return { kind: 'weapon', id: id as WeaponId, level: Number(level) };
}

/** Bind hold-to-peek on `host`'s build chips; the card shows in `layer` until the finger lifts. */
export function bindBuildPeek(host: HTMLElement, layer: HTMLElement): () => void {
  let shown: HTMLElement | null = null;
  const clear = (): void => {
    shown?.remove();
    shown = null;
  };
  const unbind = bindLongPress(host, {
    selector: '.build-chip',
    onLongPress: (chip) => {
      clear();
      const card = chipCard(chip);
      if (!card) return;
      const face = cardFace(card, { owned: true });
      face.tabIndex = -1;
      const box = document.createElement('div');
      box.className = 'build-peek';
      box.setAttribute('role', 'tooltip');
      box.append(face);
      layer.append(box);
      // Above the chip, centred on it, kept on screen.
      const at = chip.getBoundingClientRect();
      const frame = layer.getBoundingClientRect();
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      const x = Math.min(Math.max(8, at.left + at.width / 2 - w / 2 - frame.left), frame.width - w - 8);
      const above = at.top - frame.top - h - 8;
      const y = above >= 8 ? above : Math.min(at.bottom - frame.top + 8, frame.height - h - 8);
      box.style.left = `${Math.round(x)}px`;
      box.style.top = `${Math.round(y)}px`;
      shown = box;
    },
    onRelease: clear,
  });
  return () => {
    unbind();
    clear();
  };
}
