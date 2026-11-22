# Monetization

Regions 1–3 are free for good; one non-consumable purchase opens the rest.
No ads, no subscription, no pay-to-skip. The design and its decisions are
[plans/monetization.md](../plans/monetization.md); this file says where each
rule lives. The billing layer is a port of learn-thai's (`src/billing/`,
`src/state/entitlementStore.ts`); keep the two in step where they can be.

| | Free | Full game (`full_game`) |
|---|---|---|
| Regions | 1–3 (Ashen Fields, Drowned Mire, Glass Wastes), their bosses, Trials, relics, trophies | 4–6 (Ember Rift, The Hollow, Blight Heart) |
| Act 2 | — | Pacts and heat, Starlight, the Constellations, the Abyss, Boss Rush, the Daily Omen |
| Everywhere the player can go | Forge, Feats, Contracts, automation, offline earnings | the same |

Contracts open at Forgeheart's fall ([contracts.md](contracts.md)), so on
the free plan the board only exists for a player who bought and then was
refunded; it is filtered all the same.

## The plan (`meta/plan.ts`, pure)

`Plan = 'free' | 'full'`. `FREE_REGIONS = 3`; `regionPaid(i)` is `i > 3`,
which covers the Abyss (7) and Boss Rush (8) with no case of their own.

- **Earned ≠ playable.** `regionUnlocked` (`meta/collection.ts`) still means
  "earned by play" and never sees a plan, nor do the sim, `buildRunConfig`,
  the pacing bot or `tools/fixtures/`. `npm run pacing` gives identical
  numbers on either side of this system.
- `regionPlayable(profile, i, plan)` is the one predicate the doors ask;
  `act2Playable` the same for Act 2; `playableFrontier` is `frontier`
  stopped at the gate; `sealedRegion` is the region the purchase opens next
  (Ember Rift, once the Prism has fallen, on free).
- `clampToPlan` moves `profile.region` (and a contract's way home) back
  inside the plan. The app runs it at boot, after every run, and when the
  plan changes; so `selectedRegion` and offline earnings (which earn in
  `profile.region`) need no change.

Every meta function that takes a plan takes it as a trailing argument
defaulting to `'full'`, so the tools and existing tests see the whole game.

## The doors

| Where | What asks the plan |
|---|---|
| `App` hub actions | `selectRegion` (`regionPlayable`), `chooseWaypoint` and `startOmen` (`act2Playable`), `trial` (`chooseTrial(…, plan)`), `takeContract` / `rerollContract` / Retry |
| `App#playFrontier` | the welcome-back's Play: `playableFrontier` |
| `meta/automation.ts#marchOn` | Frontier March stops at the gate |
| `meta/contracts.ts` | `generate` / `ensureBoard` / `reroll` / `settleContract` draw no card past the gate; `takeContract` refuses one; `fitBoard` redraws a full-plan board after a downgrade (D-6: filtered, never shown locked) |
| `meta/results.ts#bankRun` | passes the plan to the contract it settles and the board it fills |
| `meta/goals.ts#hubGoal` | the Next line never names a boss past the gate, nor Act 2 |
| `meta/explainers.ts` | Act 2's explainers wait on free; `sealed` tells of the locked card |
| `ui/hub/hub.ts` | Stars tab (`hubUnlocksFor`), Pacts, Omen, Starlight |
| `ui/hub/map.ts` | the first earned paid region draws as the locked card; the Abyss and Boss Rush cards only on full |

## The entitlement (`app/entitlement.ts`)

- **The cache renders, the store verifies.** The plan comes from a cache in
  the save store under `tower-entitlement`, read at boot before the hub is
  drawn. RevenueCat is asked in the background at boot, on resume (at most
  once a minute) and when it pushes a change. Only a definite answer
  writes: a network failure never downgrades; a definite "not entitled"
  (a refund) does, once the store has re-linked the account's purchases.
- **Not in the profile.** The cache is its own key, so export, import, the
  rolling backups and a corrupt profile never move or lose a purchase.
  Android's Auto Backup leaves it behind too (`res/xml/*`, pinned by
  `tests/r9.test.ts`): a new phone asks Google Play.
- On a change, `App#planChanged` runs `fitPlan` (clamp and `fitBoard`) and
  redraws the hub. A run under way plays out; the clamp waits for its end.

## Billing (`billing/`)

`types.ts` (ids: `full_game`, entitlement `blue-hour-full`), `index.ts`
(picks the adapter once), `mock.ts`, `revenuecat.ts` (the plugin, loaded
lazily), `purchaseErrors.ts`, `storeKey.ts`. Every adapter call swallows its
errors: offline, no Play Services or an unlicensed tester never crash the
game; the paywall says the store can't be reached.

| Build | Adapter |
|---|---|
| `npm run dev` | mock, entitled |
| production web build | mock, free; Buy grants locally |
| debug APK | mock, entitled |
| debug APK from `npm run android:test-store` | RevenueCat with the Test Store key |
| release | RevenueCat with the `goog_` key; never the Test Store key |

Dev and debug builds have a **Plan (dev)** switch in Settings (Store / Free /
Full, kept in `localStorage`), so the free plan can be played with no store.

## UI

- **Locked card** (`ui/hub/map.ts#sealed`): name, rule, the boss's
  silhouette, a lock with the store's price. Tapping it opens the paywall.
  Regions 5–6 stay in the fog.
- **The moment** (`ui/results.ts#gateRow`): the run that first opens Ember
  Rift on free turns its "Unlocked" line into *The light reaches Ember Rift*
  with one button. It rides that run only; after it, the locked card is the
  only door.
- **Paywall** (`ui/paywall.ts`, on `Modal`): three lines, the price from the
  store, Buy, Restore purchase, Not now. Back closes it. Purchase results as
  in learn-thai: `pending` waits for Play, `cancelled` says nothing,
  `unavailable` / `error` reopen the sheet with the message.
- **Settings › Full game**: the plan, Restore purchase, and between runs a
  way to the paywall.

## Release

`npm run check:release` (`tools/checkRelease.ts`) fails while the
RevenueCat key is not a `goog_` key, while `REVENUECAT_TEST_STORE=1` is set,
or without the `INTERNET` permission; `android:bundle` and `android:release`
run it first, so a build that can't sell is never made. The runbook is in
[store-listing.md](store-listing.md#release-runbook-the-purchase).
