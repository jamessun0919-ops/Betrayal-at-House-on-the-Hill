function registerSocketHandlers(io, lobbyManager) {
  io.on('connection', (socket) => {
    socket.on('lobby:create', ({ playerName }, callback) => {
      const { roomCode, playerId } = lobbyManager.createRoom(playerName, socket.id);
      socket.data.roomCode = roomCode;
      socket.data.playerId = playerId;
      socket.join(roomCode);
      callback({ roomCode, playerId });
      broadcastPlayers(io, lobbyManager, roomCode);
    });

    socket.on('lobby:join', ({ roomCode, playerName }, callback) => {
      try {
        const { playerId } = lobbyManager.joinRoom(roomCode, playerName, socket.id);
        socket.data.roomCode = roomCode;
        socket.data.playerId = playerId;
        socket.join(roomCode);
        callback({ playerId });
        broadcastPlayers(io, lobbyManager, roomCode);
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('disconnect', () => {
      const { roomCode, playerId } = socket.data;
      if (roomCode && playerId) {
        lobbyManager.leaveRoom(roomCode, playerId);
        broadcastPlayers(io, lobbyManager, roomCode);
      }
    });
  });
}

function broadcastPlayers(io, lobbyManager, roomCode) {
  io.to(roomCode).emit('lobby:players', { players: lobbyManager.getPlayers(roomCode) });
}

module.exports = { registerSocketHandlers };
