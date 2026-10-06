export enum BattleType {
  WILD,
  TRAINER,
  // TODO: This leaves a hole in the enum members and is basically never used
  CLEAR,
  MYSTERY_ENCOUNTER,
  /**
   * An online 1v1/2v2 battle against another human player.
   * @see docs/pvp-online-battle-design.md
   */
  PVP,
}
