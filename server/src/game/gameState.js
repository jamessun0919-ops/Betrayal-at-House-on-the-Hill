const { createBoard } = require('./boardGenerator');
const { createPlayer, resetActionPoints } = require('./playerEntity');
const { createRoomDeck, isRoomDeckEmpty, getRemainingCount, hasRoomForFloor } = require('./roomDeck');
const { createCardDeck, hasCards, getRemainingCount: getCardRemainingCount } = require('./cardDeck');

function createGameState(startingRooms, rooms, cards = {}, options = {}) {
  return {
    board: createBoard(startingRooms),
    players: new Map(),
    hauntStarted: false,
    omenCount: 0,
    roomDeck: createRoomDeck(rooms),
    eventDeck: createCardDeck(cards.events || []),
    itemDeck: createCardDeck(cards.items || []),
    omenDeck: createCardDeck(cards.omens || []),
    phaseTimeoutMs: options.phaseTimeoutMs || 30000,
  };
}

function addPlayer(gameState, { playerId, name, characterId, stats }) {
  if (gameState.players.has(playerId)) {
    throw new Error('DUPLICATE_PLAYER_ID');
  }
  const player = createPlayer({
    playerId,
    name,
    characterId,
    floor: 'ground',
    x: 0,
    y: 1, // room_lobby_a's fixed position (see boardGenerator.js createBoard)
    stats,
    actionPoints: 0,
  });
  resetActionPoints(player);
  gameState.players.set(playerId, player);
  return player;
}

function getPlayer(gameState, playerId) {
  return gameState.players.get(playerId);
}

// Strips the room's search-loot state (`item`: null / "random_one" / a
// candidate-id array) out of what gets broadcast to clients -- players
// should only learn a room's contents by actually spending an action point
// to search it (game:cardDrawn / game:searchEmpty), not by reading it off
// game:stateUpdate. Server-side code keeps using the un-stripped Map
// entries directly (e.g. performSearch reads/mutates placedRoom.item).
function serializeRoom(room) {
  const { item, ...rest } = room;
  return rest;
}

function serializeGameState(gameState) {
  return {
    board: {
      ground: Array.from(gameState.board.ground.values()).map(serializeRoom),
      upper: Array.from(gameState.board.upper.values()).map(serializeRoom),
      basement: Array.from(gameState.board.basement.values()).map(serializeRoom),
      stairsLink: gameState.board.stairsLink,
    },
    players: Array.from(gameState.players.values()),
    hauntStarted: gameState.hauntStarted,
    omenCount: gameState.omenCount,
    roomDeck: {
      remainingCount: getRemainingCount(gameState.roomDeck),
      isEmpty: isRoomDeckEmpty(gameState.roomDeck),
      hasRoomForGround: hasRoomForFloor(gameState.roomDeck, 'ground'),
      hasRoomForUpper: hasRoomForFloor(gameState.roomDeck, 'upper'),
      hasRoomForBasement: hasRoomForFloor(gameState.roomDeck, 'basement'),
    },
    eventDeck: {
      remainingCount: getCardRemainingCount(gameState.eventDeck),
      isEmpty: !hasCards(gameState.eventDeck),
    },
    itemDeck: {
      remainingCount: getCardRemainingCount(gameState.itemDeck),
      isEmpty: !hasCards(gameState.itemDeck),
    },
    omenDeck: {
      remainingCount: getCardRemainingCount(gameState.omenDeck),
      isEmpty: !hasCards(gameState.omenDeck),
    },
    // Set by GameManager.startGame (Task 7) once character selection is
    // done; null before that so this function stays safe to call any time.
    turnOrder: gameState.turnOrder || null,
    currentPlayerIndex: gameState.currentPlayerIndex ?? null,
    // Set by GameManager.startGame's enterPhase(gameState, 'player_move')
    // call; null before that, same reasoning as turnOrder above.
    currentPhase: gameState.currentPhase || null,
  };
}

module.exports = { createGameState, addPlayer, getPlayer, serializeGameState };
