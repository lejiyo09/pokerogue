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

- Rooms: `CREATE_ROOM` / `JOIN_ROOM` by a 6-character room code, up to 2 seats each. A socket that
  already occupies a seat (in this room or another) cannot create or join a second one - this also
  rules out a socket ever joining the very room it just created.
- A room's lifecycle is an explicit state machine (`team_select` -> `in_battle` -> `ended`, never
  backward - see `Room.status`). Messages are only accepted in the state they make sense in: e.g. a
  resent `READY` after the battle has already started is rejected rather than re-triggering
  `BATTLE_START`, and `JOIN_ROOM`/`SUBMIT_COMMAND` are rejected once a room is `in_battle`/`ended`.
- Team + ready handshake: `SUBMIT_TEAM` + `READY` from both seats triggers `BATTLE_START`, which
  carries a server-generated `battleSeed` (identical for both seats, so their local battle engines
  compute identical results - see design doc §8.2) and each seat's opponent's submitted team. Each
  submitted Pokémon (`PvpPartyMemberDto`) carries its full identity (IVs, ability, form, gender,
  shininess/variant, nature, id) - not just species/level/moves - captured once from a real
  construction on the submitting client and applied identically on both clients, so a `PlayerPokemon`
  built from it on one client and an `EnemyPokemon` built from the same DTO on the other are
  byte-for-byte identical (see `src/net/pvp-team-setup.ts` in the client repo).
- Turn command exchange: `SUBMIT_COMMAND` is buffered per room/turn/seat. A `TURN_READY` (carrying
  **only the opponent's** command) is sent to both seats **only once both have submitted** for
  that turn - a seat is never told anything about the other seat's command before it has committed
  its own (see design doc §5.2, "commit-reveal"). The room tracks its own current turn number
  server-side and never trusts a client's `turn` field at face value: a turn older than the room's
  current one is rejected as stale, one newer is rejected as not-yet-valid, and a seat resubmitting
  for a turn it already has a pending command for is rejected rather than silently overwritten.
- Every inbound message is validated against a schema (Zod) before it reaches any business logic -
  not just "is this valid JSON", but the full shape (`SUBMIT_TEAM.pokemon` being an array of
  well-typed Pokémon, IVs in range, etc). A malformed message only ever errors the sending socket;
  it can never crash the process or corrupt another room's state (the whole dispatch path is also
  wrapped in a try/catch as a last-resort backstop).
- Disconnect notification: on socket close, the other seat (if any) gets a `DISCONNECT` message,
  and if the room was `in_battle`, it's marked `ended` so no further command is accepted.
- Forfeit: `FORFEIT` immediately broadcasts `BATTLE_END` (rejected if the room already ended).

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
pnpm test        # node:test - Room's command-mirroring/turn-tracking logic, and app.ts's message dispatch
pnpm typecheck
```

`test/room.test.ts` pins down `Room`'s own invariants directly: "never reveal one seat's command
before the other has submitted", "pair commands by turn number", the `team_select`/`in_battle`/
`ended` state machine, and server-side turn-number validation (stale/future/duplicate rejection).
`test/app.test.ts` exercises the same things through the actual message-dispatch path
(`handleMessage`/`dispatchMessage`) with fake sockets - the already-seated-socket guard, schema
validation rejecting malformed messages without crashing, and the state-machine guards as seen from
a client's perspective.

## Known gaps (intentionally out of scope for this pass)

These are not implemented, and PvP should not be considered "done" until they are:

- **Reconnection.** A dropped connection just tears down the room; there is no session/resume
  flow (design doc §6.2's `RECONNECT` message is not implemented).
- **Battle-end detection.** `BATTLE_END` is only ever sent for an explicit `FORFEIT` (including the
  client-side one `RemoteCommandWaitPhase` now sends if it ever fails to receive the opponent's
  turn command - see the client repo's `docs/pvp-online-battle-design.md`, R4 fix notes). The
  server still has no idea when a battle is actually won/lost through normal play (that happens
  entirely client-side, in `FaintPhase`/`GameOverPhase`/`VictoryPhase`); it doesn't clean up or
  record match results when a battle concludes normally.
- **State-hash verification.** `STATE_HASH` messages are accepted and silently discarded. The
  cross-client divergence detection described in design doc §7.3/§12 (comparing both clients'
  post-turn state hashes to catch a tampered or desynced client) is not implemented.
- **Move/switch legality validation.** The server relays whatever `TurnCommandDto` a client sends
  without checking it's a move the sender's Pokémon actually knows, has PP for, etc. (design doc
  §12, "명령 위조"). Both clients' local `CommandPhase` already prevent illegal input through
  normal UI flow, but a modified client could send anything. (Schema validation now guarantees the
  message is *well-formed*, e.g. real numbers/arrays of the right shape - it does not guarantee
  it's a *legal* move for that Pokémon.)
- **Double battles.** `Room`/the protocol carry a `double` flag end-to-end, but only
  `fieldIndex: 0` (single battle) has actually been exercised.
- **Persistence/scaling.** Single process, in-memory only; not meant for production deployment as-is.
