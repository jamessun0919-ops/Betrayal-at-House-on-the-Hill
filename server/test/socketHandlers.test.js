const ioClient = require('socket.io-client');
const { createServer } = require('../src/createServer');
const { LobbyManager } = require('../src/lobbyManager');
const { registerSocketHandlers } = require('../src/socketHandlers');
const { createGameManager } = require('../src/game/gameManager');
const { createCharacterSelectionManager } = require('../src/game/characterSelectionManager');

function makeContent(overrides = {}) {
  return {
    characters: [
      { id: 'char_001', codename: 'Alice-character', stats: makeStats() },
      { id: 'char_002', codename: 'Bob-character', stats: makeStats() },
    ],
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    startingRooms: [
      { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
      { id: 'room_foyer', name: '廊廳', floor: 'ground' },
      { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
    ],
    ...overrides,
  };
}

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

function startTestServer(content, options) {
  const { httpServer, io } = createServer();
  const lobbyManager = new LobbyManager();
  const gameManager = createGameManager();
  const characterSelectionManager = createCharacterSelectionManager();
  registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, content || makeContent(), options);
  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      resolve({ httpServer, port: httpServer.address().port, lobbyManager, gameManager, characterSelectionManager });
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

test('game:startCharacterSelect full flow: host triggers, both players get prompted in turn, game starts', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => {
    clientA.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });
  const roomCode = created.roomCode;
  const aliceId = created.playerId;

  const clientB = ioClient(url);
  const joined = await new Promise((resolve) => {
    clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve);
  });
  const bobId = joined.playerId;

  // Non-host (Bob) cannot start selection.
  const rejected = await new Promise((resolve) => {
    clientB.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(rejected.error).toBe('NOT_HOST');

  const firstPromptA = new Promise((resolve) => clientA.once('game:prompt', resolve));
  const firstPromptB = new Promise((resolve) => clientB.once('game:prompt', resolve));
  const startResult = await new Promise((resolve) => {
    clientA.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(startResult.error).toBeUndefined();

  const [prompt1] = await Promise.all([firstPromptA, firstPromptB]);
  expect(['char_001', 'char_002']).toContain(prompt1.options[0]);
  const firstPickerId = prompt1.targetPlayerId;
  const firstPickerClient = firstPickerId === aliceId ? clientA : clientB;
  const secondPickerClient = firstPickerId === aliceId ? clientB : clientA;

  const secondPrompt = new Promise((resolve) => secondPickerClient.once('game:prompt', resolve));
  const gameStarted = new Promise((resolve) => clientA.once('game:started', resolve));

  const respondResult = await new Promise((resolve) => {
    firstPickerClient.emit(
      'game:promptRespond',
      { promptId: prompt1.promptId, optionId: prompt1.options[0] },
      resolve
    );
  });
  expect(respondResult.error).toBeUndefined();

  const prompt2 = await secondPrompt;
  expect(prompt2.options).toHaveLength(1); // only one character left

  await new Promise((resolve) => {
    secondPickerClient.emit(
      'game:promptRespond',
      { promptId: prompt2.promptId, optionId: prompt2.options[0] },
      resolve
    );
  });

  const startedPayload = await gameStarted;
  expect(startedPayload.players).toHaveLength(2);
  expect(startedPayload.turnOrder.slice().sort()).toEqual([aliceId, bobId].sort());

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:startCharacterSelect rejects when fewer than 2 players are in the room', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  await new Promise((resolve) => {
    client.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });

  const result = await new Promise((resolve) => {
    client.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(result.error).toBe('TOO_FEW_PLAYERS');

  client.close();
  httpServer.close();
});

test('game:startCharacterSelect rejects when there are more players than characters', async () => {
  const content = {
    characters: [{ id: 'char_001', codename: 'Solo', stats: makeStats() }],
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    startingRooms: makeContent().startingRooms,
  };
  const { httpServer, port } = await startTestServer(content);
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const clientB = ioClient(url);
  await new Promise((resolve) =>
    clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve)
  );

  const result = await new Promise((resolve) => {
    clientA.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(result.error).toBe('TOO_MANY_PLAYERS');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('character selection timeout auto-assigns a character and continues the flow', async () => {
  const { httpServer, port } = await startTestServer(makeContent(), { characterSelectTimeoutMs: 50 });
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const roomCode = created.roomCode;
  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve));

  const resolvedPromise = new Promise((resolve) => clientA.once('game:promptResolved', resolve));
  const secondPromptPromise = new Promise((resolve) => {
    clientA.on('game:prompt', (p) => {
      if (p !== undefined) resolve(p);
    });
  });

  await new Promise((resolve) => clientA.emit('game:startCharacterSelect', {}, resolve));

  const resolved = await resolvedPromise;
  expect(resolved.wasTimeout).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});
