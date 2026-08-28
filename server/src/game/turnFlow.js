const { SIDES, OPPOSITE_SIDE } = require('./doorLayout');
const { canMoveBetween, placeNewRoom, placeRoomAt, placeAtRandomOpenDoor, coordKey, DIRECTION_DELTA, isDoorLayoutFeasible } = require('./boardGenerator');
const { drawFeasibleRoom, hasRoomForFloor, removeRoomById } = require('./roomDeck');
const { dropToBasement } = require('./collapseFall');
const { getPlayer } = require('./gameState');
const { movePlayerTo, resetActionPoints, getStatValue, changeStat, addItem, clearEquipStateIfNeeded } = require('./playerEntity');
const { rollDice, applyModifiers } = require('./effectPipeline');
const { findInterjectionOptions } = require('./diceInterjection');

const ACTION_TYPES = ['item', 'attack', 'room_action'];

const COLLAPSED_ROOM_ID = 'room_collapsed_room';
const COLLAPSE_CHECK_STAT = 'speed';
const COLLAPSE_CHECK_MIN = 5;

const OPEN_DOOR_AP_COST = 2;
const OPEN_DOOR_AP_COST_WITH_MASTER_KEY = 1;
const MASTER_KEY_ITEM_ID = 'item_028';

function getOpenDoorCost(player) {
  const holdsMasterKey = player.inventory.some((item) => item.id === MASTER_KEY_ITEM_ID);
  return holdsMasterKey ? OPEN_DOOR_AP_COST_WITH_MASTER_KEY : OPEN_DOOR_AP_COST;
}

const BALLROOM_ID = 'room_ballroom';
const GALLERY_ID = 'room_gallery';

function isBallroomOrGallery(id) {
  return id === BALLROOM_ID || id === GALLERY_ID;
}
function pairedFloorFor(id) {
  return id === BALLROOM_ID ? 'upper' : 'ground';
}
function pairedIdFor(id) {
  return id === BALLROOM_ID ? GALLERY_ID : BALLROOM_ID;
}

function requirePlayer(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (!player) {
    throw new Error('PLAYER_NOT_FOUND');
  }
  return player;
}

function hasModifierEffect(player, hookType) {
  return (player.modifiers || []).some((m) => m.effects.some((e) => e.hookType === hookType));
}

function getAvailableDirections(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const grid = gameState.board[player.floor];
  const room = grid.get(coordKey(player.x, player.y));
  const results = [];
  const doorSides = Array.isArray(room.doorSides) ? room.doorSides : [];
  const blockedFromOpeningDoors = hasModifierEffect(player, 'blocksOpenDoor');
  const canAffordOpenDoor = player.actionPoints >= getOpenDoorCost(player);
  for (const direction of SIDES) {
    if (!doorSides.includes(direction)) continue;
    const delta = DIRECTION_DELTA[direction];
    const neighborCoord = { x: player.x + delta.dx, y: player.y + delta.dy };
    const neighborRoom = grid.get(coordKey(neighborCoord.x, neighborCoord.y));
    if (neighborRoom) {
      if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, direction)) {
        results.push({ direction, kind: 'move' });
      }
    } else if (!blockedFromOpeningDoors && canAffordOpenDoor && hasRoomForFloor(gameState.roomDeck, player.floor)) {
      results.push({ direction, kind: 'open_door' });
    }
  }
  return results;
}

function moveToRoom(gameState, playerId, direction, leaveCheck = null, rollOptions = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const available = getAvailableDirections(gameState, playerId);
  const choice = available.find((a) => a.direction === direction);
  if (!choice) {
    throw new Error('INVALID_MOVE_DIRECTION');
  }

  let leaveCheckResult;
  if (leaveCheck) {
    // e.g. 塔橋/雜亂的房間/藤蔓糾纏的溫室 -- leaving this room (either to an
    // already-placed neighbor or by opening a new door) requires a stat
    // check first. A failed check costs the same 1 AP a normal move
    // attempt would, and never draws/places a new room -- the player never
    // actually left, so nothing about the door they tried is revealed.
    // Captured unconditionally (not just in the direct-roll sub-branch below)
    // so it's available whether this call rolls synchronously or receives an
    // already-resolved roll via resolvedRoll (the dice-interjection resume path).
    const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
    const { itemCatalog, resolvedRoll, rng } = rollOptions;
    let rolled;
    if (resolvedRoll !== undefined) {
      rolled = resolvedRoll;
    } else {
      const options = findInterjectionOptions(player, itemCatalog || [], null);
      if (options.length > 0) {
        // Mirrors handleDiceCheck's pending shape -- caller opens a
        // pendingRollChoice and resumes with a resolvedRoll instead.
        return { kind: 'leaveCheckPending', rollChoice: true, options, leaveCheck, direction };
      }
      const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];
      const diceCount = getStatValue(player, leaveCheck.stat);
      const adjustedCount = Math.max(1, Math.min(8, applyModifiers(diceCount, modifiers, 'onBeforeRoll', {})));
      rolled = applyModifiers(rollDice(adjustedCount, rng || Math.random), modifiers, 'onAfterRoll', {});
    }
    leaveCheckResult = {
      stat: leaveCheck.stat,
      roomId: room.roomId,
      rolled,
      required: leaveCheck.min,
      passed: rolled >= leaveCheck.min,
    };
    if (rolled < leaveCheck.min) {
      player.actionPoints -= 1;
      if (leaveCheck.failPenalty) {
        // e.g. 天花閣樓/五芒星室/墓園/髒亂的房間 -- some leaveCheck rooms'
        // official text also costs a stat level on a failed check, distinct
        // from the stat being checked (see room text). 塔橋/雜亂的房間/藤蔓
        // 糾纏的溫室 have no such clause -- their data has no failPenalty,
        // so this is skipped for them, matching their sourced text exactly.
        changeStat(player, leaveCheck.failPenalty.stat, leaveCheck.failPenalty.delta, gameState.hauntStarted);
      }
      return { kind: 'leaveCheckFailed', rolled, required: leaveCheck.min, leaveCheckResult };
    }
  }

  const delta = DIRECTION_DELTA[direction];
  const targetCoord = { x: player.x + delta.dx, y: player.y + delta.dy };

  if (choice.kind === 'move') {
    const enteredNewRoom = movePlayerTo(player, player.floor, targetCoord.x, targetCoord.y, OPPOSITE_SIDE[direction]);
    player.actionPoints -= 1;
    return { kind: 'move', x: targetCoord.x, y: targetCoord.y, enteredNewRoom, ...(leaveCheckResult ? { leaveCheckResult } : {}) };
  }

  // 舞廳 & 包廂房 -- drawing either one must also place its pair at the same
  // (x, y) on the paired floor. If that coordinate is already occupied, the
  // whole draw is rejected (card goes back to the bottom of the deck) and a
  // different card is drawn instead -- unless this was the last card
  // available for this floor, in which case the draw is allowed through and
  // the pair falls back to a random open door on its own floor instead of
  // insisting on the same coordinate (handled in placeBallroomGalleryPair).
  const isFeasible = (room) =>
    isDoorLayoutFeasible(gameState.board, player.floor, { x: player.x, y: player.y }, direction, room.doors, room.doorPattern);
  let roomDefinition = drawFeasibleRoom(gameState.roomDeck, player.floor, isFeasible);
  // A room rejected below for a paired-coordinate conflict must never be
  // offered again within this same retry loop -- drawFeasibleRoom has no
  // memory of what it already handed back, so if every OTHER same-floor
  // card is infeasible at this position while the rejected room itself
  // remains feasible, it would keep re-surfacing forever (the
  // paired-coordinate conflict never resolves just by re-drawing the same
  // card). Excluding already-rejected ids restores the same
  // guaranteed-progress property the old plain drawRoom had.
  const rejectedIds = new Set();
  while (isBallroomOrGallery(roomDefinition.id)) {
    const pairedFloor = pairedFloorFor(roomDefinition.id);
    const pairedOccupied = gameState.board[pairedFloor].has(coordKey(targetCoord.x, targetCoord.y));
    if (!pairedOccupied) break;
    if (!hasRoomForFloor(gameState.roomDeck, player.floor)) break; // last card for this floor -- let it through anyway
    rejectedIds.add(roomDefinition.id);
    gameState.roomDeck.cards.push(roomDefinition); // rejected -- back to the bottom, draw again
    roomDefinition = drawFeasibleRoom(
      gameState.roomDeck,
      player.floor,
      (room) => !rejectedIds.has(room.id) && isFeasible(room)
    );
  }

  const placedRoom = placeNewRoom(
    gameState.board,
    player.floor,
    { x: player.x, y: player.y },
    direction,
    roomDefinition
  );
  movePlayerTo(player, player.floor, placedRoom.x, placedRoom.y, OPPOSITE_SIDE[direction]);
  player.actionPoints -= getOpenDoorCost(player);
  const pendingCardDraw =
    roomDefinition.drawType && roomDefinition.drawType !== 'none'
      ? { deck: roomDefinition.drawType }
      : null;

  if (isBallroomOrGallery(roomDefinition.id)) {
    placeBallroomGalleryPair(gameState, roomDefinition, placedRoom);
  }

  if (roomDefinition.id === COLLAPSED_ROOM_ID) {
    // 崩塌的房間 -- speed check (5+) to dodge the hole in the floor. Reuses
    // the same dice-interjection pattern as leaveCheck (see the leaveCheck
    // branch above) rather than rolling in isolation.
    const { itemCatalog, rng } = rollOptions;
    const options = findInterjectionOptions(player, itemCatalog || [], null);
    if (options.length > 0) {
      return {
        kind: 'collapseCheckPending',
        rollChoice: true,
        options,
        x: placedRoom.x,
        y: placedRoom.y,
        roomId: placedRoom.roomId,
        pendingCardDraw,
        ...(leaveCheckResult ? { leaveCheckResult } : {}),
      };
    }
    const diceCount = getStatValue(player, COLLAPSE_CHECK_STAT);
    const rolled = applyModifiers(rollDice(diceCount, rng || Math.random), player.modifiers || [], 'onAfterRoll', {});
    const collapseResult = applyCollapseCheck(gameState, player, placedRoom, rolled);
    return {
      kind: 'open_door',
      x: placedRoom.x,
      y: placedRoom.y,
      roomId: placedRoom.roomId,
      pendingCardDraw,
      collapseResult,
      enteredNewRoom: true,
      ...(leaveCheckResult ? { leaveCheckResult } : {}),
    };
  }

  return {
    kind: 'open_door',
    x: placedRoom.x,
    y: placedRoom.y,
    roomId: placedRoom.roomId,
    pendingCardDraw,
    enteredNewRoom: true,
    ...(leaveCheckResult ? { leaveCheckResult } : {}),
  };
}

// Places the ballroom/gallery pair once one of them has just been placed at
// `placedRoom`. The pair's card is pulled directly out of the room deck by
// id (not drawn through a door) and consumed the same way -- so it can
// never later be independently drawn as if it were still available.
function placeBallroomGalleryPair(gameState, roomDefinition, placedRoom) {
  const pairedId = pairedIdFor(roomDefinition.id);
  const pairedFloor = pairedFloorFor(roomDefinition.id);
  const pairedDefinition = removeRoomById(gameState.roomDeck, pairedId);
  if (!pairedDefinition) {
    // Pair card isn't in the deck (unexpected content inconsistency) --
    // nothing to pair against, leave the drawn room as a standalone room.
    return null;
  }
  const grid = gameState.board[pairedFloor];
  const guaranteedSide = SIDES[Math.floor(Math.random() * SIDES.length)];
  if (!grid.has(coordKey(placedRoom.x, placedRoom.y))) {
    return placeRoomAt(gameState.board, pairedFloor, placedRoom.x, placedRoom.y, pairedDefinition, guaranteedSide);
  }
  // Exception path: target occupied -- only reachable here because this was
  // the last card for the drawn room's own floor, so the reject+redraw loop
  // in moveToRoom let it through anyway. Fall back to a random open door.
  return placeAtRandomOpenDoor(gameState.board, pairedFloor, pairedDefinition);
}

// Resolves the collapse check's outcome once a final roll is known (whether
// rolled synchronously above or after a dice-interjection round-trip via
// resumeCollapseCheck below). A pass leaves the room as-is; a fail draws a
// new basement room at the same (x, y) and drops the player through.
// Physical damage ("受到1顆骰子的物理傷害") is NOT applied here -- the M3
// damage-distribution system (player picks which stat absorbs each point)
// doesn't exist yet. This is a known, deliberate gap, not an oversight.
function applyCollapseCheck(gameState, player, placedRoom, rolled) {
  if (rolled >= COLLAPSE_CHECK_MIN) {
    return { fell: false, rolled, stat: COLLAPSE_CHECK_STAT, required: COLLAPSE_CHECK_MIN, roomId: placedRoom.roomId };
  }
  // dropToBasement also records placedRoom.collapseLink (on the collapsed
  // room's own board instance, not the static room definition) so later
  // players standing here can find where "down" leads without re-rolling --
  // see the room_action jump-down mechanic.
  const { basementRoomId, x, y } = dropToBasement(gameState, player, placedRoom);
  return {
    fell: true,
    rolled,
    stat: COLLAPSE_CHECK_STAT,
    required: COLLAPSE_CHECK_MIN,
    roomId: placedRoom.roomId,
    basementRoomId,
    x,
    y,
  };
}

// Called from socketHandlers.js after a pending collapse-check roll choice
// (dice interjection) resolves. The player is still standing in the
// just-placed Collapsed Room (nothing else can happen while a roll choice
// is pending), so it's found by the player's current position rather than
// needing the coordinate threaded back through the prompt/resume plumbing.
function resumeCollapseCheck(gameState, playerId, rolled) {
  const player = requirePlayer(gameState, playerId);
  const placedRoom = gameState.board[player.floor].get(coordKey(player.x, player.y));
  return applyCollapseCheck(gameState, player, placedRoom, rolled);
}

function getRoomAt(gameState, floor, x, y) {
  return gameState.board[floor].get(coordKey(x, y));
}

// Computes the teleport destination without moving anyone -- lets callers
// validate a jump is actually possible BEFORE spending an action point on
// it (see socketHandlers.js's teleport branch), matching this project's
// established "validate before consuming" pattern (see MISSING_CRAFT_MATERIALS/
// ALREADY_SEARCHED_THIS_TURN). Also used by performTeleport itself.
function resolveTeleportDestination(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  if (room.roomId === COLLAPSED_ROOM_ID && room.collapseLink) {
    return { floor: 'basement', x: room.collapseLink.x, y: room.collapseLink.y };
  }
  if (isBallroomOrGallery(room.roomId)) {
    const targetFloor = pairedFloorFor(room.roomId);
    const targetRoom = gameState.board[targetFloor].get(coordKey(room.x, room.y));
    // placeBallroomGalleryPair has two escape paths where the pair does NOT
    // end up at the same (x, y): the coordinate was already occupied (pair
    // placed via placeAtRandomOpenDoor instead), or the pair's card wasn't
    // in the deck at all (no pair placed, target cell may be empty or hold
    // an unrelated room). Both must be rejected here, before any movement.
    if (!targetRoom || targetRoom.roomId !== pairedIdFor(room.roomId)) {
      throw new Error('NO_TELEPORT_TARGET');
    }
    return { floor: targetFloor, x: room.x, y: room.y };
  }
  throw new Error('NO_TELEPORT_TARGET');
}

// 「跳下」的兩個具體案例：崩塌的房間（已有 collapseLink 才能跳）、包廂房/舞廳配對
// （放置時就決定好座標，永遠可跳）。純粹是「知道目的地在哪就移過去」，不檢查
// NOT_YOUR_TURN/行動力——呼叫方（socketHandlers.js）已經透過 selectAction 檢查過
// 回合與行動力，這裡只負責移動本身。
function performTeleport(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const destination = resolveTeleportDestination(gameState, playerId);
  const enteredNewRoom = movePlayerTo(player, destination.floor, destination.x, destination.y, null);
  return { ...destination, enteredNewRoom };
}

function moveSummon(gameState, playerId, direction) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  const summon = player.summons;
  if (!summon) {
    throw new Error('NO_ACTIVE_SUMMON');
  }
  if (summon.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
  const doorSides = Array.isArray(room.doorSides) ? room.doorSides : [];
  if (
    !doorSides.includes(direction) ||
    !canMoveBetween(gameState.board, summon.floor, { x: summon.x, y: summon.y }, direction)
  ) {
    // Summons can only move into already-placed neighbor rooms -- never open a
    // new door, regardless of whether the room deck has cards left.
    throw new Error('INVALID_MOVE_DIRECTION');
  }
  const delta = DIRECTION_DELTA[direction];
  summon.x += delta.dx;
  summon.y += delta.dy;
  summon.actionPoints -= 1;
  return { kind: 'move', x: summon.x, y: summon.y };
}

const SUMMON_ITEM_MODES = ['pickup', 'leave'];

function selectSummonAction(gameState, playerId, actionType, options = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  const summon = player.summons;
  if (!summon) {
    throw new Error('NO_ACTIVE_SUMMON');
  }
  if (actionType === 'dissipate') {
    if (summon.carryingItemId) {
      const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
      room.droppedItems.push({ id: summon.carryingItemId });
    }
    player.summons = null;
    return { kind: 'dissipate' };
  }
  if (actionType !== 'item' || !SUMMON_ITEM_MODES.includes(options.mode)) {
    throw new Error('INVALID_ACTION_TYPE');
  }
  if (summon.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const { itemId, mode } = options;
  const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
  if (mode === 'leave') {
    if (summon.carryingItemId !== itemId) {
      throw new Error('ITEM_NOT_HELD');
    }
    room.droppedItems.push({ id: itemId });
    summon.carryingItemId = null;
    summon.actionPoints -= 1;
    return { kind: 'item', mode: 'leave', itemId };
  }
  // mode === 'pickup'
  if (summon.carryingItemId) {
    throw new Error('SUMMON_ALREADY_CARRYING');
  }
  const index = room.droppedItems.findIndex((i) => i.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_IN_ROOM');
  }
  room.droppedItems.splice(index, 1);
  summon.carryingItemId = itemId;
  summon.actionPoints -= 1;
  return { kind: 'item', mode: 'pickup', itemId };
}

function giveItemAction(gameState, player, itemId, targetPlayerId, itemCategory) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  if (itemCategory === 'imprint') {
    throw new Error('IMPRINT_CANNOT_BE_GIVEN');
  }
  const targetPlayer = requirePlayer(gameState, targetPlayerId);
  if (
    targetPlayer.floor !== player.floor ||
    targetPlayer.x !== player.x ||
    targetPlayer.y !== player.y
  ) {
    throw new Error('TARGET_NOT_IN_ROOM');
  }
  const [item] = player.inventory.splice(index, 1);
  clearEquipStateIfNeeded(player, itemId);
  addItem(targetPlayer, item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'give', itemId, targetPlayerId };
}

function leaveItemAction(gameState, player, itemId, itemCategory) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  if (itemCategory === 'imprint') {
    throw new Error('IMPRINT_CANNOT_BE_LEFT');
  }
  const [item] = player.inventory.splice(index, 1);
  clearEquipStateIfNeeded(player, itemId);
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  room.droppedItems.push(item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'leave', itemId };
}

function pickupItemAction(gameState, player, itemId) {
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  const index = room.droppedItems.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_IN_ROOM');
  }
  const [item] = room.droppedItems.splice(index, 1);
  addItem(player, item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'pickup', itemId };
}

function wieldItemAction(gameState, player, itemId, itemCategory) {
  if (!player.inventory.some((item) => item.id === itemId)) {
    throw new Error('ITEM_NOT_HELD');
  }
  if (itemCategory !== 'weapon') {
    throw new Error('INVALID_ITEM_CATEGORY');
  }
  player.wieldedWeaponId = itemId;
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'wield', itemId };
}

function unwieldItemAction(gameState, player, itemId) {
  if (player.wieldedWeaponId !== itemId) {
    throw new Error('ITEM_NOT_WIELDED');
  }
  player.wieldedWeaponId = null;
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'unwield', itemId };
}

function wearItemAction(gameState, player, itemId, itemCategory) {
  if (!player.inventory.some((item) => item.id === itemId)) {
    throw new Error('ITEM_NOT_HELD');
  }
  if (itemCategory !== 'gear') {
    throw new Error('INVALID_ITEM_CATEGORY');
  }
  if (!player.wornGearIds.includes(itemId)) {
    player.wornGearIds.push(itemId);
  }
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'wear', itemId };
}

function unwearItemAction(gameState, player, itemId) {
  const index = player.wornGearIds.indexOf(itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_WORN');
  }
  player.wornGearIds.splice(index, 1);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'unwear', itemId };
}

function selectAction(gameState, playerId, actionType, options = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (!ACTION_TYPES.includes(actionType)) {
    throw new Error('INVALID_ACTION_TYPE');
  }
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }

  if (actionType === 'item') {
    const { itemId, targetPlayerId, mode, itemCategory } = options;
    if (mode === 'give') {
      return giveItemAction(gameState, player, itemId, targetPlayerId, itemCategory);
    }
    if (mode === 'leave') {
      return leaveItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'pickup') {
      return pickupItemAction(gameState, player, itemId);
    }
    if (mode === 'wield') {
      return wieldItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'unwield') {
      return unwieldItemAction(gameState, player, itemId);
    }
    if (mode === 'wear') {
      return wearItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'unwear') {
      return unwearItemAction(gameState, player, itemId);
    }
    if (!player.inventory.some((item) => item.id === itemId)) {
      throw new Error('ITEM_NOT_HELD');
    }
    const effectTargetId = targetPlayerId || playerId;
    if (effectTargetId !== playerId && !options.itemCanTargetOthers) {
      throw new Error('ITEM_CANNOT_TARGET_OTHERS');
    }
    const targetPlayer = requirePlayer(gameState, effectTargetId);
    if (
      targetPlayer.floor !== player.floor ||
      targetPlayer.x !== player.x ||
      targetPlayer.y !== player.y
    ) {
      throw new Error('TARGET_NOT_IN_ROOM');
    }
    player.actionPoints -= 1;
    return { kind: 'item', itemId, targetPlayerId: effectTargetId };
  }

  if (actionType === 'room_action') {
    // Unreachable via the real socket path since the search mechanic (2026-08-18):
    // socketHandlers.js's room_action branch always sets hasRoomAction true --
    // craftRecipes/effects claim it, and any room that has neither defaults to
    // the search branch. Kept (and still unit-tested directly) as a defensive
    // guard, not a dead check to remove -- a future actionType or caller that
    // doesn't go through that branch selection would still need this.
    if (!options.hasRoomAction) {
      throw new Error('NO_ROOM_ACTION_AVAILABLE');
    }
    // Some room actions (e.g. the entrance-hall stairs rooms) are declared
    // free, matching the pre-existing "stairs cost no action points" rule --
    // most room actions (e.g. the vault's dice check) still cost 1.
    if (!options.freeRoomAction) {
      player.actionPoints -= 1;
    }
    return { kind: 'room_action' };
  }

  player.actionPoints -= 1;
  // "attack" is still a stub — M3 (combat) resolves it.
  return { kind: actionType, pending: true };
}

function isTurnOver(player) {
  return player.actionPoints <= 0;
}

function requireTurnOrder(gameState) {
  if (!Array.isArray(gameState.turnOrder) || gameState.turnOrder.length === 0) {
    throw new Error('NO_TURN_ORDER');
  }
}

function getCurrentTurnPlayerId(gameState) {
  requireTurnOrder(gameState);
  return gameState.turnOrder[gameState.currentPlayerIndex];
}

function advanceTurn(gameState) {
  requireTurnOrder(gameState);
  const outgoingPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const outgoingPlayer = getPlayer(gameState, outgoingPlayerId);
  if (outgoingPlayer) {
    const summon = outgoingPlayer.summons;
    if (summon && summon.carryingItemId) {
      const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
      room.droppedItems.push({ id: summon.carryingItemId });
    }
    outgoingPlayer.summons = null; // safety net -- should already be null before a turn can end
    outgoingPlayer.summonUsedThisTurn = false;
    outgoingPlayer.diceInterjectionUsedThisTurn = [];
    outgoingPlayer.searchedThisTurn = false;
  }
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.turnOrder.length;
  const nextPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const nextPlayer = getPlayer(gameState, nextPlayerId);
  resetActionPoints(nextPlayer);
  return nextPlayerId;
}

function endTurn(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.summons) {
    throw new Error('SUMMON_ACTIVE');
  }
  return advanceTurn(gameState);
}

function canUseStairs(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const grid = gameState.board[player.floor];
  const room = grid.get(coordKey(player.x, player.y));
  if (!room) return false;
  const { stairsLink } = gameState.board;
  if (player.floor === 'ground') {
    return room.roomId === stairsLink.groundRoomId;
  }
  if (player.floor === 'upper') {
    return room.roomId === stairsLink.upperRoomId;
  }
  // stairsLink only pairs ground<->upper -- any other floor (basement, or a
  // future one) has no stairs link yet.
  return false;
}

function useStairs(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.summons) {
    throw new Error('SUMMON_ACTIVE');
  }
  if (!canUseStairs(gameState, playerId)) {
    throw new Error('STAIRS_NOT_AVAILABLE');
  }
  const targetFloor = player.floor === 'ground' ? 'upper' : 'ground';
  const targetRoomId =
    player.floor === 'ground' ? gameState.board.stairsLink.upperRoomId : gameState.board.stairsLink.groundRoomId;
  const targetGrid = gameState.board[targetFloor];
  let targetRoom;
  for (const room of targetGrid.values()) {
    if (room.roomId === targetRoomId) {
      targetRoom = room;
      break;
    }
  }
  movePlayerTo(player, targetFloor, targetRoom.x, targetRoom.y);
  return { kind: 'stairs', floor: targetFloor, x: targetRoom.x, y: targetRoom.y };
}

module.exports = {
  getAvailableDirections,
  moveToRoom,
  moveSummon,
  selectAction,
  selectSummonAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  advanceTurn,
  endTurn,
  canUseStairs,
  useStairs,
  resumeCollapseCheck,
  performTeleport,
  resolveTeleportDestination,
};
