/** A choice in a segmented control. */
export interface Choice<T> {
  value: T;
  label: string;
}

/** A row of mutually exclusive buttons, the current one marked. */
export function segmented<T>(choices: readonly Choice<T>[], current: T, pick: (v: T) => void, label: string): HTMLElement {
  const g = document.createElement('div');
  g.className = 'segmented';
  g.setAttribute('role', 'radiogroup');
  g.setAttribute('aria-label', label);
  for (const c of choices) {
    const b = document.createElement('button');
    b.type = 'button';
    const on = c.value === current;
    b.className = `segmented-btn${on ? ' is-active' : ''}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    b.textContent = c.label;
    b.addEventListener('click', () => {
      if (!on) pick(c.value);
    });
    g.append(b);
  }
  return g;
}
