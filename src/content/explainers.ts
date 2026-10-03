/**
 * Explainers (§7.1): a short note on a mechanic, shown once the first time
 * the player meets it in the hub, and again behind the view's "?". Each is
 * a few plain sentences: what it is, why it matters, and whether it changes
 * a run. When each one opens is `meta/explainers.ts#explainerOpen`.
 *
 * Not a `CONTENT` table: these run past R4's fifteen words by design.
 */

/** Where an explainer is told: one of the hub's views (`ui/hub/hub.ts#HubView`). */
export type ExplainerView = 'home' | 'forge' | 'map' | 'collection' | 'feats' | 'stars' | 'tactics' | 'pacts';

export type ExplainerId =
  | 'tower'
  | 'forge'
  | 'map'
  | 'trials'
  | 'abyss'
  | 'rush'
  | 'bestiary'
  | 'relics'
  | 'recipes'
  | 'frames'
  | 'feats'
  | 'stars'
  | 'tactics'
  | 'pacts';

export interface ExplainerDef {
  readonly id: ExplainerId;
  readonly view: ExplainerView;
  readonly title: string;
  /** Paragraphs, each a sentence or two. */
  readonly lines: readonly string[];
}

/** In the order a view tells them, when several open at once. */
export const EXPLAINERS: readonly ExplainerDef[] = [
  {
    id: 'tower', view: 'home', title: 'The tower’s look',
    lines: [
      'The tower wears what you have earned: a new course of stone for each Forge ring you complete, a light for each overtime trophy, and a trim for each Trial that pays one.',
      'All of it is cosmetic. It shows how far you have come and changes no stats.',
    ],
  },
  {
    id: 'forge', view: 'forge', title: 'The Forge',
    lines: [
      'Shards from every run are spent here, on upgrades that last forever. Buying a node reveals its neighbours.',
      'Minor nodes are stat steps you can level up. Notables unlock something new: a weapon, a slot, an automation. Keystones are big trades that shape a build.',
      'Some nodes are sealed until you defeat a particular boss.',
    ],
  },
  {
    id: 'map', view: 'map', title: 'The Map',
    lines: [
      'Each boss you defeat opens the next region. Pick a region here: the next run is fought there.',
      'Later regions are harder and pay more shards. Each one has its own enemies and a rule that bends the fight.',
      'Holding out past a region’s boss (overtime) earns trophies at +5, +10 and +15 waves: a one-time shard payout and a light on the tower.',
    ],
  },
  {
    id: 'trials', view: 'map', title: 'Trials',
    lines: [
      'A defeated region offers three Trials: runs there under a fixed rule, such as one weapon or no passives. Defeat the region’s boss to win one.',
      'Each pays once. A relic rank and a notable change your runs; a tower trim is cosmetic.',
    ],
  },
  {
    id: 'abyss', view: 'map', title: 'The Abyss',
    lines: [
      'An endless descent, floor after floor of ten waves, with a boss closing each. There is no end, only how deep you get.',
      'A new deepest floor pays Starlight. Pacts don’t apply here.',
    ],
  },
  {
    id: 'rush', view: 'map', title: 'Boss Rush',
    lines: [
      'Every boss, back to back, against the clock. The tower starts high-level, with its drafts banked.',
      'Clearing a new stage, or a faster full clear, pays Starlight.',
    ],
  },
  {
    id: 'bestiary', view: 'collection', title: 'The Collection',
    lines: [
      'A record of what you have found. The Bestiary lists every enemy you have seen, what each one does and how many you have slain.',
      'More pages open as you find relics, evolutions and new frames.',
    ],
  },
  {
    id: 'relics', view: 'collection', title: 'Relics',
    lines: [
      'Bosses and elites drop relics. Wear them in your relic slots and they apply to every run. Defeating certain bosses adds slots.',
      'A duplicate ranks a relic up, to rank III. Wearing a region’s three elite relics together gives a set bonus.',
    ],
  },
  {
    id: 'recipes', view: 'collection', title: 'Recipes',
    lines: [
      'Once the Forge’s Alchemy is owned, a weapon at level 5 with its partner passive at level 5 can evolve into something stronger: its card joins the draft. The Recipe Book tracks the pairs.',
      'Carrying a weapon reveals its half of a recipe. Taking it to its last level adds a riddle that points at the other half.',
    ],
  },
  {
    id: 'frames', view: 'collection', title: 'Frames',
    lines: [
      'A frame is the tower’s body. Each has its own starting weapon, stats and ultimate.',
      'Choose one here; the next run uses it.',
    ],
  },
  {
    id: 'feats', view: 'feats', title: 'Feats',
    lines: [
      'Feats are challenges worth chasing: a build, a region’s answer, a boss beaten a particular way.',
      'Each pays shards once. Earned feats wait here until you claim them.',
    ],
  },
  {
    id: 'stars', view: 'stars', title: 'The Constellations',
    lines: [
      'A second web, paid in Starlight. Its stars bring new weapons and fusions, frames, relic sets and an extra slot, and endless Forge masteries.',
      'Starlight comes from beating regions at a new heat record, new Abyss depths, Boss Rush records and Act 2’s feats. Nothing here refunds.',
    ],
  },
  {
    id: 'tactics', view: 'tactics', title: 'The Tactician',
    lines: [
      'Rank the cards you want and the draft suggests them first, ahead of its own judgement. An evolution still comes first.',
      'Cards on the Never list are suggested only when nothing else is offered.',
    ],
  },
  {
    id: 'pacts', view: 'pacts', title: 'Pacts and heat',
    lines: [
      'Pacts make the regions harder, rank by rank. Their total is your heat.',
      'Each point of heat adds 10% shards. Defeating a region’s boss at a new heat record pays Starlight.',
      'Pacts apply to the regions only, not the Abyss or Boss Rush.',
    ],
  },
];

export const EXPLAINER_BY_ID: Readonly<Record<ExplainerId, ExplainerDef>> = Object.fromEntries(
  EXPLAINERS.map((e) => [e.id, e]),
) as Record<ExplainerId, ExplainerDef>;
