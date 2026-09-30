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
  const app = new App({
    canvas: byId<HTMLCanvasElement>('game-canvas'),
    stage: byId('stage'),
    hud: byId('hud-root'),
    screens: byId('screen-root'),
    overlay: byId('overlay-root'),
  });
  await app.boot();
  void hideNativeSplash();
}

void main();
