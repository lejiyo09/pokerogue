/*
 * Module holding functions to apply move attributes.
 * Must not import anything that is not a type.
 */

import type { Pokemon } from "#field/pokemon";
import type { Move, MoveAttr } from "#moves/move";
import type { ChargingMove, MoveAttrFilter, MoveAttrString } from "#types/move-types";

function applyMoveAttrsInternal(
  attrFilter: MoveAttrFilter,
  user: Pokemon | null,
  target: Pokemon | null,
  move: Move,
  args: any[],
): void {
  for (const attr of move.attrs) {
    if (attrFilter(attr)) {
      attr.apply(user, target, move, args);
    }
  }
}

function applyMoveChargeAttrsInternal(
  attrFilter: MoveAttrFilter,
  user: Pokemon | null,
  target: Pokemon | null,
  move: ChargingMove,
  args: any[],
): void {
  for (const attr of move.chargeAttrs) {
    if (attrFilter(attr)) {
      attr.apply(user, target, move, args);
    }
  }
}

export function applyMoveAttrs(
  attrType: MoveAttrString,
  user: Pokemon | null,
  target: Pokemon | null,
  move: Move,
  ...args: any[]
): void {
  // Goes through `move.getAttrs`, which caches its filtered result per `attrType`, rather than
  // `applyMoveAttrsInternal`'s generic (uncached) predicate scan. `attrType` isn't a literal here
  // (it's a runtime union-typed param), so the result is cast back to the base `MoveAttr` type -
  // matching what the old `attr: MoveAttr` predicate-based loop was statically typed as.
  for (const attr of move.getAttrs(attrType) as MoveAttr[]) {
    attr.apply(user, target, move, args);
  }
}

export function applyFilteredMoveAttrs(
  attrFilter: MoveAttrFilter,
  user: Pokemon,
  target: Pokemon | null,
  move: Move,
  ...args: any[]
): void {
  applyMoveAttrsInternal(attrFilter, user, target, move, args);
}

export function applyMoveChargeAttrs(
  attrType: MoveAttrString,
  user: Pokemon | null,
  target: Pokemon | null,
  move: ChargingMove,
  ...args: any[]
): void {
  applyMoveChargeAttrsInternal((attr: MoveAttr) => attr.is(attrType), user, target, move, args);
}
