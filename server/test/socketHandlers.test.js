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

test('lobby:join returns the server-assigned roomCode in its ack', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => {
    clientA.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });

  const clientB = ioClient(url);
  const joined = await new Promise((resolve) => {
    clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve);
  });
  expect(joined.roomCode).toBe(created.roomCode);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('lobby:create with no ack callback does not crash the server', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  await new Promise((resolve) => client.on('connect', resolve));

  // No callback provided at all -- this used to throw synchronously inside
  // the handler and crash the whole Node process.
  client.emit('lobby:create', { playerName: 'Eve' });

  // Give the server a tick to process it, then prove the server is still
  // alive and responsive by making a normal, well-formed request.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const clientB = ioClient(url);
  const created = await new Promise((resolve) => {
    clientB.emit('lobby:create', { playerName: 'Frank' }, resolve);
  });
  expect(created.roomCode).toMatch(/^[A-Z]{4}$/);

  client.close();
  clientB.close();
  httpServer.close();
});

test('lobby:create with a null payload responds with an error instead of crashing', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  const result = await new Promise((resolve) => {
    client.emit('lobby:create', null, resolve);
  });
  expect(result.error).toBe('INVALID_NAME');

  client.close();
  httpServer.close();
});

test('lobby:join with a null payload responds with an error instead of crashing', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  const result = await new Promise((resolve) => {
    client.emit('lobby:join', null, resolve);
  });
  expect(result.error).toBeTruthy();

  client.close();
  httpServer.close();
});

test('lobby:create rejects an empty or missing playerName', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  const result = await new Promise((resolve) => {
    client.emit('lobby:create', {}, resolve);
  });
  expect(result.error).toBe('INVALID_NAME');

  client.close();
  httpServer.close();
});

test('lobby:join rejects an oversized playerName', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => {
    clientA.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });

  const clientB = ioClient(url);
  const result = await new Promise((resolve) => {
    clientB.emit(
      'lobby:join',
      { roomCode: created.roomCode, playerName: 'a'.repeat(21) },
      resolve
    );
  });
  expect(result.error).toBe('INVALID_NAME');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a socket calling lobby:create twice is rejected the second time, and the room keeps one player', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  const first = await new Promise((resolve) => {
    client.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });
  expect(first.error).toBeUndefined();

  const second = await new Promise((resolve) => {
    client.emit('lobby:create', { playerName: 'Ghost' }, resolve);
  });
  expect(second.error).toBe('ALREADY_IN_ROOM');

  client.close();
  httpServer.close();
});

test('a socket already in a room is rejected by lobby:join with ALREADY_IN_ROOM', async () => {
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

  // clientB tries to join again (or join a different room) while already in one.
  const repeat = await new Promise((resolve) => {
    clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve);
  });
  expect(repeat.error).toBe('ALREADY_IN_ROOM');

  clientA.close();
  clientB.close();
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
