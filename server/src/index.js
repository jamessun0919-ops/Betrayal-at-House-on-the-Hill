const { createServer } = require('./createServer');
const { LobbyManager } = require('./lobbyManager');
const { registerSocketHandlers } = require('./socketHandlers');
const { createGameManager } = require('./game/gameManager');
const { createCharacterSelectionManager } = require('./game/characterSelectionManager');
const { loadCharacters, loadRooms, loadStartingRooms } = require('./game/contentLoader');

const PORT = process.env.PORT || 3001;
const { httpServer, io } = createServer();
const lobbyManager = new LobbyManager();
const gameManager = createGameManager();
const characterSelectionManager = createCharacterSelectionManager();
const content = {
  characters: loadCharacters(),
  rooms: loadRooms(),
  startingRooms: loadStartingRooms(),
};
registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, content);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`伺服器已啟動：http://0.0.0.0:${PORT}`);
});
