/**
 * Runtime validation for every inbound {@linkcode ClientMessage}.
 *
 * `JSON.parse` succeeding only proves a message is syntactically valid JSON - it says nothing
 * about its *shape*. Without this, a malformed-but-parseable message (e.g. `SUBMIT_TEAM` whose
 * `pokemon` field is a string, or missing entirely) reaches business logic that assumes the shape
 * is correct and throws, which - left unguarded - would crash the whole process (see R3 fix
 * notes, docs/pvp-online-battle-design.md).
 * @module
 */

import { z } from "zod";
import type { ClientMessage } from "./protocol.js";

const ROOM_ID_MAX_LENGTH = 64;

const roomIdSchema = z.string().min(1).max(ROOM_ID_MAX_LENGTH);
const pvpModeSchema = z.enum(["single", "double"]);

const turnCommandDtoSchema = z.object({
  command: z.number(),
  cursor: z.number().optional(),
  move: z
    .object({
      move: z.number(),
      targets: z.array(z.number()),
    })
    .optional(),
  targets: z.array(z.number()).optional(),
});

const pvpPartyMemberDtoSchema = z.object({
  species: z.number().int().nonnegative(),
  level: z.number().int().min(1).max(100),
  moves: z.array(z.number().int().nonnegative()).min(1).max(4),
  id: z.number().int().nonnegative(),
  abilityIndex: z.number().int().min(0),
  formIndex: z.number().int().min(0),
  gender: z.number().int(),
  shiny: z.boolean(),
  variant: z.number().int().min(0).max(2),
  ivs: z.array(z.number().int().min(0).max(31)).length(6),
  nature: z.number().int(),
});

const createRoomMessageSchema = z.object({
  type: z.literal("CREATE_ROOM"),
  mode: pvpModeSchema,
});

const joinRoomMessageSchema = z.object({
  type: z.literal("JOIN_ROOM"),
  roomId: roomIdSchema,
});

const leaveRoomMessageSchema = z.object({
  type: z.literal("LEAVE_ROOM"),
  roomId: roomIdSchema,
});

const submitTeamMessageSchema = z.object({
  type: z.literal("SUBMIT_TEAM"),
  roomId: roomIdSchema,
  pokemon: z.array(pvpPartyMemberDtoSchema).min(1).max(6),
});

const readyMessageSchema = z.object({
  type: z.literal("READY"),
  roomId: roomIdSchema,
});

const submitCommandMessageSchema = z.object({
  type: z.literal("SUBMIT_COMMAND"),
  roomId: roomIdSchema,
  turn: z.number().int().min(1),
  fieldIndex: z.number().int().min(0).max(1),
  command: turnCommandDtoSchema,
});

const stateHashMessageSchema = z.object({
  type: z.literal("STATE_HASH"),
  roomId: roomIdSchema,
  turn: z.number().int().min(1),
  hash: z.string(),
});

const forfeitMessageSchema = z.object({
  type: z.literal("FORFEIT"),
  roomId: roomIdSchema,
});

const clientMessageSchema = z.discriminatedUnion("type", [
  createRoomMessageSchema,
  joinRoomMessageSchema,
  leaveRoomMessageSchema,
  submitTeamMessageSchema,
  readyMessageSchema,
  submitCommandMessageSchema,
  stateHashMessageSchema,
  forfeitMessageSchema,
]);

export type ParseClientMessageResult = { success: true; data: ClientMessage } | { success: false; error: string };

/** Validate an arbitrary parsed-JSON value as a {@linkcode ClientMessage}. Never throws. */
export function parseClientMessage(raw: unknown): ParseClientMessageResult {
  const result = clientMessageSchema.safeParse(raw);
  if (result.success) {
    // `ClientMessage` and the schema's inferred output are structurally identical; the schema is
    // the source of truth for validation, `ClientMessage` for the type the rest of the server code
    // consumes.
    return { success: true, data: result.data as ClientMessage };
  }
  const error = result.error.issues
    .map(issue => `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`)
    .join("; ");
  return { success: false, error: error || "Invalid message" };
}
