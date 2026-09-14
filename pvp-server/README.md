# PokéRogue PvP Server

A minimal, standalone WebSocket server for PokéRogue's online 1v1 (and, in a double battle, 2v2)
PvP battles. See `docs/pvp-online-battle-design.md` in the client repo for the full design this
implements, and its §9.1 for why this currently lives as a directory here rather than its own
repository.

This server is **not** part of the client's Vite/Phaser build. It is a separate Node.js project
with its own `package.json`/`node_modules`/lockfile, on purpose: the real battle simulation still
runs entirely client-side (see the design doc §5), so the server only needs to do connection
bookkeeping, not run the game engine.

## What this server actually does

- Rooms: `CREATE_ROOM` / `JOIN_ROOM` by a 6-character room code, up to 2 seats each.
- Team + ready handshake: `SUBMIT_TEAM` + `READY` from both seats triggers `BATTLE_START`, which
  carries a server-generated `battleSeed` (identical for both seats, so their local battle engines
  compute identical results - see design doc §8.2) and each seat's opponent's submitted team.
- Turn command exchange: `SUBMIT_COMMAND` is buffered per room/turn/seat. A `TURN_READY` (carrying
  **only the opponent's** command) is sent to both seats **only once both have submitted** for
  that turn - a seat is never told anything about the other seat's command before it has committed
  its own (see design doc §5.2, "commit-reveal").
- Disconnect notification: on socket close, the other seat (if any) gets a `DISCONNECT` message.
- Forfeit: `FORFEIT` immediately broadcasts `BATTLE_END`.

All state is in-memory (`RoomManager`/`Room`) - restarting the process drops every active room.
That's an accepted limitation for this stage (see "Known gaps" below), not an oversight.

## Running it

```sh
cd pvp-server
pnpm install   # or: npm install
pnpm run dev   # ws://localhost:8081 by default; set PORT to override
```

Point the client at it via `VITE_PVP_SERVER_URL=ws://localhost:8081` (see the client's
`src/vite.env.d.ts` and `.env.development`).

## Testing

```sh
pnpm test        # node:test - exercises Room's command-mirroring/withholding logic directly
pnpm typecheck
```

The `Room` tests are the ones worth reading first: they're what pin down the "never reveal one
seat's command before the other has submitted" and "pair commands by turn number" behavior that
the rest of this server exists to enforce.

## Known gaps (intentionally out of scope for this pass)

These are not implemented, and PvP should not be considered "done" until they are:

- **Reconnection.** A dropped connection just tears down the room; there is no session/resume
  flow (design doc §6.2's `RECONNECT` message is not implemented).
- **Battle-end detection.** `BATTLE_END` is only ever sent for an explicit `FORFEIT`. The server
  has no idea when a battle is actually won/lost (that happens entirely client-side, in
  `FaintPhase`/`GameOverPhase`/`VictoryPhase`); it doesn't clean up or record match results when a
  battle concludes normally.
- **State-hash verification.** `STATE_HASH` messages are accepted and silently discarded. The
  cross-client divergence detection described in design doc §7.3/§12 (comparing both clients'
  post-turn state hashes to catch a tampered or desynced client) is not implemented.
- **Move/switch legality validation.** The server relays whatever `TurnCommandDto` a client sends
  without checking it's a move the sender's Pokémon actually knows, has PP for, etc. (design doc
  §12, "명령 위조"). Both clients' local `CommandPhase` already prevent illegal input through
  normal UI flow, but a modified client could send anything.
- **Double battles.** `Room`/the protocol carry a `double` flag end-to-end, but only
  `fieldIndex: 0` (single battle) has actually been exercised.
- **Persistence/scaling.** Single process, in-memory only; not meant for production deployment as-is.
