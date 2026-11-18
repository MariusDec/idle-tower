import { App } from './App';
import { loadIconSprite } from '../ui/icon';
import { hideNativeSplash, initNativeShell } from '../platform/native';

async function main(): Promise<void> {
  void initNativeShell();
  const byId = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} missing from index.html`);
    return el as T;
  };
  await loadIconSprite();
  // Dev only: the component specimen (plans/visual-identity.md §4). The branch
  // is dead in a production build, so the module never ships.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('specimen')) {
    const { mountSpecimen } = await import('../ui/specimen');
    mountSpecimen(byId('app'));
    void hideNativeSplash();
    return;
  }
  const app = new App({
    canvas: byId<HTMLCanvasElement>('game-canvas'),
    stage: byId('stage'),
    hud: byId('hud-root'),
    screens: byId('screen-root'),
    overlay: byId('overlay-root'),
  });
  await app.boot();
  // Dev only: a console handle for inspection and render stress tests.
  if (import.meta.env.DEV) (globalThis as { tower?: App }).tower = app;
  void hideNativeSplash();
}

void main();
