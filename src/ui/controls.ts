/** A choice in a segmented control. */
export interface Choice<T> {
  value: T;
  label: string;
}

/**
 * A yes-or-no setting: the identity's switch row. The whole row is the
 * switch (role="switch", so a screen reader says on or off). It flips
 * itself, so the thumb slides, then reports; a caller that redraws the row
 * waits for `settled`. The label never changes with the state.
 */
export function switchRow(label: string, checked: boolean, change: (on: boolean) => void, hint?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'switch-row';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(checked));
  const text = document.createElement('span');
  text.className = 'switch-row-text';
  const l = document.createElement('span');
  l.className = 'switch-row-label';
  l.textContent = label;
  text.append(l);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'switch-row-hint';
    h.textContent = hint;
    text.append(h);
  }
  const track = document.createElement('span');
  track.className = 'switch';
  track.setAttribute('aria-hidden', 'true');
  b.append(text, track);
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(on));
    change(on);
  });
  return b;
}

/**
 * Call `fn` once a switch row's thumb has landed (180 ms), so a redraw that
 * replaces the row doesn't cut the slide short. At once with motion reduced.
 */
export function settled(row: HTMLElement, fn: () => void): void {
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    fn();
  };
  if (document.documentElement.dataset.motion === 'reduce') return go();
  row.querySelector('.switch')?.addEventListener('transitionend', go, { once: true });
  // No transitionend if the transition never ran (a hidden tab, say).
  window.setTimeout(go, 250);
}

/** Where a segmented control's indicator was when it was tapped, by control, for its rebuild to glide from. */
const glides = new Map<string, number>();

/**
 * A segmented control is about to be rebuilt after a tap (most callers redraw
 * on change): remember which option was lit. Only a rebuild in the same task
 * glides; a later one (the panel reopened) starts where it is.
 */
export function noteGlide(key: string, from: number): void {
  glides.set(key, from);
  queueMicrotask(() => glides.delete(key));
}

/**
 * The segment slide (the identity's 280ms on `standard`) for a control built
 * fresh after a tap: it shows one frame with the old option lit, then the new
 * one, so the indicator glides and the labels cross-fade instead of jumping.
 * Only the look lags that frame; `aria-checked` is right from the start.
 */
export function glide(seg: HTMLElement, key: string): void {
  const from = glides.get(key);
  glides.delete(key);
  if (from === undefined || document.documentElement.dataset.motion === 'reduce' || typeof requestAnimationFrame !== 'function') return;
  const btns = [...seg.children] as HTMLElement[];
  const to = btns.findIndex((b) => b.classList.contains('is-active'));
  if (to < 0 || from === to || !btns[from]) return;
  btns[to].classList.remove('is-active');
  btns[from].classList.add('is-active');
  requestAnimationFrame(() => {
    // Commit the old position as the starting style, then move: the change transitions.
    if (seg.isConnected) getComputedStyle(seg, '::before').getPropertyValue('transform');
    btns[from].classList.remove('is-active');
    btns[to].classList.add('is-active');
  });
}

/** A row of mutually exclusive buttons, the current one marked. */
export function segmented<T>(choices: readonly Choice<T>[], current: T, pick: (v: T) => void, label: string): HTMLElement {
  const g = document.createElement('div');
  g.className = 'segmented';
  g.setAttribute('role', 'radiogroup');
  g.setAttribute('aria-label', label);
  const lit = choices.findIndex((c) => c.value === current);
  choices.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    const on = i === lit;
    b.className = `segmented-btn${on ? ' is-active' : ''}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    b.textContent = c.label;
    b.addEventListener('click', () => {
      if (on) return;
      noteGlide(label, lit);
      pick(c.value);
    });
    g.append(b);
  });
  glide(g, label);
  return g;
}
