const textCache = new WeakMap<HTMLElement, string>();
const classCache = new WeakMap<HTMLElement, Set<string>>();
const styleCache = new WeakMap<HTMLElement, Map<string, string>>();

export function setText(el: HTMLElement, value: string): void {
  const prev = textCache.get(el);
  if (prev === value) return;
  textCache.set(el, value);
  el.textContent = value;
}

export function hasClass(el: HTMLElement, cls: string): boolean {
  const cache = classCache.get(el);
  if (cache) return cache.has(cls);
  const set = new Set<string>();
  for (let i = 0; i < el.classList.length; i++) set.add(el.classList[i]);
  classCache.set(el, set);
  return set.has(cls);
}

export function toggleClass(el: HTMLElement, cls: string, on: boolean): void {
  const cache = classCache.get(el);
  if (!cache) {
    const set = new Set<string>();
    for (let i = 0; i < el.classList.length; i++) set.add(el.classList[i]);
    classCache.set(el, set);
    const next = set.has(cls);
    if (next === on) return;
    el.classList.toggle(cls, on);
    if (on) set.add(cls); else set.delete(cls);
    return;
  }
  const has = cache.has(cls);
  if (has === on) return;
  el.classList.toggle(cls, on);
  if (on) cache.add(cls); else cache.delete(cls);
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  let cache = styleCache.get(el);
  if (!cache) {
    cache = new Map<string, string>();
    styleCache.set(el, cache);
  }
  const prev = cache.get(prop);
  if (prev === value) return;
  cache.set(prop, value);
  el.style.setProperty(prop, value);
}

export function setDisplay(el: HTMLElement, value: string): void {
  if (el.style.display === value) return;
  el.style.display = value;
}
