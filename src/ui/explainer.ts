import type { ExplainerDef } from '../content/explainers';

/**
 * An explainer's modal body (§7.1). The first one's title is the modal's;
 * any after it, told together, carry their own heading.
 */
export function explainerBody(defs: readonly ExplainerDef[]): HTMLElement {
  const body = document.createElement('div');
  body.className = 'explainer';
  defs.forEach((def, i) => {
    if (i > 0) {
      const h = document.createElement('h3');
      h.className = 'explainer-title';
      h.textContent = def.title;
      body.append(h);
    }
    for (const line of def.lines) {
      const p = document.createElement('p');
      p.className = 'explainer-line';
      p.textContent = line;
      body.append(p);
    }
  });
  return body;
}
