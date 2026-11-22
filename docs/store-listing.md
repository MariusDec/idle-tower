# Store listing (Google Play)

The text and screenshots for the Play listing, from R6 §3
(`plans/review-risks.md`). Draft: not uploaded yet. Keep it true to the
readings; when a number here changes in `docs/balancing.md`, change it here.

## Name

**Blue Hour**: the game's own word for its palette, the twilight the tower
holds against the Blight. Was *The Tower* until R6; only the display name
changed (`capacitor.config.ts` says what must never be renamed, and
`tests/r6.test.ts` pins it).

Search check before the first upload: Play search for "Blue Hour" and "Blue
Hour tower defence" should show no other game under that name. A web
search on 2026-11-19 found none; Play itself wasn't searched.

## Short description (≤ 80 characters)

> Hold the last light against the Blight. Idle roguelite tower defence.

## Full description

> **No ads. One purchase. Plays offline.**
>
> The Blight is swallowing the world, and one tower holds a circle of
> light. Each run, you draft weapons and passives as the waves come, and
> evolve them into something stronger. Between runs, the Forge turns what
> you earned into a tower that goes further.
>
> - **Draft a build every run**: weapons, passives and relics, and the
>   evolutions they make together.
> - **Six regions, six bosses**, each with its own rule and its own
>   Champions, then a second act that goes down without end.
> - **Plays itself when you want it to**: auto-restart, an Autocaster, a
>   Foreman for the Forge, and light stored while you're away.
> - **Made for a phone**: one hand, portrait, text size and colourblind
>   settings, a frame-rate cap for the battery.
>
> About five hours to the first ending, then an endless second act.
>
> **Free to play: Regions 1–3**, with their bosses, Trials and relics,
> and the Forge, Feats and automation. One purchase opens the rest for good:
> three more regions, the Blight, and all of Act 2. No subscription, no
> ads, nothing to skip the game with.
>
> No account and no tracking; the game itself never goes online, only the
> purchase does. Your save lives on your phone; copy it out from
> Settings › Save, or let Android's backup carry it.

The length line follows R3's decision (Act 1 is ~4–5 h of active play;
I1b gates 3.5–6 h). If I1b's band moves, re-word it. "Endless" holds: past
the built strata the Abyss's floors go on, and the Map says the strata
stop there for now.

The backup sentence stands: R9's restore test passed on API 30 and 33
(local transport). A restore through Google's own backup on a second
device is still to be seen on the closed track.

## Screenshots

What makes it different from other tower idles, in this order. Portrait,
taken in the browser pane at 412×915 (or on a phone) at 100% text.

1. **The draft**: a pick open, with an evolution's partner badge showing.
2. **An evolution**: the moment it fires, mid-wave, in Region 3 or later.
3. **Final Form**: the tower in it, a full field around it.
4. **The Forge**: the web part-revealed, a notable selected.
5. **The Map**: the Abyss shaft with stratum I–II.
6. **A boss**: Forgeheart's plates or the Prism's facets.

Captions (one line each, on the image or below it): *Draft a new build
every run* · *Evolve weapons mid-wave* · *Final Form* · *A Forge to grow
into* · *Six regions, then the Abyss* · *Bosses with rules of their own*.

## Category and rating

- Category: Games › Strategy (tower defence). Tags: idle, roguelite,
  offline.
- Content rating questionnaire: fantasy violence, no blood, no user
  interaction. In-app purchases: yes (one).

## Monetisation

Free to install. One non-consumable in-app product, `full_game`, priced in
Play Console only (never in code; D-3: one tier, around €3–6). No ads, no
subscription. Regions 1–3 are free for good ([monetization.md](monetization.md)).

## Data safety

As learn-thai's answers (plans/monetization.md §5):

- **Data collected:** Financial info › Purchase history, for App
  functionality, not shared. RevenueCat's device-scoped app user id, under
  Device or other IDs, if the form asks.
- **Not collected:** anything from play. The save stays on the phone.
- **Encrypted in transit:** yes (HTTPS to Google Play and RevenueCat).
- **Deletion:** no account exists; uninstalling removes the local data.

## Permissions

| Permission | Why |
|---|---|
| `INTERNET` | The purchase only: Google Play Billing and RevenueCat. Play needs no network. |
| `com.android.vending.BILLING` | Merged in by the RevenueCat plugin, for the purchase. |

## Release runbook: the purchase

Adapted from learn-thai's `docs/release-runbook.md`. Once, before the first
release that sells it:

1. **Play Console** › Monetise › In-app products: create `full_game`
   (non-consumable), set the price, and **activate** it. An inactive
   product is invisible to the store, and the paywall says it can't buy.
2. **RevenueCat** (the learn-thai account, a new project): add the Play
   app with its service-account credentials; create the entitlement
   `blue-hour-full`, attach `full_game` to it, and put the product in the
   current offering.
3. Paste the project's public `goog_…` key into
   `src/billing/revenuecat.ts` (`REVENUECAT_PUBLIC_KEY`), and its Test Store
   `test_…` key beside it (`REVENUECAT_TEST_STORE_KEY`).
4. **Licence testers** (Play Console › Settings › License testing): add the
   test accounts, so their purchases on the closed track are free.
5. `npm run android:test-store` and walk it on a device: buy, cancel,
   restore, a pending payment, airplane mode at launch (must stay full),
   and a refund (the next check moves the player back to Region 3).
6. **Real Google Play, once.** The Test Store never talks to Play, so the
   `goog_` key, the Play product and the RevenueCat ↔ Play link are only
   proven by a signed build: `npm run android:bundle`, upload to the
   *Internal testing* track, install it from Play as a licence tester, and
   buy with the test card. Check the paywall shows Play's price, the buy
   opens the game, RevenueCat's dashboard shows the customer with
   `blue-hour-full`, and a reinstall restores it. Buy once more with
   *"Slow test card, approves after a few minutes"* for the pending path.
   A purchase must reach RevenueCat (it acknowledges it for Play): an
   unacknowledged purchase is refunded by Google after three days.

Every release:

1. `npm run android:bundle` (or `android:release`). Both run
   `npm run check:release` first, which fails on a `TODO:` or Test Store
   key, on `REVENUECAT_TEST_STORE=1`, or without `INTERNET`: a bundle that
   can't sell would leave every player at Region 3 with no way on.
