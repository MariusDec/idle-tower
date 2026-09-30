import type { RunState } from '../sim/state';
import { formatDuration } from '../core/format';

/**
 * The results screen (§4.6). One screen, no scrolling on mobile, no failure
 * language. At P0/P1 it shows the wave reached and the time; shards, records,
 * discoveries and the "Next:" bar arrive in P3.
 */
export class ResultsScreen {
  private readonly root: HTMLElement;
  private readonly headline: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly record: HTMLElement;

  constructor(host: HTMLElement, onHub: () => void, onAgain: () => void) {
    this.root = document.createElement('section');
    this.root.className = 'screen results';
    this.root.innerHTML = `
      <p class="results-headline"></p>
      <p class="results-record">New record</p>
      <p class="results-detail"></p>
      <div class="results-actions">
        <button type="button" class="btn results-hub">Hub</button>
        <button type="button" class="btn btn-primary results-again">Run again</button>
      </div>`;
    this.headline = this.root.querySelector('.results-headline')!;
    this.detail = this.root.querySelector('.results-detail')!;
    this.record = this.root.querySelector('.results-record')!;
    this.root.querySelector('.results-hub')!.addEventListener('click', onHub);
    this.root.querySelector('.results-again')!.addEventListener('click', onAgain);
    host.appendChild(this.root);
    this.hide();
  }

  show(run: RunState, newRecord: boolean): void {
    const end = run.outcome;
    const wave = end?.wave ?? run.wave;
    this.headline.textContent = end?.kind === 'retreat'
      ? `The tower withdraws. Wave ${wave}.`
      : `The light recedes. Wave ${wave}.`;
    this.detail.textContent = `Held for ${formatDuration(end?.time ?? run.time)}`;
    this.record.hidden = !newRecord;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
