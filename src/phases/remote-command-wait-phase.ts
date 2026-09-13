import type { TurnCommand } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveUseMode } from "#enums/move-use-mode";
import type { TurnCommandDto } from "#net/pvp-protocol-types";
import { getPvpSession } from "#net/pvp-session";
import { FieldPhase } from "#phases/field-phase";

/**
 * PvP counterpart to {@linkcode EnemyCommandPhase}.
 *
 * Where `EnemyCommandPhase` asks the AI to decide a command for an enemy-side Pokémon,
 * this phase instead waits for the PvP server to broadcast the remote human opponent's
 * command for the current turn, then writes it into {@linkcode Battle.turnCommands} in
 * exactly the same shape `EnemyCommandPhase` would have. Every phase downstream of
 * `TurnInitPhase` (`TurnStartPhase`, `MovePhase`, etc.) is therefore unaffected and requires
 * no PvP-specific changes.
 * @see docs/pvp-online-battle-design.md §9.3
 */
export class RemoteCommandWaitPhase extends FieldPhase {
  public readonly phaseName = "RemoteCommandWaitPhase";
  protected fieldIndex: number;

  constructor(fieldIndex: number) {
    super();

    this.fieldIndex = fieldIndex;
  }

  public override async start(): Promise<void> {
    super.start();

    const battlerIndex = BattlerIndex.ENEMY + this.fieldIndex;
    const session = getPvpSession();

    if (!session) {
      // Should never happen outside of a `BattleType.PVP` battle; fail safe rather than
      // soft-locking the turn queue.
      console.error("RemoteCommandWaitPhase started with no active PvP session; skipping this Pokemon's turn");
      globalScene.currentBattle.turnCommands[battlerIndex] = { command: Command.FIGHT, skip: true };
      this.end();
      return;
    }

    const dto = await session.waitForTurnCommand(globalScene.currentBattle.turn, battlerIndex);
    globalScene.currentBattle.turnCommands[battlerIndex] = RemoteCommandWaitPhase.toTurnCommand(dto);
    this.end();
  }

  /** Convert a network {@linkcode TurnCommandDto} into the engine's {@linkcode TurnCommand} shape. */
  private static toTurnCommand(dto: TurnCommandDto): TurnCommand {
    const turnCommand: TurnCommand = { command: dto.command };
    if (dto.cursor !== undefined) {
      turnCommand.cursor = dto.cursor;
    }
    if (dto.targets !== undefined) {
      turnCommand.targets = dto.targets;
    }
    if (dto.move !== undefined) {
      turnCommand.move = { move: dto.move.move, targets: dto.move.targets, useMode: MoveUseMode.NORMAL };
    }
    return turnCommand;
  }

  getFieldIndex(): number {
    return this.fieldIndex;
  }
}
