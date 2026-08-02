const { createBoard } = require('./boardGenerator');
const { createPlayer, resetActionPoints } = require('./playerEntity');

function createGameState(startingRooms) {
  return {
    board: createBoard(startingRooms),
    players: new Map(),
    hauntStarted: false,
    omenCount: 0,
  };
}

function addPlayer(gameState, { playerId, name, stats }) {
  const player = createPlayer({
    playerId,
    name,
    floor: 'ground',
    x: 0,
    y: 0,
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

module.exports = { createGameState, addPlayer, getPlayer };
