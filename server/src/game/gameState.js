const { createBoard } = require('./boardGenerator');
const { createPlayer, resetActionPoints } = require('./playerEntity');
const { createRoomDeck, isRoomDeckEmpty, getRemainingCount, hasRoomForFloor } = require('./roomDeck');
const { createCardDeck, hasCards, getRemainingCount: getCardRemainingCount } = require('./cardDeck');

function createGameState(startingRooms, rooms, cards = {}) {
  return {
    board: createBoard(startingRooms),
    players: new Map(),
    hauntStarted: false,
    omenCount: 0,
    roomDeck: createRoomDeck(rooms),
    eventDeck: createCardDeck(cards.events || []),
    itemDeck: createCardDeck(cards.items || []),
    omenDeck: createCardDeck(cards.omens || []),
  };
}

function addPlayer(gameState, { playerId, name, stats }) {
  if (gameState.players.has(playerId)) {
    throw new Error('DUPLICATE_PLAYER_ID');
  }
  const player = createPlayer({
    playerId,
    name,
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

function serializeGameState(gameState) {
  return {
    board: {
      ground: Array.from(gameState.board.ground.values()),
      upper: Array.from(gameState.board.upper.values()),
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
  };
}

module.exports = { createGameState, addPlayer, getPlayer, serializeGameState };
