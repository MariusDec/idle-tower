# The Tower's variant: "Last light"

This folder is a **vendored copy** of the shared visual identity ("Sunrise /
Blue hour"), copied from Learn Thai's `visual identity/` on **2026-11-18**.
Nothing in `src/` imports it and the build never reads it. It is the
reference the game's own `src/styles/tokens.css` and `main.css` were ported
from. To take a later update from Learn Thai, diff that folder against this
one, then port what changed into the game's files by hand.

The full plan is [`plans/visual-identity.md`](../../plans/visual-identity.md).
In short, The Tower:

**Keeps the identity's**

- glass recipe, violet-indigo accent and its gradient CTA, Sarabun,
  radius-by-surface table, the three surfaces (card, inset, callout) and
  "one primary per screen";
- semantic token names (`--text-primary`, `--glass-fill`, `--accent-text`,
  `--panel-subtle`, …), so a rule written for a sibling app reads the same;
- motion tempo (120 / 180 / 280 / 420 / 700) and easings, the focus ring,
  the scrollbars and the 44px hit areas.

**Changes**

- **Dark only.** Blue hour, no Sunrise theme, no `data-theme`, no
  `prefers-color-scheme` block.
- **The ground's last stop is warm and per region** ("last light"):
  `#2a1e4c → #1d2148 → #211d3f → --bg-last-light`. The third stop is
  pulled toward violet so the warm fourth blends. `--bg-last-light` is a
  registered `<color>` written from TS by each region's `LAST_LIGHT`
  (`src/content/regions.ts`, plus the Abyss's and Boss Rush's), animated
  over `--dur-slow`. `tests/contrast.test.ts` holds every text token at
  4.5:1 on every stop, each last light included.
- **No blur over the running arena.** Anything over a moving battlefield uses
  `--glass-fill-solid` (indigo glass at about 90%). Sheets blur only on the
  `high` quality tier (`:root[data-quality='high']`) and when the arena is
  stopped or hidden.
- **Type ramp scales** with the game's text-size setting
  (`calc(… * var(--text-scale))`), with a 12px floor. Tabular numerals on
  the body.
- **Gold stays the player's colour** (`--fx-gold`: shards, the tower,
  rewards, legendary). The accent is the UI's.

**Adds (the game's own)**

- The battlefield palette (`--fx-*`, mirrored in `src/render/palette.ts`)
  as the identity's category hues; the rarity ladder; `--curse`;
  `--stored`; the z-index ladder; layout and safe-area tokens.
- Content artwork stays game-icons.net, inside the identity's icon tile.

**Worth sending upstream**: the per-context last stop, and the "no blur over
a moving canvas" rule.
