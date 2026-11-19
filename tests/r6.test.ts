/**
 * R6 (`plans/review-risks.md`): the game is shown as "Blue Hour", but every
 * name that keys a player's data keeps the legacy one. Renaming any of these
 * orphans every save, so this test pins them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../capacitor.config';
import { CORRUPT_KEY, LEGACY_BACKUP_KEY, LEGACY_KEY, PROFILE_KEY, SEALED_KEY } from '../src/meta/save';
import { QUALITY_PREF_KEY } from '../src/render/quality';
import { CANVAS_MODE_KEY } from '../src/render/canvasMode';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('R6: the display name', () => {
  it('is Blue Hour everywhere a player sees it', () => {
    expect(config.appName).toBe('Blue Hour');
    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain('<string name="app_name">Blue Hour</string>');
    expect(strings).toContain('<string name="title_activity_main">Blue Hour</string>');
    expect(read('index.html')).toContain('<title>Blue Hour</title>');
    expect(read('src/ui/hub/hub.ts')).toContain('<h1 class="hub-title">Blue Hour</h1>');
  });
});

describe('R6: the legacy names that must never change', () => {
  it('keeps the Play identity and the WebView origin', () => {
    expect(config.appId).toBe('com.mariusdonci.thetower');
    expect(config.server?.androidScheme).toBe('https');
    expect(config.server?.hostname).toBe('localhost');
    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain('<string name="package_name">com.mariusdonci.thetower</string>');
    expect(read('android/app/build.gradle')).toContain('applicationId "com.mariusdonci.thetower"');
  });

  it('keeps every storage key', () => {
    expect(PROFILE_KEY).toBe('tower-profile');
    expect(CORRUPT_KEY).toBe('tower-profile-corrupt');
    expect(SEALED_KEY).toBe('tower-sealed');
    expect(LEGACY_KEY).toBe('the-tower-save');
    expect(LEGACY_BACKUP_KEY).toBe('the-tower-save-legacy-backup');
    expect(QUALITY_PREF_KEY).toBe('the-tower-quality');
    expect(CANVAS_MODE_KEY).toBe('the-tower-canvas');
    expect(read('src/meta/save/stores/IdbStore.ts')).toContain("const DB_NAME = 'the-tower';");
  });
});
