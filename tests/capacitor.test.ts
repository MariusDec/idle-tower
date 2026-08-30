import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8');
const hasAndroid = existsSync(resolve(root, 'android/app/src/main/AndroidManifest.xml'));

/**
 * The native shell's invariants. See `plans/capacitor.md`.
 *
 * The Android platform is committed, but these skip rather than fail when it is
 * absent so a fresh checkout that has not run `npx cap add android` still has a
 * green suite.
 */
describe('capacitor config', () => {
  const cfg = read('capacitor.config.ts');

  it('keeps the app identity that the Play Store listing is keyed to', () => {
    expect(cfg).toContain("appId: 'com.mariusdonci.thetower'");
    expect(cfg).toContain("appName: 'The Tower'");
    expect(cfg).toContain("webDir: 'dist'");
  });

  it('pins the scheme that localStorage saves are keyed to', () => {
    // Changing either of these changes the WebView origin, which orphans every
    // player's `the-tower-save` (src/systems/SaveManager.ts).
    expect(cfg).toContain("androidScheme: 'https'");
    expect(cfg).toContain("hostname: 'localhost'");
  });

  it('never points the shipped app at a remote host', () => {
    // `server.url` is the live-reload footgun: it makes the app unusable offline
    // and, if it ever shipped, points players at a dev machine.
    expect(cfg).not.toMatch(/\burl:\s*['"]https?:/);
    expect(cfg).not.toMatch(/cleartext:\s*true/);
  });
});

describe.skipIf(!hasAndroid)('android shell', () => {
  it('ships without the INTERNET permission', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).not.toContain('android.permission.INTERNET');
  });

  it('is named The Tower', () => {
    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain('<string name="app_name">The Tower</string>');
  });

  it('goes edge-to-edge so the safe-area tokens resolve', () => {
    const activity = read(
      'android/app/src/main/java/com/mariusdonci/thetower/MainActivity.java',
    );
    expect(activity).toContain('setDecorFitsSystemWindows');
  });

  it('keeps the native ground colour in step with --surface-0', () => {
    const colors = read('android/app/src/main/res/values/colors.xml');
    expect(colors).toContain('#0a0d14');
  });
});
