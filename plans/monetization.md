# Monetization: Regions 1–3 free, one purchase opens the rest

**Status:** 2026-11-22. Built (see `docs/monetization.md`), decisions
settled the same day. Left for a human: the RevenueCat project and Play
Console product (§5's runbook, in `docs/store-listing.md`), and the Test
Store APK walk-through (§7 step 5).

**Why:** the game is free, with no purchases and no ads. Its Play listing says
so in one line (`docs/store-listing.md`: *"No ads. No purchases. Plays
offline."*). We want a way to charge for it that fits that identity: no ads, no
subscription, no pay-to-skip, and full offline play once the game is bought.

**The idea:** a permanent free tier (a demo, not a trial) plus a one-time
non-consumable unlock. It is the same shape as learn-thai's `pro_lifetime`, and
it reuses that app's billing layer (`src/billing/`, `src/state/entitlementStore.ts`).

- **Free:** Regions 1–3 (Ashen Fields, Drowned Mire, Glass Wastes), their
  bosses, Trials, relics and trophies, plus the Forge, Feats, Contracts,
  automation and offline earnings everywhere the player can go.
- **Full game:** Regions 4–6 (Ember Rift, The Hollow, Blight Heart) and all of
  Act 2: pacts and heat, Starlight, the Constellations, the Abyss, Boss Rush
  and the Daily Omen.

The gate is the Prism's fall. The light spreads toward Ember Rift as it does
today, and the next region is shown on the Map as a locked card with a price.

### Why after Region 3

First boss kills by the pacing bot (Q1 readings in `docs/balancing.md`; humans
are slower):

| Boss | Bot | |
|---|---|---|
| Gatekeeper (R1) | 32 min | |
| Bog Mother (R2) | 72 min | before the first evolution (~95 min), too early |
| **Prism (R3)** | **109 min** | **the gate**: past the first evolution, two bosses and Trials, an overnight idle session |
| Forgeheart (R4) | 149 min | |
| Hollow King (R5) | 311 min | |
| Blight (R6) | ~503 min · ~5 d idle | gating here, most players drift off before they see the price |

At the gate a player has seen what makes the game work: drafts, an evolution,
idle progress, a boss ceremony. Act 1's harder half and Act 2 are still ahead.

---

## 0. Decisions

| # | Question | Recommendation | Settled |
|---|---|---|---|
| D-1 | Where is the gate? | After Region 3 (above). R2 is too early; all of Act 1 free is too much | Yes, as recommended |
| D-2 | Is the game live with players? | If yes, grandfather them (§4). If no, skip §4 | Not live: §4 skipped |
| D-3 | Price | One tier, set in Play Console only, never hard-coded. Somewhere around €3–6 | Yes, as recommended |
| D-4 | Billing vendor | RevenueCat, the same account as learn-thai, a new project. The adapter is already written and tested; Play Billing directly would mean writing a Capacitor plugin | Yes, as recommended |
| D-5 | Do free players see Act 2 at all? | No tabs, but the locked Ember Rift card and the paywall say what Act 2 holds. Act 2 can't be reached without Region 6 anyway | Yes, as recommended |
| D-6 | Contracts and Trials that point past the gate | Not offered under the free plan (filtered out, never shown locked) | Yes, as recommended |
| D-7 | Product and entitlement ids | `full_game` / `blue_hour_full` | `full_game` / **`blue-hour-full`** |

---

## 1. Principles

1. **Earned ≠ playable.** `regionUnlocked` (`meta/collection.ts:64`) keeps
   meaning "earned by play" and is **not changed**. The plan is applied at
   the *doors*: the places that select or start a run, and the hub's tabs. The
   sim, `buildRunConfig`, the pacing, inspect, arsenal and calibrate tools,
   and `tools/fixtures/frontiers.json` never see a plan. So invariants I1–I8
   read the same as before, and no fixture needs regenerating.
2. **The cache renders, the store verifies** (learn-thai's rule). The plan
   comes from a local cache that can be read synchronously before the first
   frame. RevenueCat is asked in the background. A network failure never
   downgrades; only a definite "not entitled" does (a refund).
3. **The purchase is not in the profile.** It lives in its own store key, not
   in `Profile`. So `exportProfile` / `importProfile`, the rolling backups and
   Android's save backup (R9) can't carry a purchase to another account, and
   a broken save can't lose one.
4. **Never strand the player.** Under the free plan, anything that points past
   the gate is filtered out, not shown as a dead end. The one exception is the
   Map's locked card, which *is* the paywall's door.
5. **Billing failure is never a crash.** Offline, no Play Services, an
   unlicensed tester: the app starts and plays; the paywall says "can't buy
   right now".

---

## 2. Code

### 2.1 `meta/plan.ts` (new, pure)

The equivalent of learn-thai's `domain/entitlements.ts`. No I/O, no DOM.

```ts
export type Plan = 'free' | 'full';
/** The last region the free plan plays. */
export const FREE_REGIONS = 3;
/** Regions 4–6, the Abyss (7) and Boss Rush (8). */
export function regionPaid(index: number): boolean;
/** Earned *and* allowed by the plan. The one predicate the doors use. */
export function regionPlayable(profile: Profile, index: number, plan: Plan): boolean;
/** act2Open(profile) && plan === 'full'. For the hub's Act 2 tabs. */
export function act2Playable(profile: Profile, plan: Plan): boolean;
/** On load or a downgrade: move profile.region back inside the plan. */
export function clampToPlan(profile: Profile, plan: Plan): void;
```

`ABYSS_INDEX` (7) and `RUSH_INDEX` (8) are greater than `FREE_REGIONS`, so
`regionPaid` covers them with no special case. That property gets a test.

### 2.2 The doors (audit list)

Each of these call sites either uses `regionPlayable` / `act2Playable` or is
shown not to need it. Run `impact` on each symbol before changing it.

| Where | What changes |
|---|---|
| `app/App.ts:242` (region select) | `regionPlayable`. A paid region under free opens the paywall instead |
| `ui/hub/map.ts:110` (region cards) | An earned or next paid region renders a locked card (§3.1) instead of a playable one |
| `ui/hub/hub.ts:388` and `hubUnlocks` (tabs) | Pacts and Omen use `act2Playable` |
| `meta/contracts.ts:415–422, 511, 819, 825` | Contracts aimed at a paid region aren't offered under free (D-6) |
| `meta/trials.ts:44` | Trials of Regions 4–6 aren't offered under free |
| `meta/collection.ts` `selectedRegion` / `frontier` | Unchanged. `clampToPlan` runs at boot and on a downgrade, so `profile.region` is always playable |
| `meta/offline.ts` | Unchanged, because it earns in `profile.region`, which `clampToPlan` keeps legal. Gets a test |
| `meta/results.ts:229` (newly opened regions) | Ember Rift's line under free becomes the paywall's prompt (§3.2) |

The meta functions that take a plan take it as an argument. They don't read a
global, which keeps them pure and testable, as `architecture.md` asks.

### 2.3 `billing/` (port from learn-thai)

Copy across mostly unchanged: `types.ts`, `index.ts`, `mock.ts`,
`revenuecat.ts`, `purchaseErrors.ts` and `storeKey.ts`, with their tests.
Changes:

- Ids: `FULL_PRODUCT_ID = 'full_game'`, `FULL_ENTITLEMENT_ID = 'blue_hour_full'`.
  New `goog_…` and Test Store keys from the new RevenueCat project.
- `isNativePlatform` / `isNativeDebugBuild` come from `platform/native.ts`.
- `__REVENUECAT_TEST_STORE__` define in `vite.config.ts`, and an
  `android:test-store` script, as learn-thai's `cap:run:test-store` does.
- Dependency: `@revenuecat/purchases-capacitor` at the same version as learn-thai.

### 2.4 `app/entitlement.ts` (port of `entitlementStore`)

learn-thai's store, written without Solid: a tiny observable
(`plan()`, `subscribe`), a cache under its own IndexedDB key (not inside the
profile record), `refresh()` at boot and on `appStateChange` resume
(`RESUME_RECHECK_MS`), and `onEntitlementChange`. On a change, `App` runs
`clampToPlan` and re-renders the hub.

Dev builds: the web dev server and debug APKs get the mock, already entitled,
as in learn-thai. Settings gets a dev-only "Plan: free / full" switch, so the
free tier can be tested without a store.

---

## 3. UI

### 3.1 The locked region card (`ui/hub/map.ts`)

After the Prism falls, Ember Rift shows as a card that is *visible but sealed*.
It has its name, its rule (*Cinders*), its boss's silhouette and a lock, so
the player sees what they're buying. Tapping it opens the paywall. Regions 5–6
stay hidden behind the fog as they are now. There is no "you've earned it but
can't play it" state for them.

### 3.2 The moment (`ui/results.ts`)

On the Prism's first fall under free, the results sheet's "Ember Rift opens"
line becomes the prompt: *The light reaches Ember Rift. The rest of the tower
is one purchase away.* It has one button that opens the paywall. It is shown
once; after that the locked card is the only door. No nagging on later runs.

### 3.3 The paywall sheet (`ui/paywall.ts`, on `ui/modal.ts`)

- Heading and the price from the store (`getProduct().priceString`, never hard-coded).
- What it opens, in three lines: *Three more regions and the Blight* ·
  *Act 2: pacts, the Abyss, Boss Rush, the Daily Omen* · *Yours for good, offline, no ads.*
- **Buy** and **Restore purchase**. Restore also lives in Settings.
- The `PurchaseResult` states, as in learn-thai: `pending` says it will unlock
  when Play confirms; `cancelled` closes silently; `unavailable` / `error`
  show the message.
- Back closes it (the back-button hierarchy, `app/exitGuard.ts`).

### 3.4 Settings

The plan ("Full game" or "Free: Regions 1–3"), **Restore purchase**, and the
dev-only switch (§2.4).

### 3.5 Explainer

A short one (`content/explainers.ts`) the first time the locked card appears,
in the same voice as the other unlock explainers.

---

## 4. Existing players (only if D-2 is yes)

Anyone whose save already reaches past Region 3 when the paid version first
runs keeps what they have. One profile migration step
(`meta/save/migrate.ts`) sets `profile.founder = true` if
`frontier(profile).index > FREE_REGIONS`. `regionPlayable` treats a founder as
`full`.

This *is* a profile field, so an exported founder save carries it. That's
acceptable: `seal.ts` already says it isn't meant to stop a determined player,
and founders are a closed set from one migration.

---

## 5. Android and the store listing

- `AndroidManifest.xml`: add `INTERNET`. The comment that says "No INTERNET
  permission" goes. `com.android.vending.BILLING` comes from the library merge.
- `capacitor.config.ts`: nothing.
- `docs/store-listing.md`:
  - The tagline becomes *"No ads. One purchase. Plays offline."*
  - Monetisation row: free to install, one non-consumable (`full_game`), no
    ads, no subscription.
  - Data safety: copy learn-thai's answers. Purchase history collected, not
    shared, for app functionality; RevenueCat's device-scoped id under Device
    or other IDs if the form asks. No game data leaves the device.
  - Permissions table: `INTERNET` is used only for the purchase; play needs no network.
  - The full description says plainly that Regions 1–3 are free.
- A release runbook section, adapted from learn-thai's `docs/release-runbook.md`:
  create and **activate** `full_game` in Play Console, set up the RevenueCat
  project, entitlement and offering, paste the `goog_` key, licence testers.
- A `check:release` guard (from learn-thai's `scripts/check-release.mts`) that
  fails a release build carrying the Test Store key.

---

## 6. Docs

- New `docs/monetization.md` (system doc): plan, doors, billing, cache.
- `docs/architecture.md`: `billing/` in the layer table; `meta/plan.ts` pure.
- `docs/collection.md`: the Map's locked card.
- `docs/save.md`: the entitlement cache is not part of the profile, and the founder flag if §4 is built.
- `docs/ui.md`: paywall sheet and Settings rows.

---

## 7. Build order

1. `meta/plan.ts` + tests (free/full × each region, Abyss/Rush paid, `clampToPlan`).
2. The doors (§2.2), each behind `impact`, with the dev plan switch so free can
   be played on web. **Check:** a free profile with the Prism down never
   starts a run in Regions 4–8 from any entry point (map, contract, trial,
   resume, offline).
3. Locked card, results prompt, paywall sheet with the mock adapter.
4. `billing/` + `app/entitlement.ts` port, the RevenueCat dependency, `INTERNET`.
5. Test Store APK: buy, cancel, restore, pending, airplane mode at launch
   (must stay full), refund (`not-entitled` → clamp back to Region 3).
6. Founder migration (if D-2).
7. Store listing, Data safety, runbook, `check:release`.

## 8. Verification

- `npm test`, `npm run typecheck`.
- `npm run pacing -- --hours 12 --seeds 8`: **identical** numbers to before.
  That proves the gate never reached the sim (Principle 1).
- Free profile walk-through on web with the dev switch: R1–R3, Trials,
  Contracts, offline return; locked Ember Rift; paywall opens and closes; no
  Act 2 tabs.
- Test Store APK walk-through (step 5).

## 9. Not doing

- **Ads / rewarded ads:** they break the game's identity and need data collection.
- **Subscription or a time-limited trial:** an idle game's trial runs out while the player sits idle.
- **Selling automation, offline earnings or speed:** that's pay-to-skip the core loop.
- **Cosmetics / a supporter pack:** a possible *later* add-on (frames exist),
  never instead of the unlock.
