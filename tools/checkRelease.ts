/**
 * checkRelease.ts — what a release must not ship with (plans/monetization.md §5).
 * Ported from learn-thai's `scripts/check-release.mts`.
 *
 * Release-only, deliberately not part of `npm test`: until the RevenueCat
 * project exists the key is a `TODO:` string, and the everyday gate stays
 * green with it. `npm run android:bundle` and `android:release` run it first (docs/store-listing.md,
 * the release runbook).
 *
 * The key is judged by the same rule the app applies at runtime
 * (`src/billing/storeKey.ts`), not a grep for TODO: a Test Store key (`test_…`)
 * is not a TODO, yet a release carrying it would hand out the full game free.
 *
 *   npm run check:release
 *
 * Exits 0 when the build is ready to ship, 1 with a list otherwise.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { revenueCatKey } from '../src/billing/storeKey';

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const problems: string[] = [];

// RevenueCat: the release key must be a real store key.
const billing = 'src/billing/revenuecat.ts';
const match = read(billing).match(/const REVENUECAT_PUBLIC_KEY = '([^']*)'/);
if (!match) {
  problems.push(`${billing}: REVENUECAT_PUBLIC_KEY not found — update tools/checkRelease.ts`);
} else if (!revenueCatKey({ testStore: false, storeKey: match[1] ?? '', testStoreKey: '' })) {
  problems.push(`${billing}: REVENUECAT_PUBLIC_KEY is "${match[1]}", not a store key (goog_…). The app refuses it and nobody could buy.`);
}

// A Test Store build flag left on would put the Test Store key in the bundle.
// The release ignores it, but it has no business shipping.
const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local'];
const flagged = process.env.REVENUECAT_TEST_STORE === '1'
  || envFiles.some((f) => existsSync(join(root, f)) && /^\s*REVENUECAT_TEST_STORE\s*=\s*['"]?1['"]?\s*$/m.test(read(f)));
if (flagged) problems.push('REVENUECAT_TEST_STORE=1 is set (environment or .env): unset it and rebuild');

// The manifest must ask for the network, or the store can never be reached.
const manifest = 'android/app/src/main/AndroidManifest.xml';
if (!read(manifest).includes('android.permission.INTERNET')) {
  problems.push(`${manifest}: no INTERNET permission, so the purchase can't reach Google Play`);
}

if (problems.length) {
  console.error('✗ Not ready to release:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✓ RevenueCat key is a store key, no Test Store flag, INTERNET declared');
