const { createServer } = require('./createServer');
const { LobbyManager } = require('./lobbyManager');
const { registerSocketHandlers } = require('./socketHandlers');

const PORT = process.env.PORT || 3001;
const { httpServer, io } = createServer();
const lobbyManager = new LobbyManager();
registerSocketHandlers(io, lobbyManager);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`伺服器已啟動：http://0.0.0.0:${PORT}`);
});
