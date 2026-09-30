# The Icon System

**Files:** `scripts/fetch-icons.mjs`, `public/icons/sprite.svg`, `src/data/icons.ts`
(generated), `src/data/iconMap.ts`, `src/ui/Icon.ts`, `ATTRIBUTION.md`, the
`Icons` section at the end of `src/styles/main.css`, `tests/content-coverage.test.ts`

## What this replaced

Before Part 6 the icon layer was text. Abilities were single capital letters
(`'R'`, `'F'`, `'L'`…), research mixed letters with emoji so one panel rendered
in two unrelated styles at once, prestige perks still had a bare `'U'` and
`'C'`, and upgrades, talents, blessings and cores had no icon field at all. The
only real assets were ten 32×32 equipment outlines — three or four `#888` paths
each — under `public/sprites/equipment/`. Those files are gone.

Now **249 icon references across 16 tables** are served by **197 distinct
pieces of artwork**.

## Source and licence

[game-icons.net](https://game-icons.net), mirrored at
[github.com/game-icons/icons](https://github.com/game-icons/icons): ~4200
hand-drawn, single-path, monochrome icons designed for exactly this job.

Licensing is **CC BY 3.0** for almost every contributor and **CC0** for two
(Viscious Speed, Zeromancer). CC BY requires attribution, so attribution is
generated rather than remembered: `ATTRIBUTION.md` is written from the same
manifest that writes the sprite, grouped by contributor, one row per icon, with
the licence named. `tests/content-coverage.test.ts` fails if an icon ships
without a credit line — a licence obligation is not a thing to leave to a
reviewer noticing.

The artwork is unmodified except for two mechanical steps in the fetch script:
the black background plate (`<path d="M0 0h512v512H0z"/>`) is dropped, and the
explicit `fill="#fff"` is removed so the path inherits `currentColor`.

Contributors used: Lorc (119), Delapouite (58), Sbed (6), Willdabeast (3),
Caro Asercion (3), DarkZaitzev (2), Skoll (2), and one each from Carl Olsen,
Cathelineau, HeavenlyDog and Zeromancer (CC0).

## The pipeline

```
scripts/fetch-icons.mjs   ── the pinned manifest, and the only file you edit
      │
      ├─▶ public/icons/sprite.svg   197 <symbol>s, ~287 KB (committed)
      ├─▶ src/data/icons.ts         ICON_IDS / IconId / ICON_CREDITS (committed)
      └─▶ ATTRIBUTION.md            per-icon credit (committed)
```

Run it only when the manifest changes:

```bash
node scripts/fetch-icons.mjs
```

All three outputs are **committed**. A clean checkout builds and runs with no
network, which is a hard requirement for the Capacitor build (§9) and a nice
property for CI.

### Why the id is a closed union

`IconId` is generated from the manifest, so:

```ts
icon: 'frozen-orb'    // ✓ pinned
icon: 'frozen-orbe'   // ✗ tsc: not assignable to type 'IconId'
```

This is the same discipline `RENDERED_ENEMY_SHAPES` uses for enemy silhouettes:
the failure mode being designed out is a content table naming something that
does not exist and shipping as a blank box nobody notices. `tsc` catches the
misspelling; `content-coverage.test.ts` catches the three things `tsc` cannot
see — that the committed sprite contains a symbol for every id, that every
pinned id is actually referenced by something (an unused pin is dead payload on
every load), and that `ATTRIBUTION.md` still lists exactly what ships.

### Why `id === slug`

An icon is named for **what it depicts**, not for the one table that happens to
use it. So "the crit-chance icon" is `dead-eye` on the upgrade row, on the
passive tile and in the stats breakdown, and the player learns one mark per
concept instead of three synonyms for it. Reuse is the point, and it is why the
manifest is deduplicated at load time: 249 references, 197 icons.

## Coverage

| Surface | Count | Field | Before |
|---|---:|---|---|
| Active abilities | 10 | `AbilityDef.icon` | single letters |
| Passive abilities | 8 | `PassiveAbilityDef.icon` | emoji |
| Upgrades | 27 | `UpgradeDef.icon` | — |
| Research nodes | 17 | `ResearchDef.icon` | letters + emoji |
| Talents | 37 | `TalentDef.icon` | symbol chars |
| Blessings | 30 | `BlessingDef.icon` | — |
| Tower cores | 5 | `CoreDef.icon` | symbol chars |
| Equipment items | 10 | `EquipmentDef.icon` | local SVG outlines |
| Equipment slots | 8 | `SLOT_ICONS` | — |
| Rarities | 5 | `RARITY_ICONS` | — |
| Enemy types | 13 | `EnemyDef.icon` | — |
| Resources / stats | 21 | `STAT_ICONS` | — |
| Prestige + transcendence perks | 28 | `PrestigePerkDef.icon` | emoji, two ASCII letters |
| Achievements | 18 | `AchievementDef.icon` | emoji |
| Wave modifiers | 9 | `WaveModifierDef.icon` | emoji |
| Milestones | derived + 3 | `MilestoneDef.icon` | letters + emoji |

`EnemyDef.glyph` survives, deliberately: it is a **canvas** marking painted
inside the body silhouette by `Renderer`, not an icon in the DOM. It is the one
`glyph` field left in `src/data/`.

Still on text glyphs and deferred to Parts 7–8, which rebuild those surfaces
anyway: the mobile `BottomNav` group symbols (`▲ ⚗ ★ …`) and the desktop tab
strip, both of which change shape entirely when the two-level nav lands.

## `src/ui/Icon.ts`

```ts
icon(id, { size, tone, className, title })   // → <svg class="icon"><use href="#gi-…">
iconMarkup(id, opts)                         // the same thing as a string
iconFrame(id, { variant, rarity, tone, disabled })
renderIcon(host, id, opts)                   // put an icon in a host, reusing what is there
setIcon(svg, id)                             // repoint an existing <use>
loadIconSprite()                             // inject the sprite; awaited at boot
```

`renderIcon` is the one the panels use: they re-render on every state tick, so
an unchanged icon must be a no-op and a changed one a single attribute write,
not a `textContent` wipe and a rebuild.

**Tones** (`--fx-*` tokens, never a literal): `gold`, `ember`, `mana`, `arcane`,
`blood`, `frost`, `nature`, `critical`, `muted`, `inherit`. What each family is
allowed to *mean* is `docs/art-direction.md`; this is only the plumbing.

**Frames** are CSS, not assets — `.icon-frame` plus a variant
(`--ability`, `--talent`, `--upgrade`, `--item`, `--plain`) and an optional
`data-rarity`. A tier is a gradient border, an inner glow and a corner notch
over the *same* artwork, which is the entire reason for choosing monochrome
single-path icons: five rarities, a disabled state and a per-core accent all
come out of one file.

The notch matters beyond decoration — it is the non-colour channel, so an epic
and a legendary frame are still distinguishable to a player who cannot separate
violet from amber.

### Sizing lives in CSS

`icon()` accepts a `size`, but the in-place replacements do not use it. Each
host class sets `--icon-size` in the `Icons` section of `main.css`
(`.ability-icon > .icon`, `.research-icon > .icon`, …), so a surface can be
retuned without touching TypeScript. The default is 24px, which is the size the
artwork was reviewed at.

## Loading, and the one browser constraint

`<use href="external.svg#id">` **does not resolve cross-document in Chromium**.
That is not a preference; it is why the sprite is fetched and injected into the
page instead of being referenced as a file:

```ts
// src/main.ts
void loadIconSprite().then(bootstrap);
```

The sprite lands in a hidden `<div id="icon-sprite-host">` as the first child of
`<body>`, before any `<use>` exists. Boot awaits it rather than relying on the
browser re-resolving references when the symbol turns up later — that is a
rendering detail not worth betting the whole icon layer on. `loadIconSprite`
resolves (never rejects) on failure and logs, so a missing sprite costs icons,
not the run. It is idempotent, and it is a no-op without a `document`, which is
what keeps the node-environment test suite able to import `Icon.ts`.

The URL is resolved against `document.baseURI`, so a non-root Vite `base` — the
`./` the Capacitor build will want — keeps working.

**Cost:** one 287 KB request (≈60 KB over the wire once compressed), cached, and
zero per-icon requests thereafter. It is served as a static asset rather than
bundled into the JS so it stays separately cacheable and does not inflate the
already 589 KB main chunk.

## Adding an icon

1. Find it on [game-icons.net](https://game-icons.net) and note the contributor.
2. Add `['<author>', '<slug>']` to `MANIFEST` in `scripts/fetch-icons.mjs`, under
   the surface that motivated it. An author missing from `AUTHORS` is a hard
   error — an un-credited icon is a licence violation, not a warning.
3. `node scripts/fetch-icons.mjs`.
4. Use the slug as the `icon:` value. Commit the regenerated sprite,
   `src/data/icons.ts` and `ATTRIBUTION.md` along with your change.

Removing content works the same way in reverse: drop the manifest entry too, or
the "pins nothing it does not use" test will fail.

### Picking one that works

The bar is that it reads as **one silhouette at 24 px**, in white on
`--surface-2`, in a set with 196 neighbours. In practice:

- Prefer a single dominant shape. `crowned-skull` reads; a five-element
  composition does not.
- Stay inside the "arcane siege" register (`docs/art-direction.md`). The set
  deliberately has no microscopes, no clipboards, no modern instruments — the
  one place that nearly happened, "Loot Insights", ended up on `all-seeing-eye`
  instead.
- Say the mechanic, not the flavour word. Range is `bow-arrow`, not a ruler.
- Check the neighbours it will sit next to. Two bows in adjacent upgrade rows is
  a worse outcome than a slightly less literal second choice — which is why
  `critDamage` is `barbed-arrow` rather than the quiver the name suggests.

The whole set can be reviewed at any size without a browser:

```bash
node -e '…' # build a contact-sheet SVG of every symbol, then:
rsvg-convert -z 2 -o sheet.png sheet.svg
```
