import { Battle } from "#app/battle";
import type { GameMode } from "#app/game-mode";
import type { NewBattleResolvedProps } from "#types/new-battle-props";

/**
 * A {@linkcode Battle} used for online PvP matches.
 *
 * Identical to a regular {@linkcode Battle} except that its {@linkcode Battle.battleSeed | battleSeed}
 * is supplied by the PvP server instead of being generated locally, so that both participants'
 * clients replay the exact same sequence of battle RNG results.
 * @see docs/pvp-online-battle-design.md §8.2
 */
export class PvpBattle extends Battle {
  constructor(gameMode: GameMode, props: NewBattleResolvedProps, battleSeed: string) {
    super(gameMode, props);
    this.battleSeed = battleSeed;
  }
}
