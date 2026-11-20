# Blue Hour — system docs

One file per system, describing the code as it is. The design and the
reasons behind it live in [plans/rebuild.md](../plans/rebuild.md) (§ numbers
below point there); these files say where each rule lives and what it
depends on. [AGENTS.md](../AGENTS.md) is the short version for agents.

| File | System |
|---|---|
| [architecture.md](architecture.md) | Layers, import rules, the one-way data flow |
| [app.md](app.md) | Boot, the screen machine, the fixed-step loop, absences and lifecycle |
| [sim.md](sim.md) | `RunState`, `createRun`, `step`, determinism, the RNG streams, sim events, stats |
| [combat.md](combat.md) | Weapons, projectiles, damage and armour, caps, evolutions, the ultimate |
| [draft.md](draft.md) | XP, level-ups, offers, the suggestion scorer, the timer, the Tactician |
| [enemies-and-waves.md](enemies-and-waves.md) | Regions, wave templates, the overlap rule, verbs, elites and auras, rules |
| [bosses.md](bosses.md) | Phases, patterns, enrage, overtime, ceremony |
| [forge.md](forge.md) | The Forge web: fog, seals, costs, refunds, masteries; `buildRunConfig` |
| [collection.md](collection.md) | The Map, frames, relics, the Bestiary, the Recipe Book |
| [feats.md](feats.md) | Feats and their rewards |
| [idle.md](idle.md) | Automation, the Tactician, offline earnings |
| [rifts.md](rifts.md) | Rifts: the mid-wave tear, its roll, its offers, the journal |
| [cursed.md](cursed.md) | Cursed relics: reliquaries, the claim, the cursed slot, binding |
| [anomalies.md](anomalies.md) | Anomalies: the rare card that breaks a weapon's rule, never taken for you |
| [secrets.md](secrets.md) | Secrets: combinations, boss forms and trims found by playing, written in the Book's margin |
| [final-form.md](final-form.md) | Final Form: two evolutions in a run crown the tower in its frame's form |
| [act2.md](act2.md) | Pacts and heat, Starlight, the Constellations, the Abyss |
| [save.md](save.md) | Profile, migration ladder, run snapshot, storage backends |
| [store-listing.md](store-listing.md) | The Play listing: name, descriptions, screenshots, Data safety |
| [render.md](render.md) | Renderer, painters, effects, camera, palette, quality tiers |
| [audio.md](audio.md) | The synth, its buses, the cue map, the music |
| [ui.md](ui.md) | HUD, draft panel, results, the hub and its views, settings, accessibility |
| [performance.md](performance.md) | Budgets, caps, the frame-budget test and harness, the quality scaler |
| [balancing.md](balancing.md) | The pacing, inspect and arsenal tools; invariants I1–I6 |
| [testing.md](testing.md) | What the suite covers and where |
