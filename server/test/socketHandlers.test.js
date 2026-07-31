const ioClient = require('socket.io-client');
const { createServer } = require('../src/createServer');
const { LobbyManager } = require('../src/lobbyManager');
const { registerSocketHandlers } = require('../src/socketHandlers');

function startTestServer() {
  const { httpServer, io } = createServer();
  const lobbyManager = new LobbyManager();
  registerSocketHandlers(io, lobbyManager);
  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      resolve({ httpServer, port: httpServer.address().port });
    });
  });
}

test('two clients can create/join a room and both see the updated player list', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => {
    clientA.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });
  expect(created.roomCode).toMatch(/^[A-Z]{4}$/);

  // Room creation broadcasts an initial lobby:players (Alice only) to clientA before
  // Bob joins. A plain `once` listener attached here races that self-broadcast and can
  // catch it instead of the post-join update, so wait for the specific player count.
  const playersPromise = new Promise((resolve) => {
    clientA.on('lobby:players', (update) => {
      if (update.players.length === 2) resolve(update);
    });
  });

  const clientB = ioClient(url);
  const joined = await new Promise((resolve) => {
    clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve);
  });
  expect(joined.error).toBeUndefined();

  const update = await playersPromise;
  expect(update.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('joining an unknown room code returns an error to the caller', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  const result = await new Promise((resolve) => {
    client.emit('lobby:join', { roomCode: 'ZZZZ', playerName: 'Bob' }, resolve);
  });
  expect(result.error).toBe('ROOM_NOT_FOUND');

  client.close();
  httpServer.close();
});

test('disconnecting removes the player and broadcasts the updated list', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => {
    clientA.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });

  const clientB = ioClient(url);
  await new Promise((resolve) => {
    clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve);
  });

  // Same race as above: wait for the broadcast reflecting the post-disconnect player
  // count rather than trusting `once` to land on the right occurrence.
  const afterDisconnect = new Promise((resolve) => {
    clientA.on('lobby:players', (update) => {
      if (update.players.length === 1) resolve(update);
    });
  });
  clientB.close();

  const update = await afterDisconnect;
  expect(update.players.map((p) => p.name)).toEqual(['Alice']);

  clientA.close();
  httpServer.close();
});
