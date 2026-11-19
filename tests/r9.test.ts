/**
 * R9 (`plans/review-risks.md`): the save moves to a new phone with Android's
 * Auto Backup. The restore itself was tested on devices; this pins the
 * manifest and rules that make it work, so a later edit can't drop them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const MANIFEST = read('android/app/src/main/AndroidManifest.xml');
const LEGACY = read('android/app/src/main/res/xml/backup_rules.xml').replace(/<!--[\s\S]*?-->/g, '');
const MODERN = read('android/app/src/main/res/xml/data_extraction_rules.xml').replace(/<!--[\s\S]*?-->/g, '');
const STORE = read('src/meta/save/stores/FilesystemStore.ts');

const includes = (xml: string): string[] =>
  [...xml.matchAll(/<(include|exclude) domain="([^"]+)" path="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}:${m[3]}`);

describe('R9: Android backup', () => {
  it('keeps backup on, with rules for both Android 11- and 12+', () => {
    const app = MANIFEST.match(/<application[^>]*>/)![0];
    expect(app).toMatch(/android:allowBackup="true"/);
    expect(app).toMatch(/android:fullBackupContent="@xml\/backup_rules"/);
    expect(app).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/);
  });

  it('carries exactly the files dir, the same way in every rule set', () => {
    expect(includes(LEGACY)).toEqual(['include file:.']);
    const cloud = MODERN.match(/<cloud-backup>([\s\S]*?)<\/cloud-backup>/)![1];
    const d2d = MODERN.match(/<device-transfer>([\s\S]*?)<\/device-transfer>/)![1];
    expect(includes(cloud)).toEqual(['include file:.']);
    expect(includes(d2d)).toEqual(['include file:.']);
  });

  it('the save on Android is written to that files dir', () => {
    expect(STORE).toMatch(/directory: Directory\.Data/);
    expect(STORE).not.toMatch(/Directory\.(Cache|External|Documents)/);
  });
});
