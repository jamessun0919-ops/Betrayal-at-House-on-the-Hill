const { getPlayer } = require('./gameState');
const { requirePhase } = require('./phaseFlow');
const { coordKey, DIRECTION_DELTA, canMoveBetween } = require('./boardGenerator');

const NPC_INVENTORY_CAP = 1;

function requireNpc(gameState, npcId) {
  const npc = getPlayer(gameState, npcId);
  if (!npc) {
    throw new Error('PLAYER_NOT_FOUND');
  }
  return npc;
}

function getRoomAt(gameState, floor, x, y) {
  return gameState.board[floor].get(coordKey(x, y));
}

function moveNpc(gameState, npcId, direction) {
  const npc = requireNpc(gameState, npcId);
  requirePhase(gameState, npcId, 'npc_move');
  if (npc.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const room = getRoomAt(gameState, npc.floor, npc.x, npc.y);
  const doorSides = Array.isArray(room.doorSides) ? room.doorSides : [];
  if (
    !doorSides.includes(direction) ||
    !canMoveBetween(gameState.board, npc.floor, { x: npc.x, y: npc.y }, direction)
  ) {
    // NPCs only ever move into an already-placed neighbor room -- never open
    // a new door, regardless of whether the room deck has cards left. Same
    // restriction the old moveSummon enforced.
    throw new Error('INVALID_MOVE_DIRECTION');
  }
  const delta = DIRECTION_DELTA[direction];
  npc.x += delta.dx;
  npc.y += delta.dy;
  npc.actionPoints -= 1;
  return { kind: 'move', x: npc.x, y: npc.y };
}

function npcItemAction(gameState, npcId, itemId, mode) {
  const npc = requireNpc(gameState, npcId);
  requirePhase(gameState, npcId, 'npc_move');
  if (npc.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const room = getRoomAt(gameState, npc.floor, npc.x, npc.y);
  if (mode === 'leave') {
    const index = npc.inventory.findIndex((item) => item.id === itemId);
    if (index === -1) {
      throw new Error('ITEM_NOT_HELD');
    }
    const [item] = npc.inventory.splice(index, 1);
    room.droppedItems.push(item);
    npc.actionPoints -= 1;
    return { kind: 'item', mode: 'leave', itemId };
  }
  // mode === 'pickup'
  if (npc.inventory.length >= NPC_INVENTORY_CAP) {
    throw new Error('NPC_INVENTORY_FULL');
  }
  const index = room.droppedItems.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_IN_ROOM');
  }
  const [item] = room.droppedItems.splice(index, 1);
  npc.inventory.push(item);
  npc.actionPoints -= 1;
  return { kind: 'item', mode: 'pickup', itemId };
}

module.exports = { moveNpc, npcItemAction };
