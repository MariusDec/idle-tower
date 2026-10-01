import type { Profile } from '../../meta/profile';
import { formatNumber } from '../../core/format';
import { setText } from '../dom';

/**
 * The hub (§10.1). At P0 it is a title, the shard count and one button; the
 * Forge, Map, Collection, Feats and Settings tabs arrive with their phases.
 */
export class HubScreen {
  private readonly root: HTMLElement;
  private readonly shards: HTMLElement;
  private readonly best: HTMLElement;

  constructor(host: HTMLElement, onStart: () => void) {
    this.root = document.createElement('section');
    this.root.className = 'screen hub';
    // Two groups, above and below the centre, so the backdrop tower the
    // renderer draws there stays in the clear between them.
    this.root.innerHTML = `
      <div class="hub-group">
        <h1 class="hub-title">The Tower</h1>
        <p class="hub-sub">The Blight is closing in. Hold the light.</p>
      </div>
      <div class="hub-group">
        <dl class="hub-stats">
          <div><dt>Shards</dt><dd class="hub-shards">0</dd></div>
          <div><dt>Best wave</dt><dd class="hub-best">—</dd></div>
        </dl>
        <button type="button" class="btn btn-primary btn-big hub-start">Begin run</button>
      </div>`;
    this.shards = this.root.querySelector('.hub-shards')!;
    this.best = this.root.querySelector('.hub-best')!;
    this.root.querySelector('.hub-start')!.addEventListener('click', onStart);
    host.appendChild(this.root);
    this.hide();
  }

  show(profile: Profile): void {
    setText(this.shards, formatNumber(profile.shards));
    setText(this.best, profile.records.bestWave > 0 ? String(profile.records.bestWave) : '—');
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
