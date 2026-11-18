import { segmented } from './controls';
import { iconMarkup } from './icon';

/**
 * The component specimen (plans/visual-identity.md §4): every base component
 * in the game's own classes, on the game's ground, beside a link to the shared
 * identity's `docs/visual-identity/preview.html` for comparison.
 *
 * Dev only. `src/app/main.ts` mounts it for `/?specimen` behind
 * `import.meta.env.DEV`, so a production build never ships it.
 */
export function mountSpecimen(host: HTMLElement): void {
  document.documentElement.dataset.quality = 'high';
  // The host's children only: the icon sprite lives on <body> and must stay.
  host.replaceChildren();
  host.classList.add('specimen-host');
  const page = document.createElement('main');
  page.className = 'specimen';
  page.innerHTML = `
    <header class="specimen-head">
      <p class="eyebrow">Specimen · plans/visual-identity.md §4</p>
      <h1 class="specimen-title">The Tower</h1>
      <p class="specimen-sub">Every base component, in the game's classes.
        Compare with <a class="specimen-link" href="/docs/visual-identity/preview.html">the identity's preview</a>.</p>
      <div class="specimen-ground"></div>
    </header>

    <section class="specimen-section">
      <h2 class="section-head">Buttons</h2>
      <div class="specimen-row">
        <button type="button" class="btn btn-primary btn-big">Begin run</button>
      </div>
      <div class="specimen-row">
        <button type="button" class="btn btn-primary">Run again</button>
        <button type="button" class="btn">Forge</button>
        <button type="button" class="btn btn-tertiary">Not now</button>
      </div>
      <div class="specimen-row">
        <button type="button" class="btn btn-sm">${iconMarkup('crystal-cluster', { size: 16 })} Claim</button>
        <button type="button" class="btn btn-danger">Erase save</button>
        <button type="button" class="btn btn-tertiary btn-danger">Delete backup</button>
        <button type="button" class="btn" disabled>Disabled</button>
      </div>
    </section>

    <section class="specimen-section">
      <h2 class="section-head">Surfaces</h2>
      <div class="glass specimen-pad">
        <p class="specimen-card-title">Card (glass)</p>
        <p class="specimen-meta">Hub cards, region rows, Feats rows · radius 12</p>
        <div class="inset specimen-pad-sm">Inset · a readout inside a card</div>
      </div>
      <div class="glass-solid specimen-pad">
        <p class="specimen-card-title">Solid glass</p>
        <p class="specimen-meta">Over the running arena: never blurs</p>
      </div>
      <div class="callout">
        <p class="callout-title">Why</p>
        <p class="specimen-meta">A callout: tips, the Next goal, an explainer. Never an accent outline.</p>
      </div>
      <div class="glass is-selected specimen-pad">
        <p class="specimen-card-title">Selected</p>
        <p class="specimen-meta">Strong glass and a 2px accent border</p>
      </div>
      <div class="sheet specimen-pad">
        <p class="specimen-card-title">Sheet</p>
        <p class="specimen-meta">The page gradient at 76%, blurred on the high tier · radius 16</p>
      </div>
    </section>

    <section class="specimen-section">
      <h2 class="section-head">Badges and chips</h2>
      <div class="specimen-row">
        <span class="badge badge-type badge-success">New</span>
        <span class="badge badge-type badge-accent">Suggested</span>
        <span class="badge">Recipe</span>
        <span class="badge badge-warning">Strong here</span>
        <span class="badge badge-error">Save failed</span>
        <span class="badge badge-gold">Legendary</span>
      </div>
      <div class="specimen-row">
        <span class="chip">${iconMarkup('trophy', { size: 18 })} First kill</span>
        <span class="chip">Wave 20 · record</span>
      </div>
    </section>

    <section class="specimen-section">
      <h2 class="section-head">Segmented control</h2>
      <div class="specimen-seg"></div>
      <div class="specimen-seg"></div>
    </section>

    <section class="specimen-section">
      <h2 class="section-head">Icon tiles and rows</h2>
      <div class="specimen-row">
        <span class="icon-tile specimen-arcane">${iconMarkup('crossed-swords')}</span>
        <span class="icon-tile specimen-gold">${iconMarkup('crystal-shine')}</span>
        <span class="icon-tile specimen-frost">${iconMarkup('droplets')}</span>
        <span class="icon-tile icon-tile-sm specimen-arcane">${iconMarkup('magic-swirl')}</span>
      </div>
      <div class="glass specimen-list-row">
        <span class="icon-tile specimen-gold">${iconMarkup('level-end-flag')}</span>
        <span class="specimen-list-text">
          <span class="specimen-card-title">Ashen Fields</span>
          <span class="specimen-meta">Region 1 · best wave 20 · cleared</span>
        </span>
        <span class="specimen-chevron" aria-hidden="true">›</span>
      </div>
    </section>

    <section class="specimen-section">
      <h2 class="section-head">Progress</h2>
      <div class="progress"><span class="progress-fill specimen-fill-40"></span></div>
      <div class="progress progress-lg"><span class="progress-fill specimen-fill-70"></span></div>
      <div class="progress is-met"><span class="progress-fill"></span></div>
      <svg class="ring specimen-ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle class="ring-track" cx="18" cy="18" r="15"></circle>
        <circle class="ring-fill" cx="18" cy="18" r="15" pathLength="100" stroke-dasharray="64 100"></circle>
      </svg>
    </section>

    <section class="specimen-section">
      <h2 class="section-head">The game's own components</h2>
      <ul class="entry-list">
        <li class="entry"><span class="entry-head">${iconMarkup('crossed-swords')}<span class="entry-name">An entry row</span></span>
          <p class="entry-text">Collection, Feats and Contracts rows.</p></li>
        <li class="entry feat is-ready"><span class="entry-head">${iconMarkup('trophy')}<span class="entry-name">A claimable feat</span></span>
          <div class="feat-bar"><div class="feat-fill"></div></div></li>
      </ul>
      <div class="hub-goal">
        <span class="hub-goal-label">Next</span>
        <span class="hub-goal-icon">${iconMarkup('crystal-cluster', { size: 18 })}</span>
        <span class="hub-goal-text">Sharpened Shot · 80 to go</span>
        <div class="hub-goal-bar"><div class="hub-goal-fill specimen-fill-40"></div></div>
      </div>
      <div class="specimen-row">
        <span class="draft-card-new">New</span>
        <span class="draft-card-suggested">Suggested</span>
        <span class="draft-card-badge">Completes</span>
        <span class="rift-rarity is-rare">Rare</span>
      </div>
      <ul class="results-rewards">
        <li class="results-reward is-feat">${iconMarkup('trophy', { size: 18 })} A feat</li>
        <li class="results-find">${iconMarkup('crossed-swords', { size: 18 })} A find</li>
      </ul>
      <div class="modal-card">
        <h2 class="modal-title">Paused</h2>
        <p class="modal-body">A modal is a sheet; its one forward action is the primary.</p>
        <div class="modal-actions">
          <button type="button" class="btn">Settings</button>
          <button type="button" class="btn btn-primary">Resume</button>
        </div>
      </div>
    </section>`;
  host.append(page);

  const segs = page.querySelectorAll<HTMLElement>('.specimen-seg');
  const mount = <T>(slot: HTMLElement, choices: { value: T; label: string }[], current: T): void => {
    const render = (v: T): void => {
      slot.replaceChildren(segmented(choices, v, render, 'Specimen'));
    };
    render(current);
  };
  mount(segs[0], [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], 'on');
  mount(segs[1], [
    { value: 'auto', label: 'Auto' }, { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
  ], 'high');
}
