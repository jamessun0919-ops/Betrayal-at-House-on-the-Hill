const { createGameState, addPlayer } = require('./gameState');
const { addItem } = require('./playerEntity');

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

function createGameManager() {
  return { games: new Map() };
}

function startGame(manager, roomCode, { startingRooms, rooms, cards, characters, players }) {
  if (manager.games.has(roomCode)) {
    throw new Error('GAME_ALREADY_STARTED');
  }
  const gameState = createGameState(startingRooms, rooms, cards);
  for (const player of players) {
    const character = characters.find((c) => c.id === player.characterId);
    if (!character) {
      throw new Error('UNKNOWN_CHARACTER');
    }
    const newPlayer = addPlayer(gameState, {
      playerId: player.playerId,
      name: player.name,
      characterId: character.id,
      stats: character.stats,
    });
    if (character.itemID) {
      addItem(newPlayer, { id: character.itemID });
      const itemContent = cards && (cards.items || []).find((i) => i.id === character.itemID);
      if (itemContent && itemContent.category === 'weapon') {
        newPlayer.wieldedWeaponId = character.itemID;
      } else if (itemContent && itemContent.category === 'gear') {
        newPlayer.wornGearIds.push(character.itemID);
      }
    }
  }
  // Turn order is independent of character-pick order — a fresh, separate
  // shuffle, per the developer's explicit ruling (see M2b design doc §3).
  gameState.turnOrder = shuffle(players.map((p) => p.playerId));
  gameState.currentPlayerIndex = 0;
  manager.games.set(roomCode, gameState);
  return gameState;
}

function getGameState(manager, roomCode) {
  return manager.games.get(roomCode);
}

function endGame(manager, roomCode) {
  manager.games.delete(roomCode);
}

module.exports = { createGameManager, startGame, getGameState, endGame };
