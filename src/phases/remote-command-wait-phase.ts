import type { TurnCommand } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveUseMode } from "#enums/move-use-mode";
import type { TurnCommandDto } from "#net/pvp-protocol-types";
import type { PvpRoomManager } from "#net/pvp-room-manager";
import { getPvpSession } from "#net/pvp-session";
import { FieldPhase } from "#phases/field-phase";

/**
 * PvP counterpart to {@linkcode EnemyCommandPhase}.
 *
 * Where `EnemyCommandPhase` asks the AI to decide a command for an enemy-side Pokémon, this phase
 * instead:
 * 1. Sends the *local* player's just-finalized command (written by the preceding `CommandPhase`
 *    for the same `fieldIndex`, which always runs immediately before this phase within the same
 *    turn) to the PvP server.
 * 2. Waits for the server to relay the remote human opponent's command for the current turn -
 *    which it will only do once *both* sides have submitted (see
 *    `docs/pvp-online-battle-design.md` §5.2/§9.3, and `pvp-server/src/room.ts`) - then writes it
 *    into {@linkcode Battle.turnCommands} in exactly the shape `EnemyCommandPhase` would have.
 *
 * Every phase downstream of `TurnInitPhase` (`TurnStartPhase`, `MovePhase`, etc.) is therefore
 * unaffected and requires no PvP-specific changes.
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

    const session = getPvpSession();
    if (!session) {
      // Should never happen outside of a `BattleType.PVP` battle; fail safe rather than
      // soft-locking the turn queue.
      console.error("RemoteCommandWaitPhase started with no active PvP session; skipping this Pokemon's turn");
      globalScene.currentBattle.turnCommands[BattlerIndex.ENEMY + this.fieldIndex] = {
        command: Command.FIGHT,
        skip: true,
      };
      this.end();
      return;
    }

    const turn = globalScene.currentBattle.turn;
    this.sendOwnCommand(session, turn);

    let dto: TurnCommandDto;
    try {
      dto = await session.waitForTurnCommand(turn, BattlerIndex.ENEMY + this.fieldIndex);
    } catch (error) {
      // The opponent's command may never arrive (disconnect, a hung client, the battle having
      // ended) - `waitForTurnCommand` is guaranteed to eventually reject rather than hang forever
      // in that case (see `PvpRoomManager`, R4 fix notes). This phase must still never permanently
      // occupy a phase slot, so always fall through to `this.end()` below regardless.
      console.error(`RemoteCommandWaitPhase: failed to receive the opponent's turn ${turn} command:`, error);
      try {
        // Ask the server to end the match through the existing FORFEIT -> BATTLE_END path, which
        // `TitlePhase.beginPvpBattle`'s `onBattleEnd` handler already reacts to - reusing that
        // existing teardown/UI flow rather than introducing a new PvP-specific end phase. This is
        // a best-effort call: if the socket is already closed (e.g. the opponent disconnected),
        // there is nothing left to notify.
        session.forfeit();
      } catch {
        // Socket already closed - nothing more to send.
      }
      globalScene.currentBattle.turnCommands[BattlerIndex.ENEMY + this.fieldIndex] = {
        command: Command.FIGHT,
        skip: true,
      };
      this.end();
      return;
    }

    globalScene.currentBattle.turnCommands[BattlerIndex.ENEMY + this.fieldIndex] =
      RemoteCommandWaitPhase.toTurnCommand(dto);
    this.end();
  }

  /**
   * Send the local player's own already-finalized command for this turn to the opponent, via the
   * server. By the time this phase runs, `CommandPhase(this.fieldIndex)` (and, if applicable, the
   * `SelectTargetPhase` it may have unshifted) has already fully populated
   * `turnCommands[this.fieldIndex]` - see `TurnInitPhase`, which always queues this phase
   * immediately after that `CommandPhase`.
   */
  private sendOwnCommand(session: PvpRoomManager, turn: number): void {
    const ownCommand = globalScene.currentBattle.turnCommands[this.fieldIndex];
    if (!ownCommand) {
      console.error(`RemoteCommandWaitPhase: no local command found for field index ${this.fieldIndex} to send`);
      return;
    }
    session.sendTurnCommand(turn, this.fieldIndex, RemoteCommandWaitPhase.toDto(ownCommand));
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

  /** Convert the engine's {@linkcode TurnCommand} shape into a serializable {@linkcode TurnCommandDto}. */
  private static toDto(command: TurnCommand): TurnCommandDto {
    const dto: TurnCommandDto = { command: command.command };
    if (command.cursor !== undefined) {
      dto.cursor = command.cursor;
    }
    if (command.targets !== undefined) {
      dto.targets = command.targets;
    }
    if (command.move !== undefined) {
      dto.move = { move: command.move.move, targets: command.move.targets };
    }
    return dto;
  }

  getFieldIndex(): number {
    return this.fieldIndex;
  }
}
