const ioClient = require('socket.io-client');
const { createServer } = require('../src/createServer');
const { LobbyManager } = require('../src/lobbyManager');
const { registerSocketHandlers } = require('../src/socketHandlers');
const { createGameManager } = require('../src/game/gameManager');
const { createCharacterSelectionManager } = require('../src/game/characterSelectionManager');
const { createEffectResolverManager, getResolver } = require('../src/game/effectResolverManager');
const { getGameState } = require('../src/game/gameManager');
const { getPlayer } = require('../src/game/gameState');
const { attachModifier } = require('../src/game/modifiers');
const { coordKey } = require('../src/game/boardGenerator');

function makeContent(overrides = {}) {
  return {
    characters: [
      { id: 'char_001', codename: 'Alice-character', stats: makeStats() },
      { id: 'char_002', codename: 'Bob-character', stats: makeStats() },
    ],
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
    cards: { events: [], items: [], omens: [] },
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
  const effectResolverManager = createEffectResolverManager();
  registerSocketHandlers(
    io,
    lobbyManager,
    gameManager,
    characterSelectionManager,
    effectResolverManager,
    content || makeContent(),
    options
  );
  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      resolve({ httpServer, port: httpServer.address().port, lobbyManager, gameManager, characterSelectionManager, effectResolverManager });
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

test('lobby:leave by a non-host player removes only that player and broadcasts the updated list', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));

  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve));

  const updatePromise = new Promise((resolve) => {
    clientA.on('lobby:players', (update) => {
      if (update.players.length === 1) resolve(update);
    });
  });
  const leaveResult = await new Promise((resolve) => clientB.emit('lobby:leave', {}, resolve));
  expect(leaveResult.error).toBeUndefined();

  const update = await updatePromise;
  expect(update.players.map((p) => p.name)).toEqual(['Alice']);

  // clientB is free to create/join a new room now that its socket.data was cleared.
  const rejoin = await new Promise((resolve) => clientB.emit('lobby:create', { playerName: 'Bob2' }, resolve));
  expect(rejoin.error).toBeUndefined();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('lobby:leave rejects a socket that is not currently in any room', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  const result = await new Promise((resolve) => client.emit('lobby:leave', {}, resolve));
  expect(result.error).toBe('NOT_IN_ROOM');

  client.close();
  httpServer.close();
});

test('lobby:leave by the host closes the room: every remaining player receives lobby:closed and can create/join a new room', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));

  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve));

  const closedPromise = new Promise((resolve) => clientB.once('lobby:closed', resolve));
  const leaveResult = await new Promise((resolve) => clientA.emit('lobby:leave', {}, resolve));
  expect(leaveResult.error).toBeUndefined();
  await closedPromise;

  // Both sockets' data were cleared -- both are free to create a new room.
  const bobRejoin = await new Promise((resolve) => clientB.emit('lobby:create', { playerName: 'Bob2' }, resolve));
  expect(bobRejoin.error).toBeUndefined();
  const aliceRejoin = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice2' }, resolve));
  expect(aliceRejoin.error).toBeUndefined();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('the host disconnecting (not an explicit lobby:leave) also closes the room for everyone else', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));

  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve));

  const closedPromise = new Promise((resolve) => clientB.once('lobby:closed', resolve));
  clientA.close(); // host disconnects without an explicit lobby:leave
  await closedPromise;

  const bobRejoin = await new Promise((resolve) => clientB.emit('lobby:create', { playerName: 'Bob2' }, resolve));
  expect(bobRejoin.error).toBeUndefined();

  clientB.close();
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
  expect(startedPayload.roomContent).toEqual({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
  });
  expect(startedPayload.roomDeck.hasRoomForGround).toBe(true);
  expect(startedPayload.players[0].visitedRooms).toEqual([{ floor: 'ground', x: 0, y: 1 }]);
  expect(startedPayload.characterContent).toEqual(makeContent().characters);
  expect(startedPayload.players.every((p) => typeof p.characterId === 'string')).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:startCharacterSelect succeeds with a single player in the room', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  await new Promise((resolve) => {
    client.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });

  const result = await new Promise((resolve) => {
    client.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(result.error).toBeUndefined();

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

test('lobby:join is rejected with ROOM_IN_PROGRESS once character selection has started for that room', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const roomCode = created.roomCode;

  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve));

  const startResult = await new Promise((resolve) => {
    clientA.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(startResult.error).toBeUndefined();

  const clientC = ioClient(url);
  const joinResult = await new Promise((resolve) => {
    clientC.emit('lobby:join', { roomCode, playerName: 'Carol' }, resolve);
  });
  expect(joinResult.error).toBe('ROOM_IN_PROGRESS');

  clientA.close();
  clientB.close();
  clientC.close();
  httpServer.close();
});

test('lobby:list returns open rooms with host name and player count, excluding full or in-progress rooms', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const openRoom = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));

  const clientB = ioClient(url);
  const startedRoom = await new Promise((resolve) => clientB.emit('lobby:create', { playerName: 'Carol' }, resolve));
  const clientC = ioClient(url);
  await new Promise((resolve) => clientC.emit('lobby:join', { roomCode: startedRoom.roomCode, playerName: 'Dave' }, resolve));
  await new Promise((resolve) => clientB.emit('game:startCharacterSelect', {}, resolve));

  const result = await new Promise((resolve) => clientC.emit('lobby:list', {}, resolve));

  expect(result.error).toBeUndefined();
  expect(result.rooms).toEqual([
    { roomCode: openRoom.roomCode, hostName: 'Alice', playerCount: 1, maxPlayers: 2 },
  ]);
  expect(result.rooms.find((r) => r.roomCode === startedRoom.roomCode)).toBeUndefined();

  clientA.close();
  clientB.close();
  clientC.close();
  httpServer.close();
});

test('lobby:list can be called by a socket not currently in any room', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  const result = await new Promise((resolve) => client.emit('lobby:list', {}, resolve));
  expect(result.error).toBeUndefined();
  expect(result.rooms).toEqual([]);

  client.close();
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

test('a real response before the deadline cancels the scheduled timeout so it cannot later double-resolve the prompt', async () => {
  const { httpServer, port } = await startTestServer(makeContent(), { characterSelectTimeoutMs: 100 });
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const roomCode = created.roomCode;
  const aliceId = created.playerId;
  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve));

  const resolvedEvents = [];
  clientA.on('game:promptResolved', (payload) => resolvedEvents.push(payload));

  const firstPromptA = new Promise((resolve) => clientA.once('game:prompt', resolve));
  const firstPromptB = new Promise((resolve) => clientB.once('game:prompt', resolve));
  await new Promise((resolve) => clientA.emit('game:startCharacterSelect', {}, resolve));
  const [prompt1] = await Promise.all([firstPromptA, firstPromptB]);

  const firstPickerClient = prompt1.targetPlayerId === aliceId ? clientA : clientB;

  await new Promise((resolve) => {
    firstPickerClient.emit(
      'game:promptRespond',
      { promptId: prompt1.promptId, optionId: prompt1.options[0] },
      resolve
    );
  });

  // Wait past where the original 100ms deadline for prompt1 would have fired, to prove
  // the scheduled timeout was actually cancelled by the real response and can't later
  // double-resolve the same prompt.
  await new Promise((resolve) => setTimeout(resolve, 150));

  const resolvedForPrompt1 = resolvedEvents.filter((r) => r.promptId === prompt1.promptId);
  expect(resolvedForPrompt1).toHaveLength(1);
  expect(resolvedForPrompt1[0].wasTimeout).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});

async function setUpStartedGame() {
  const { httpServer, port, gameManager } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const roomCode = created.roomCode;
  const aliceId = created.playerId;

  const clientB = ioClient(url);
  const joined = await new Promise((resolve) =>
    clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve)
  );
  const bobId = joined.playerId;

  const started = new Promise((resolve) => clientA.once('game:started', resolve));
  const firstPromptA = new Promise((resolve) => clientA.once('game:prompt', resolve));
  const firstPromptB = new Promise((resolve) => clientB.once('game:prompt', resolve));
  await new Promise((resolve) => clientA.emit('game:startCharacterSelect', {}, resolve));
  const [prompt1] = await Promise.all([firstPromptA, firstPromptB]);
  const firstPickerClient = prompt1.targetPlayerId === aliceId ? clientA : clientB;
  const secondPickerClient = prompt1.targetPlayerId === aliceId ? clientB : clientA;

  const secondPrompt = new Promise((resolve) => secondPickerClient.once('game:prompt', resolve));
  // Wait for BOTH clients to actually receive each game:promptResolved broadcast
  // before proceeding -- otherwise, under load, a still-in-flight broadcast from
  // character selection can be caught by a caller's own later .once('game:promptResolved', ...)
  // listener instead of the event it's actually waiting for (same race class fixed
  // in M2b-2 Task 3/Task 4 for game:prompt).
  const firstRespondedA = new Promise((resolve) => clientA.once('game:promptResolved', resolve));
  const firstRespondedB = new Promise((resolve) => clientB.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    firstPickerClient.emit('game:promptRespond', { promptId: prompt1.promptId, optionId: prompt1.options[0] }, resolve)
  );
  await Promise.all([firstRespondedA, firstRespondedB]);
  const prompt2 = await secondPrompt;
  const secondRespondedA = new Promise((resolve) => clientA.once('game:promptResolved', resolve));
  const secondRespondedB = new Promise((resolve) => clientB.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    secondPickerClient.emit('game:promptRespond', { promptId: prompt2.promptId, optionId: prompt2.options[0] }, resolve)
  );
  await Promise.all([secondRespondedA, secondRespondedB]);

  const startedPayload = await started;
  const currentPlayerId = startedPayload.turnOrder[startedPayload.currentPlayerIndex];
  const currentClient = currentPlayerId === aliceId ? clientA : clientB;
  const otherClient = currentPlayerId === aliceId ? clientB : clientA;

  return { httpServer, clientA, clientB, roomCode, aliceId, bobId, currentClient, otherClient, currentPlayerId, startedPayload, gameManager };
}

test('a repeated game:startCharacterSelect is rejected with GAME_ALREADY_STARTED once a game has already started for that room', async () => {
  const { httpServer, clientA, clientB } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    clientA.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(result.error).toBe('GAME_ALREADY_STARTED');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move to open a door places a room, deducts a flat 2 AP, and broadcasts game:stateUpdate', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  const startingAP = getPlayer(gameState, currentPlayerId).actionPoints;

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => {
    currentClient.emit('game:move', { direction: 'east' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('open_door');

  const update = await updatePromise;
  const movedPlayer = update.players.find((p) => p.x === 1 && p.y === 1);
  expect(movedPlayer).toBeTruthy();
  expect(movedPlayer.actionPoints).toBe(startingAP - 2);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into a plain (no leaveCheck) neighbor broadcasts game:roomEntered with the entered room id', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGame();

  const roomEnteredPromise = new Promise((resolve) => otherClient.once('game:roomEntered', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(result.error).toBeUndefined();

  const roomEntered = await roomEnteredPromise;
  expect(roomEntered.playerId).toBe(currentPlayerId);
  expect(roomEntered.roomId).toBe('room_new');
  expect(roomEntered.enteredNewRoom).toBe(true); // room_new was just placed by the door-open

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move applies a room\'s leaveCheck before allowing the player to move out, blocking on a failed roll', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  const startingAP = player.actionPoints;

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // every die -> face 0, guaranteed fail
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();

  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('leaveCheckFailed');
  expect(player.x).toBe(0); // unmoved
  expect(player.actionPoints).toBe(startingAP - 1);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move skips the leaveCheck entirely for a player holding omen_009 in room_pentagram/room_graveyard/room_crypt', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_pentagram', name: '五芒星室', doors: 4, floor: 'ground', leaveCheck: { stat: 'knowledge', min: 4 } },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.floor = 'ground';
  player.x = 5;
  player.y = 5;
  gameState.board.ground.set('5,5', { roomId: 'room_pentagram', x: 5, y: 5, doorSides: ['east'], droppedItems: [], item: null });
  gameState.board.ground.set('6,5', { roomId: 'room_neighbor', x: 6, y: 5, doorSides: ['west'], droppedItems: [], item: null });
  player.inventory.push({ id: 'omen_009' });

  // RNG pinned to guarantee a leaveCheck fail if one were actually rolled --
  // the omen_009 exemption should skip the roll entirely, not just win it.
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();

  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('move');
  expect(player.x).toBe(6);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move still applies room_pentagram\'s leaveCheck for a player who does not hold omen_009', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_pentagram', name: '五芒星室', doors: 4, floor: 'ground', leaveCheck: { stat: 'knowledge', min: 4 } },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.floor = 'ground';
  player.x = 5;
  player.y = 5;
  gameState.board.ground.set('5,5', { roomId: 'room_pentagram', x: 5, y: 5, doorSides: ['east'], droppedItems: [], item: null });
  gameState.board.ground.set('6,5', { roomId: 'room_neighbor', x: 6, y: 5, doorSides: ['west'], droppedItems: [], item: null });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();

  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('leaveCheckFailed');
  expect(player.x).toBe(5); // unmoved

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move still applies a non-exempt room\'s leaveCheck for a player holding omen_009', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_009' });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();

  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('leaveCheckFailed'); // room_lobby_a is not in the omen_009 exemption list
  expect(player.x).toBe(0); // unmoved

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move with a failing leaveCheck broadcasts game:checkResolved to the whole room, not just the mover', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const checkResolvedPromise = new Promise((resolve) => otherClient.once('game:checkResolved', resolve));
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // every die -> face 0, guaranteed fail
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();

  const checkResolved = await checkResolvedPromise;
  expect(checkResolved.playerId).toBe(currentPlayerId);
  expect(checkResolved.checkKind).toBe('leaveCheck');
  expect(checkResolved.sourceKind).toBe('room');
  expect(checkResolved.sourceId).toBe('room_lobby_a');
  expect(checkResolved.stat).toBe('might');
  expect(checkResolved.threshold).toBe(3);
  expect(checkResolved.tierEffects).toBeNull();
  expect(checkResolved.passed).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move with an eligible interjection item held on a leaveCheck room pauses for a roll choice instead of resolving immediately', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
    cards: {
      events: [],
      omens: [],
      items: [
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }], consumesItem: false },
        },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_006' });
  const startingAP = player.actionPoints;

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(result.error).toBeUndefined();
  expect(result).toEqual({ kind: 'leaveCheckPending' });

  const pending = await pendingPromise;
  expect(pending.playerId).toBe(currentPlayerId);
  expect(pending.options).toEqual([
    { itemId: 'item_006', name: '詭異人偶', diceInterjection: content.cards.items[0].diceInterjection },
  ]);
  expect(typeof pending.promptId).toBe('string');
  expect(player.x).toBe(0); // nothing moved yet
  expect(player.actionPoints).toBe(startingAP); // nothing spent yet

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move on a leaveCheck room does not offer a diceCheckOnly-scoped item as an interjection option', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
    cards: {
      events: [],
      omens: [],
      items: [
        {
          id: 'item_048',
          name: '海盜金幣',
          diceInterjection: { scope: 'diceCheckOnly', bonusDice: -1, consumesItem: true, bonusOnPass: [{ type: 'draw_card', deck: 'item', count: 1 }] },
        },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_048' });

  const checkResolvedPromise = new Promise((resolve) => currentClient.once('game:checkResolved', resolve));
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // guaranteed pass -- proves it resolved immediately, not paused for a roll choice
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();

  expect(result.error).toBeUndefined();
  // The default room deck (room_new) means leaving room_lobby_a opens a new
  // door rather than moving into an already-placed room, so the resolved
  // kind here is 'open_door' -- the point of this assertion is that it is
  // NOT 'leaveCheckPending', i.e. item_048 was not offered as an
  // interjection option and the leaveCheck resolved immediately instead of
  // pausing for a roll choice.
  expect(result.kind).toBe('open_door');
  const checkResolved = await checkResolvedPromise;
  expect(checkResolved.checkKind).toBe('leaveCheck');
  expect(checkResolved.passed).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into room_collapsed_room: failing the speed check drops the player to a new basement room at the same coordinate', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_collapsed_room', doors: 2, floor: 'ground' },
      { id: 'room_basement_a', doors: 2, floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // every die -> face 0, guaranteed fail
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();

  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('open_door');
  expect(result.roomId).toBe('room_collapsed_room');
  expect(result.collapseResult.fell).toBe(true);
  expect(player.floor).toBe('basement');
  expect(player.x).toBe(1);
  expect(player.y).toBe(1);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into the collapsed room broadcasts a collapseCheck game:checkResolved', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_collapsed_room', doors: 2, floor: 'ground' },
      { id: 'room_basement_a', doors: 2, floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const checkResolvedPromise = new Promise((resolve) => otherClient.once('game:checkResolved', resolve));
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // every die -> face 0, guaranteed fail
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();

  const checkResolved = await checkResolvedPromise;
  expect(checkResolved.playerId).toBe(currentPlayerId);
  expect(checkResolved.checkKind).toBe('collapseCheck');
  expect(checkResolved.sourceKind).toBe('room');
  expect(checkResolved.sourceId).toBe('room_collapsed_room');
  expect(checkResolved.stat).toBe('speed');
  expect(checkResolved.tierEffects).toBeNull();
  expect(checkResolved.passed).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move that passes a leaveCheck and then opens into the collapsed room broadcasts both game:checkResolved events, in order', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
    rooms: [
      { id: 'room_collapsed_room', doors: 2, floor: 'ground' },
      { id: 'room_basement_a', doors: 2, floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const checkResolvedEvents = [];
  otherClient.on('game:checkResolved', (data) => checkResolvedEvents.push(data));
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // every die -> face 2, both checks pass
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await new Promise((resolve) => setTimeout(resolve, 0)); // let both broadcasts land
  rngSpy.mockRestore();

  expect(checkResolvedEvents).toHaveLength(2);
  expect(checkResolvedEvents[0].playerId).toBe(currentPlayerId);
  expect(checkResolvedEvents[0].checkKind).toBe('leaveCheck');
  expect(checkResolvedEvents[0].sourceId).toBe('room_lobby_a');
  expect(checkResolvedEvents[0].passed).toBe(true);
  expect(checkResolvedEvents[1].playerId).toBe(currentPlayerId);
  expect(checkResolvedEvents[1].checkKind).toBe('collapseCheck');
  expect(checkResolvedEvents[1].sourceId).toBe('room_collapsed_room');
  expect(checkResolvedEvents[1].passed).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into room_collapsed_room with an eligible interjection item pauses for a roll choice, then game:diceChoiceRespond resolves it', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_collapsed_room', doors: 2, floor: 'ground' },
      { id: 'room_basement_a', doors: 2, floor: 'basement' },
    ],
    cards: {
      events: [],
      omens: [],
      items: [{ id: 'item_005', name: '天使羽毛', diceInterjection: { scope: 'any', override: true, consumesItem: true } }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_005' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  const moveResult = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(moveResult.error).toBeUndefined();
  expect(moveResult.kind).toBe('collapseCheckPending');
  expect(player.floor).toBe('ground'); // already entered the room; only the roll is pending
  expect(player.x).toBe(1);
  expect(player.y).toBe(1);

  const pending = await pendingPromise;
  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_005' }, resolve)
  );
  expect(respondResult.error).toBeUndefined();
  await resolvedPromise;

  // item_005's override auto-substitutes the max possible roll (default test
  // character speed 4 * default face max 2 = 8), which clears
  // COLLAPSE_CHECK_MIN (5) -- the player stays on the ground floor.
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(1);
  expect(player.y).toBe(1);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with actionIndex selecting teleport: jumps a later player down an already-collapsed room, costing 1 action point', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_collapsed_room', doors: 2, floor: 'ground', actions: [{ label: '搜索', kind: 'search' }, { label: '跳下', kind: 'teleport' }] },
      { id: 'room_basement_a', doors: 2, floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guaranteed fail -> falls immediately
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();
  expect(player.floor).toBe('basement'); // fell already -- simulate a later turn to try the jump action too
  player.actionPoints = 4;
  player.floor = 'ground';
  player.x = 1;
  player.y = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 1 }, resolve));

  expect(result.error).toBeUndefined();
  expect(player.floor).toBe('basement');
  expect(player.x).toBe(1);
  expect(player.y).toBe(1);
  expect(player.actionPoints).toBe(3); // costs 1 AP now (unified with the gallery jump rule)

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with actionIndex selecting teleport: jumping down an already-collapsed room broadcasts game:roomEntered for the basement room', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_collapsed_room', doors: 2, floor: 'ground', actions: [{ label: '搜索', kind: 'search' }, { label: '跳下', kind: 'teleport' }] },
      { id: 'room_basement_a', doors: 2, floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  // The fall-through move itself already broadcasts its own game:roomEntered
  // (finishMoveResult reads the mover's actual final position, which by then
  // is the basement room) -- drain that first so the listener below can only
  // catch what the room_action jump itself broadcasts, not a race with this
  // earlier one.
  const firstRoomEnteredPromise = new Promise((resolve) => otherClient.once('game:roomEntered', resolve));
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guaranteed fail -> falls immediately
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();
  await firstRoomEnteredPromise;

  player.actionPoints = 4;
  player.floor = 'ground';
  player.x = 1;
  player.y = 1;

  const roomEnteredPromise = new Promise((resolve) => otherClient.once('game:roomEntered', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 1 }, resolve));
  const roomEntered = await roomEnteredPromise;

  expect(roomEntered.playerId).toBe(currentPlayerId);
  expect(roomEntered.roomId).toBe('room_basement_a');
  expect(roomEntered.enteredNewRoom).toBe(false); // this player already fell into room_basement_a earlier in this test

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a Collapsed Room without a collapseLink yet does not offer teleport (only search)', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_collapsed_room', doors: 4, floor: 'ground', actions: [{ label: '搜索', kind: 'search' }, { label: '跳下', kind: 'teleport' }] }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  // Entering room_collapsed_room always triggers the automatic speed check
  // (moveToRoom, unconditional on this specific room id) -- mock a guaranteed
  // PASS (rolled >= 5) so the player does NOT fall through and collapseLink
  // stays unset, matching this test's premise.
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  expect(player.floor).toBe('ground'); // confirms the check passed -- did not fall
  player.actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 1 }, resolve));
  expect(result.error).toBe('INVALID_ACTION_INDEX'); // teleport filtered out -- list length is 1, index 1 is out of range

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with actionIndex selecting teleport: jumps from the Gallery to the paired Ballroom, costing 1 action point, no damage applied', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_gallery', doors: 4, floor: 'upper', actions: [{ label: '搜索', kind: 'search' }, { label: '跳下', kind: 'teleport' }] }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  // Directly place the Gallery (upper) and its paired Ballroom (ground) at
  // the same coordinate, and put the player in the Gallery -- game:move
  // can't reach an upper-floor room from the ground-floor starting position
  // with a single-room synthetic deck, so this bypasses draw/move entirely.
  gameState.board.upper.set(coordKey(5, 5), { roomId: 'room_gallery', x: 5, y: 5, doorSides: ['north'], droppedItems: [], item: null });
  gameState.board.ground.set(coordKey(5, 5), { roomId: 'room_ballroom', x: 5, y: 5, doorSides: ['north'], droppedItems: [], item: null });
  player.floor = 'upper';
  player.x = 5;
  player.y = 5;
  player.actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 1 }, resolve));

  expect(result.error).toBeUndefined();
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(5);
  expect(player.y).toBe(5);
  expect(player.actionPoints).toBe(0); // costs 1 AP, same rule as the collapsed room's jump

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with actionIndex selecting teleport: a Gallery with no paired Ballroom throws NO_TELEPORT_TARGET without spending an action point', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_gallery', doors: 4, floor: 'upper', actions: [{ label: '搜索', kind: 'search' }, { label: '跳下', kind: 'teleport' }] }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  gameState.board.upper.set(coordKey(5, 5), { roomId: 'room_gallery', x: 5, y: 5, doorSides: ['north'], droppedItems: [], item: null });
  // No room placed on the ground floor at (5, 5) -- no paired Ballroom.
  player.floor = 'upper';
  player.x = 5;
  player.y = 5;
  player.actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 1 }, resolve));
  expect(result.error).toBe('NO_TELEPORT_TARGET');
  expect(player.floor).toBe('upper'); // did not move
  expect(player.actionPoints).toBe(1); // unchanged -- validated before selectAction spent anything

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: no actionIndex and a multi-action room throws INVALID_ACTION_INDEX without spending an action point', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', actions: [{ label: '搜索', kind: 'search' }, { label: '烹飪', kind: 'craft' }], craftRecipes: [{ id: 'recipe_cooked_food', ingredients: ['item_016', 'item_017'], result: 'item_021' }] }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve)); // no actionIndex
  expect(result.error).toBe('INVALID_ACTION_INDEX');
  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(1); // unchanged

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: an out-of-range actionIndex throws INVALID_ACTION_INDEX', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', actions: [{ label: '搜索', kind: 'search' }, { label: '烹飪', kind: 'craft' }], craftRecipes: [{ id: 'recipe_cooked_food', ingredients: ['item_016', 'item_017'], result: 'item_021' }] }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 2 }, resolve));
  expect(result.error).toBe('INVALID_ACTION_INDEX');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a two-action room (search + craft) can select search via actionIndex 0', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', item: 'random_one', actions: [{ label: '搜索', kind: 'search' }, { label: '烹飪', kind: 'craft' }], craftRecipes: [{ id: 'recipe_cooked_food', ingredients: ['item_016', 'item_017'], result: 'item_021' }] }],
  });
  content.cards.items = [{ id: 'item_001', name: '測試道具', effects: [] }];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 0 }, resolve));
  expect(result.error).toBeUndefined();
  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.cardId).toBe('item_001');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action resolving a move_to_room effect (e.g. stairs) broadcasts game:roomEntered for the target room', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground' },
      {
        id: 'room_lobby_c',
        name: '大門廳',
        floor: 'ground',
        actions: [{ label: '上樓', kind: 'effects', effects: [{ type: 'move_to_room', targetRoomId: 'room_upper_landing' }], freeAction: true }],
      },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.floor = 'ground';
  player.x = 0;
  player.y = -1; // room_lobby_c's coordinate

  const roomEnteredPromise = new Promise((resolve) => otherClient.once('game:roomEntered', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const roomEntered = await roomEnteredPromise;

  expect(roomEntered.playerId).toBe(currentPlayerId);
  expect(roomEntered.roomId).toBe('room_upper_landing');
  expect(roomEntered.enteredNewRoom).toBe(true); // first time this player reaches room_upper_landing in this test

  clientA.close();
  clientB.close();
  httpServer.close();
});

function makeLeaveCheckInterjectionContent() {
  return makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
    cards: {
      events: [],
      omens: [],
      items: [
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }], consumesItem: false },
        },
      ],
    },
  });
}

test('game:diceChoiceRespond with an item optionId resolves a pending leaveCheck: applies cost and completes the move on a pass', async () => {
  const content = makeLeaveCheckInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_006' });
  const startingAP = player.actionPoints;

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await pendingPromise;

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // every die -> face 2
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_006' }, resolve)
  );
  rngSpy.mockRestore();
  expect(respondResult.error).toBeUndefined();
  await updatePromise;

  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex - 1); // cost applied
  expect(player.diceInterjectionUsedThisTurn).toEqual(['item_006']);
  // might(3) + bonusDice(2) = 5 dice, each face 2 -> sum 10, passes min 3 -> opens the door east
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(startingAP - 2); // open_door deducts a flat 2 AP, same as a normal door-open

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond with optionId:"__skip__" resolves a pending leaveCheck with no bonus applied', async () => {
  const content = makeLeaveCheckInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_006' });
  const startingAP = player.actionPoints;

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await pendingPromise;

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // 3 dice (no bonus), each face 2 -> sum 6, passes min 3
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: '__skip__' }, resolve)
  );
  rngSpy.mockRestore();
  await updatePromise;

  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex); // no cost -- item never used
  expect(player.diceInterjectionUsedThisTurn || []).toEqual([]);
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(startingAP - 2);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond resolves a pending leaveCheck that still fails after the bonus roll: cost is still paid, move is blocked, and exactly 1 action point is spent', async () => {
  const content = makeLeaveCheckInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_006' });
  const startingAP = player.actionPoints;

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await pendingPromise;

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // every die -> face 0, sum 0, fails min 3 even with the bonus dice
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_006' }, resolve)
  );
  rngSpy.mockRestore();
  expect(respondResult.error).toBeUndefined();
  await updatePromise;

  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex - 1); // cost paid even though the roll failed
  expect(player.x).toBe(0); // unmoved -- no room was drawn or placed
  expect(player.actionPoints).toBe(startingAP - 1); // exactly 1 AP, not double-charged

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move no longer restricts by turn order -- either real player can move once phase-gated instead of turn-gated', async () => {
  const { httpServer, clientA, clientB, otherClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    otherClient.emit('game:move', { direction: 'east' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('open_door');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction spends 1 action point, broadcasts game:pendingAction, and updates state', async () => {
  const { httpServer, clientA, clientB, currentClient, gameManager, roomCode } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  gameState.currentPhase = 'player_interact';

  // 'attack' is the only actionType still a stub (item/room_action get real
  // logic in M2c-4) -- this test's original intent was "still a stub", not
  // "specifically item".
  const pendingActionPromise = new Promise((resolve) => currentClient.once('game:pendingAction', resolve));
  const result = await new Promise((resolve) => {
    currentClient.emit('game:selectAction', { actionType: 'attack' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result).toEqual({ kind: 'attack', pending: true });

  const pendingAction = await pendingActionPromise;
  expect(pendingAction.actionType).toBe('attack');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:useStairs is rejected when the player is not standing at the stairs link', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    currentClient.emit('game:useStairs', {}, resolve);
  });
  expect(result.error).toBe('STAIRS_NOT_AVAILABLE');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn is a legacy-named alias for game:lockPhase -- it locks the caller\'s phase and advances to the next phase once every real player has locked', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient } = await setUpStartedGame();

  const firstResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstResult.error).toBeUndefined();
  expect(firstResult.currentPhase).toBe('player_move'); // still player_move -- the other real player hasn't locked yet

  const secondResult = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondResult.error).toBeUndefined();
  // Both real players are now locked -- the round advances, cascading through
  // the empty npc_move phase (no NPCs exist), landing on player_interact.
  expect(secondResult.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn throws ALREADY_LOCKED when the same player calls it twice in the same phase', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const first = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(first.error).toBeUndefined();
  const second = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(second.error).toBe('ALREADY_LOCKED');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn is rejected while an effect choice is pending', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await pendingChoicePromise;

  const result = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn rejects the caller while they are controlling an active summon', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).summons = {
    type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null,
  };

  const result = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBe('SUMMON_ACTIVE');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn applies a room\'s onceOnlyPerPlayer bonus the first time the player ends their turn there', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', effects: [{ type: 'stat_change', stat: 'sanity', delta: 1, onceOnlyPerPlayer: true }] },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  const baseSanity = player.stats.sanity.currentIndex;

  const result = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBeUndefined();
  expect(player.stats.sanity.currentIndex).toBe(baseSanity + 1);
  expect(player.roomBonusesReceived).toEqual(['room_lobby_a']);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn does not re-apply a room\'s onceOnlyPerPlayer bonus once the player has already received it', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', effects: [{ type: 'stat_change', stat: 'sanity', delta: 1, onceOnlyPerPlayer: true }] },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  // applyRoomEndTurnBonus runs on every successful lock call, in any phase --
  // its own idempotency comes from player.roomBonusesReceived tracking, not
  // from any turn/phase boundary. Proving it doesn't re-apply doesn't need a
  // full round: lock player_move (bonus applies), let the other real player
  // lock too (phase advances to player_interact), then lock again there --
  // applyRoomEndTurnBonus fires a second time but must be a no-op.
  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex + 1);

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  const thirdLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(thirdLock.error).toBeUndefined();
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex + 1); // unchanged
  expect(player.roomBonusesReceived).toEqual(['room_lobby_a']); // not duplicated

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('when a move exhausts action points, the phase does not auto-advance -- locking (game:endTurn) is required', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 2; // exactly enough to open one door, exhausting AP afterward

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // costs the flat 2 AP for opening a door
  const update = await updatePromise;

  // AP is zero, but the phase must stay at player_move until both real
  // players explicitly lock it.
  expect(update.currentPhase).toBe('player_move');
  const me = update.players.find((p) => p.playerId === currentPlayerId);
  expect(me.actionPoints).toBe(0);

  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:lockPhase locks the calling player and advances the round once every real player has locked', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, gameManager, roomCode } = await setUpStartedGame();

  const firstLockResult = await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  expect(firstLockResult.error).toBeUndefined();
  expect(firstLockResult.currentPhase).toBe('player_move'); // still player_move -- the other player hasn't locked yet

  const secondLockResult = await new Promise((resolve) => otherClient.emit('game:lockPhase', {}, resolve));
  expect(secondLockResult.error).toBeUndefined();
  // Both real players are now locked -- player_move advances, cascades through
  // the empty npc_move phase (no NPCs exist), and lands on player_interact.
  expect(secondLockResult.currentPhase).toBe('player_interact');

  const gameState = getGameState(gameManager, roomCode);
  expect(gameState.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:lockPhase rejects a second lock from the same player with ALREADY_LOCKED', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const first = await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  expect(first.error).toBeUndefined();
  const second = await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  expect(second.error).toBe('ALREADY_LOCKED');

  clientA.close();
  clientB.close();
  httpServer.close();
});

// 2026-09-03: game:lockPhase and game:endTurn share one handler body
// (handleLockPhase in socketHandlers.js) precisely so these guards and the
// room bonus apply no matter which event name a caller uses -- the client
// only ever emits game:lockPhase, so this coverage matters more than the
// equivalent game:endTurn tests above.
test('game:lockPhase rejects the caller while they are controlling an active summon', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null };

  const result = await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  expect(result.error).toBe('SUMMON_ACTIVE');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:lockPhase applies a room\'s onceOnlyPerPlayer bonus the first time the player locks there', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', effects: [{ type: 'stat_change', stat: 'sanity', delta: 1, onceOnlyPerPlayer: true }] },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  const result = await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  expect(result.error).toBeUndefined();
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex + 1);
  expect(player.roomBonusesReceived).toEqual(['room_lobby_a']);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into a room with a populated item deck draws a card, adds it to inventory, and resolves its non-choice effects', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{ id: 'item_001', name: '測試道具', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.deckType).toBe('item');
  expect(cardDrawn.cardId).toBe('item_001');

  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.sourceId).toBe('item_001');

  // The 2026-08-18 search-mechanic review found this path never actually
  // granted the drawn card to inventory (only omen draws did) -- fixed
  // alongside the search mechanic; this path itself is currently
  // unreachable via real room data (no room has drawType:"item" anymore)
  // but stays correct for any future/synthetic caller, as tested here.
  const gameState = getGameState(gameManager, roomCode);
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_001' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

// event_001 (腐敗惡臭) is a real content card with a genuine dice_check effect on
// sanity -- used here (rather than an invented fixture id) per the developer's
// explicit request, since hasCheck/checkResolved must reflect real card shapes.
const EVENT_001_DICE_CHECK = {
  id: 'event_001',
  name: '腐敗惡臭',
  effects: [{
    type: 'dice_check',
    stat: 'sanity',
    tiers: [
      { min: 5, max: 8, pass: true, effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] },
      { min: 1, max: 4, pass: false, effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
      { min: 0, max: 0, pass: false, effects: [
        { type: 'stat_change', stat: 'might', delta: -1 },
        { type: 'stat_change', stat: 'speed', delta: -1 },
        { type: 'stat_change', stat: 'knowledge', delta: -1 },
        { type: 'stat_change', stat: 'sanity', delta: -1 },
      ] },
    ],
  }],
};

test('game:move into event_004 (突發故障) zeros action points and moves the player back to their previous room', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_004',
        name: '突發故障',
        effects: [
          { type: 'action_points', setTo: 0 },
          { type: 'move_to_previous_room' },
        ],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const before = getPlayer(gameState, currentPlayerId);
  const startFloor = before.floor;
  const startX = before.x;
  const startY = before.y;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.actionPoints).toBe(0);
  expect(after.floor).toBe(startFloor);
  expect(after.x).toBe(startX);
  expect(after.y).toBe(startY);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into event_035 (狂風襲來) moves the player back to their previous room', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_035',
        name: '狂風襲來',
        effects: [{ type: 'move_to_previous_room' }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const before = getPlayer(gameState, currentPlayerId);
  const startFloor = before.floor;
  const startX = before.x;
  const startY = before.y;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.floor).toBe(startFloor);
  expect(after.x).toBe(startX);
  expect(after.y).toBe(startY);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into event_013 (割破背包) removes a random held item and returns it to the item deck', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_013',
        name: '割破背包',
        effects: [{ type: 'lose_random_item', destination: 'deck' }],
      }],
      items: [{ id: 'item_test_a', name: '測試道具A', effects: [] }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_test_a' });
  const deckCountBefore = gameState.itemDeck.cards.length;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.inventory).toEqual([]);
  expect(gameState.itemDeck.cards.length).toBe(deckCountBefore + 1); // the removed item was pushed back
  expect(gameState.itemDeck.cards[gameState.itemDeck.cards.length - 1]).toEqual({ id: 'item_test_a', name: '測試道具A', effects: [] });

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into event_033 (傳送門) moves the player to a random other player\'s room and broadcasts game:roomEntered for it', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_033',
        name: '傳送門',
        effects: [{ type: 'move_to_random_other_player_room' }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  // Move the OTHER player to a distinct, already-placed room so the teleport target
  // is somewhere genuinely different from where the acting player currently stands.
  const otherPlayer = [...gameState.players.values()].find((p) => p.playerId !== currentPlayerId);
  otherPlayer.floor = 'ground';
  otherPlayer.x = 5;
  otherPlayer.y = 5;
  gameState.board.ground.set('5,5', { roomId: 'room_teleport_target', x: 5, y: 5, doorSides: [], droppedItems: [], item: null });

  // Entering room_new itself (the event-card-drawing room) already broadcasts its OWN
  // game:roomEntered before event_033 is even drawn -- collect every broadcast and wait
  // for game:effectResolved so both are captured deterministically (same reasoning as
  // Task 1's regression test).
  const roomEnteredEvents = [];
  currentClient.on('game:roomEntered', (payload) => roomEnteredEvents.push(payload));
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;
  currentClient.off('game:roomEntered');

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.floor).toBe('ground');
  expect(after.x).toBe(5);
  expect(after.y).toBe(5);
  expect(roomEnteredEvents).toHaveLength(2); // [0]: entering room_new, [1]: event_033's teleport
  expect(roomEnteredEvents[1].roomId).toBe('room_teleport_target');
  expect(roomEnteredEvents[1].enteredNewRoom).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into event_026 (透入的陽光) zeros action points and restores/advances sanity and knowledge independently', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_026',
        name: '透入的陽光',
        effects: [
          { type: 'action_points', setTo: 0 },
          { type: 'restore_or_advance', stat: 'sanity' },
          { type: 'restore_or_advance', stat: 'knowledge' },
        ],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const before = getPlayer(gameState, currentPlayerId);
  before.stats.sanity.currentIndex = before.stats.sanity.baseIndex - 1; // below base
  // knowledge left untouched, i.e. already at baseIndex

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.actionPoints).toBe(0);
  expect(after.stats.sanity.currentIndex).toBe(after.stats.sanity.baseIndex); // restored, not advanced past base
  expect(after.stats.knowledge.currentIndex).toBe(after.stats.knowledge.baseIndex + 1); // was at base, advanced

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into an event card whose effects move the player again broadcasts a second game:roomEntered for that move (event-card path previously had no such broadcast)', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_test_teleport',
        name: '測試傳送',
        effects: [{ type: 'move_to_room', targetRoomId: 'room_teleport_target' }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  // move_to_room only scans the board for an already-placed room with this id -- it
  // does not create one, so this must be placed manually before the event fires.
  gameState.board.ground.set('5,5', { roomId: 'room_teleport_target', x: 5, y: 5, doorSides: [], droppedItems: [], item: null });

  // Entering room_new itself (the event-card-drawing room, freshly placed east of
  // spawn) already broadcasts its OWN game:roomEntered before the event card is even
  // drawn -- a plain .once() listener would catch that first broadcast, not the one
  // this test is actually checking for. Collect every broadcast instead and wait for
  // game:effectResolved (always emitted once the card's effects finish resolving)
  // before asserting, so both broadcasts are captured deterministically.
  const roomEnteredEvents = [];
  currentClient.on('game:roomEntered', (payload) => roomEnteredEvents.push(payload));
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;
  currentClient.off('game:roomEntered');

  expect(roomEnteredEvents).toHaveLength(2); // [0]: entering room_new, [1]: the event card's own move_to_room
  expect(roomEnteredEvents[1].roomId).toBe('room_teleport_target');
  expect(roomEnteredEvents[1].enteredNewRoom).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into event_029 (濃煙密布) moves the player back and leaves a dice-penalty modifier on the room they left', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_029',
        name: '濃煙密布',
        effects: [
          {
            type: 'persistent_modifier',
            appliesTo: 'roomAndNeighbors',
            effects: [{ hookType: 'onBeforeRoll', delta: -1 }],
          },
          { type: 'move_to_previous_room' },
        ],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const before = getPlayer(gameState, currentPlayerId);
  const startFloor = before.floor;
  const startX = before.x;
  const startY = before.y;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.floor).toBe(startFloor);
  expect(after.x).toBe(startX);
  expect(after.y).toBe(startY);

  // The room the player just left (room_new, where event_029 was drawn) should carry
  // the smoke marker -- found by scanning the board for the placed room_new instance.
  const leftRoom = Array.from(gameState.board[startFloor].values()).find((r) => r.roomId === 'room_new');
  expect(leftRoom.modifiers).toHaveLength(1);
  expect(leftRoom.modifiers[0].effects).toEqual([{ hookType: 'onBeforeRoll', delta: -1 }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:cardDrawn reports hasCheck:true when the drawn card has a dice_check effect', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: { events: [EVENT_001_DICE_CHECK], items: [], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.cardId).toBe('event_001');
  expect(cardDrawn.hasCheck).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:cardDrawn reports hasCheck:false when the drawn card has no dice_check effect', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{ id: 'item_001', name: '測試道具', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.cardId).toBe('item_001');
  expect(cardDrawn.hasCheck).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('drawing a card whose effect is a dice_check broadcasts a cardCheck game:checkResolved to the whole room', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: { events: [EVENT_001_DICE_CHECK], items: [], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const checkResolvedPromise = new Promise((resolve) => otherClient.once('game:checkResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const checkResolved = await checkResolvedPromise;
  expect(checkResolved.playerId).toBe(currentPlayerId);
  expect(checkResolved.checkKind).toBe('cardCheck');
  expect(checkResolved.sourceKind).toBe('event');
  expect(checkResolved.sourceId).toBe('event_001');
  expect(checkResolved.stat).toBe('sanity');
  expect(checkResolved.threshold).toBeNull();
  expect(Array.isArray(checkResolved.tierEffects)).toBe(true);
  expect(typeof checkResolved.passed).toBe('boolean');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_048 grants a bonus item only when the check it was used on passes', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_x',
        name: '測試',
        effects: [{
          type: 'dice_check',
          diceCount: 5,
          tiers: [
            { min: 4, max: 10, pass: true, effects: [] },
            { min: 0, max: 3, pass: false, effects: [] },
          ],
        }],
      }],
      items: [{
        id: 'item_048',
        name: '海盜金幣',
        effects: [],
        diceInterjection: { scope: 'any', consumesItem: true, bonusDice: -1, bonusOnPass: [{ type: 'draw_card', deck: 'item', count: 1 }] },
        category: 'consumable',
      }, {
        id: 'item_100',
        name: '測試獎勵道具',
        effects: [],
        category: 'decoration',
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_048' });
  // The item deck built from content.cards.items still contains BOTH item_048
  // and item_100 as drawable cards -- filter it down to just item_100 so the
  // bonus draw_card below is deterministic (otherwise it could randomly draw
  // item_048 back out of the deck instead, making the assertion flaky).
  gameState.itemDeck.cards = gameState.itemDeck.cards.filter((c) => c.id === 'item_100');

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // 4 dice (5-1 bonusDice) * face 2 = 8, lands in the pass tier
  const cardsDrawnPromise = new Promise((resolve) => currentClient.once('game:cardsDrawn', resolve));
  const diceOptionsPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await diceOptionsPromise;
  await new Promise((resolve) => currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_048' }, resolve));
  const cardsDrawn = await cardsDrawnPromise;
  rngSpy.mockRestore();

  expect(cardsDrawn.cards.some((c) => c.id === 'item_100')).toBe(true); // the bonus draw actually happened
  expect(getPlayer(gameState, currentPlayerId).inventory.some((i) => i.id === 'item_048')).toBe(false); // consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_049 changes the roll outcome via its custom dice faces', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_x',
        name: '測試',
        effects: [{
          type: 'dice_check',
          diceCount: 1,
          tiers: [
            { min: 1, max: 8, pass: true, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] },
            { min: 0, max: 0, pass: false, effects: [] },
          ],
        }],
      }],
      items: [{
        id: 'item_049',
        name: '賭神骰子',
        effects: [],
        diceInterjection: { scope: 'any', consumesItem: true, customFaces: [1, 1, 1, 2, 2, 2] },
        category: 'consumable',
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_049' });

  // Every die face 0 under the DEFAULT DIE_FACES would land on min:0 (fail),
  // but item_049's customFaces [1,1,1,2,2,2] has no 0 face at all -- proves
  // customFaces was actually applied, not just the default table.
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  const diceOptionsPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await diceOptionsPromise;
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_049' }, resolve));
  await effectResolvedPromise;
  rngSpy.mockRestore();

  expect(getPlayer(gameState, currentPlayerId).stats.might.currentIndex).toBe(3); // baseIndex 2 + 1 -- pass tier hit, only reachable with customFaces
  expect(getPlayer(gameState, currentPlayerId).inventory.some((i) => i.id === 'item_049')).toBe(false); // consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('item_048 bonusOnPass survives a pass tier whose own effects are a pending choice (event_010/omen_003 shape)', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_x',
        name: '測試',
        effects: [{
          type: 'dice_check',
          diceCount: 5,
          tiers: [
            {
              min: 4,
              max: 10,
              pass: true,
              effects: [{
                type: 'choice',
                description: '選擇一項能力提升一個級別',
                timeoutMs: 20000,
                defaultOptionId: 'might',
                options: [
                  { optionId: 'might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] },
                ],
              }],
            },
            { min: 0, max: 3, pass: false, effects: [] },
          ],
        }],
      }],
      items: [{
        id: 'item_048',
        name: '海盜金幣',
        effects: [],
        diceInterjection: { scope: 'any', consumesItem: true, bonusDice: -1, bonusOnPass: [{ type: 'draw_card', deck: 'item', count: 1 }] },
        category: 'consumable',
      }, {
        id: 'item_100',
        name: '測試獎勵道具',
        effects: [],
        category: 'decoration',
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_048' });
  // Filter the item deck down to a single deterministic draw target, same technique as the existing
  // item_048 bonus test around line 1740 -- otherwise the bonus draw_card could randomly redraw item_048.
  gameState.itemDeck.cards = gameState.itemDeck.cards.filter((c) => c.id === 'item_100');

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // 4 dice (5-1 bonusDice) * face 2 = 8, lands in the pass tier
  const diceOptionsPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await diceOptionsPromise;
  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_048' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  rngSpy.mockRestore();

  const cardsDrawnPromise = new Promise((resolve) => currentClient.once('game:cardsDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'might' }, resolve));
  const cardsDrawn = await cardsDrawnPromise;

  const player = getPlayer(gameState, currentPlayerId);
  expect(player.stats.might.currentIndex).toBe(3); // baseIndex 2 + 1 -- the choice's own stat_change fired
  expect(cardsDrawn.cards.some((c) => c.id === 'item_100')).toBe(true); // bonusOnPass survived the pending choice and fired after resume
  expect(player.inventory.some((i) => i.id === 'item_048')).toBe(false); // consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:checkResolved passed field reflects the tier\'s explicit pass flag, not a guess from tierEffects content', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_x',
        name: '測試',
        effects: [{
          type: 'dice_check',
          diceCount: 4, // max achievable sum is 4*2=8 -- enough to actually reach the min:8 tier below
          tiers: [
            // "passed" tier that still applies a negative stat_change -- the
            // old heuristic (guessing from tierEffects) would have said
            // false here; the fix must read the explicit pass:true instead.
            { min: 8, max: 8, pass: true, effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            // "failed" tier with no effects at all -- the old heuristic
            // would have said true here (no negative stat_change present).
            { min: 0, max: 7, pass: false, effects: [] },
          ],
        }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient } = await setUpStartedGameWithContent(content);

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // guaranteed to land in the min:8 (pass:true) tier
  const checkResolvedPromise = new Promise((resolve) => otherClient.once('game:checkResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const checkResolved = await checkResolvedPromise;
  rngSpy.mockRestore();

  expect(checkResolved.passed).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('an event card with redrawIf roomDoorCount==4 is skipped when the room actually has 4 doors, drawing the next card instead', async () => {
  const REDRAW_CARD = { id: 'event_x', name: '重抽測試', text: '測試', redrawIf: { check: 'roomDoorCount', op: '==', value: 4 }, effects: [], needsCustomLogic: false };
  const NORMAL_CARD = { id: 'event_y', name: '一般事件', text: '測試', effects: [], needsCustomLogic: false };
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: { events: [REDRAW_CARD, NORMAL_CARD], items: [], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const cardDrawn = await cardDrawnPromise;

  expect(cardDrawn.cardId).toBe('event_y'); // event_x was rejected (room really has 4 doors)
  const gameState = getGameState(gameManager, roomCode);
  expect(gameState.eventDeck.cards.some((c) => c.id === 'event_x')).toBe(true); // cycled to the bottom, not lost

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('an event card with redrawIf roomDoorCount==4 is drawn normally when the room does not have 4 doors', async () => {
  const REDRAW_CARD = { id: 'event_x', name: '重抽測試', text: '測試', redrawIf: { check: 'roomDoorCount', op: '==', value: 4 }, effects: [], needsCustomLogic: false };
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 2, floor: 'ground', drawType: 'event' }],
    cards: { events: [REDRAW_CARD], items: [], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const cardDrawn = await cardDrawnPromise;

  expect(cardDrawn.cardId).toBe('event_x'); // room has 2 doors, condition doesn't match -- drawn immediately

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('an event card with redrawIf playerFloor=="basement" is skipped when the player is actually in the basement', async () => {
  const REDRAW_CARD = { id: 'event_x', name: '重抽測試（地下室）', text: '測試', redrawIf: { check: 'playerFloor', op: '==', value: 'basement' }, effects: [], needsCustomLogic: false };
  const NORMAL_CARD = { id: 'event_y', name: '一般事件', text: '測試', effects: [], needsCustomLogic: false };
  const content = makeContent({
    rooms: [{ id: 'room_basement_new', doors: 4, floor: 'basement', drawType: 'event' }],
    cards: { events: [REDRAW_CARD, NORMAL_CARD], items: [], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  // Manually place the player in a basement room with one unexplored door --
  // there's no normal (non-collapse) way to reach basement in this test's
  // scope, so this mirrors how turnFlow.test.js manually seeds board state.
  player.floor = 'basement';
  player.x = 20;
  player.y = 20;
  gameState.board.basement.set(coordKey(20, 20), { roomId: 'room_manual_basement', x: 20, y: 20, doorSides: ['north'], droppedItems: [], item: null });

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'north' }, resolve));
  const cardDrawn = await cardDrawnPromise;

  expect(cardDrawn.cardId).toBe('event_y'); // event_x rejected -- player really is in the basement

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into a room whose deck is empty draws nothing and does not crash', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: { events: [], items: [], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  let cardDrawnFired = false;
  currentClient.on('game:cardDrawn', () => {
    cardDrawnFired = true;
  });
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(result.error).toBeUndefined();
  await updatePromise;
  expect(cardDrawnFired).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into a room whose card effects include a choice broadcasts game:effectPendingChoice instead of resolving immediately', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  expect(pendingChoice.description).toBe('選擇要下降哪項');
  expect(pendingChoice.options).toHaveLength(2);

  clientA.close();
  clientB.close();
  httpServer.close();
});

async function setUpStartedGameWithContent(content, options) {
  const { httpServer, port, gameManager, effectResolverManager } = await startTestServer(content, options);
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const roomCode = created.roomCode;
  const aliceId = created.playerId;

  const clientB = ioClient(url);
  const joined = await new Promise((resolve) =>
    clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve)
  );
  const bobId = joined.playerId;

  const started = new Promise((resolve) => clientA.once('game:started', resolve));
  const firstPromptA = new Promise((resolve) => clientA.once('game:prompt', resolve));
  const firstPromptB = new Promise((resolve) => clientB.once('game:prompt', resolve));
  await new Promise((resolve) => clientA.emit('game:startCharacterSelect', {}, resolve));
  const [prompt1] = await Promise.all([firstPromptA, firstPromptB]);
  const firstPickerClient = prompt1.targetPlayerId === aliceId ? clientA : clientB;
  const secondPickerClient = prompt1.targetPlayerId === aliceId ? clientB : clientA;

  const secondPrompt = new Promise((resolve) => secondPickerClient.once('game:prompt', resolve));
  // Wait for BOTH clients to actually receive each game:promptResolved broadcast
  // before proceeding -- otherwise, under load, a still-in-flight broadcast from
  // character selection can be caught by a caller's own later .once('game:promptResolved', ...)
  // listener instead of the event it's actually waiting for (same race class fixed
  // in M2b-2 Task 3/Task 4 for game:prompt).
  const firstRespondedA = new Promise((resolve) => clientA.once('game:promptResolved', resolve));
  const firstRespondedB = new Promise((resolve) => clientB.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    firstPickerClient.emit('game:promptRespond', { promptId: prompt1.promptId, optionId: prompt1.options[0] }, resolve)
  );
  await Promise.all([firstRespondedA, firstRespondedB]);
  const prompt2 = await secondPrompt;
  const secondRespondedA = new Promise((resolve) => clientA.once('game:promptResolved', resolve));
  const secondRespondedB = new Promise((resolve) => clientB.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    secondPickerClient.emit('game:promptRespond', { promptId: prompt2.promptId, optionId: prompt2.options[0] }, resolve)
  );
  await Promise.all([secondRespondedA, secondRespondedB]);

  const startedPayload = await started;
  const currentPlayerId = startedPayload.turnOrder[startedPayload.currentPlayerIndex];
  const currentClient = currentPlayerId === aliceId ? clientA : clientB;
  const otherClient = currentPlayerId === aliceId ? clientB : clientA;

  return { httpServer, clientA, clientB, roomCode, aliceId, bobId, currentClient, otherClient, currentPlayerId, startedPayload, gameManager, effectResolverManager };
}

// A round is 5 phases (player_move -> npc_move -> player_interact ->
// npc_interact -> settlement), not 1 immediate hand-off like the old turn
// model. With 2 real players and no NPCs, npc_move/npc_interact
// auto-cascade, so completing one full round takes 3 pairs of locks (6
// total game:endTurn calls). Needed only by tests that verify per-ROUND
// resets (e.g. item_038's stat revert, the once-per-round search gate) --
// those only fire when player_move is re-entered, not on every phase lock.
async function completeFullRound(currentClient, otherClient) {
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve)); // lock player_move
  await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve)); // -> player_interact
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve)); // lock player_interact
  await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve)); // -> settlement
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve)); // lock settlement
  return new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve)); // -> wraps to a fresh player_move
}

test('game:effectPromptRespond resolves the pending choice and applies the chosen effects', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const respondResult = await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });
  expect(respondResult.error).toBeUndefined();

  await effectResolvedPromise;
  const update = await updatePromise;
  const me = update.players.find((p) => p.playerId === currentPlayerId);
  expect(me.stats.speed.currentIndex).toBe(me.stats.speed.baseIndex - 1);
  expect(me.stats.might.currentIndex).toBe(me.stats.might.baseIndex); // untouched

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:effectPromptRespond rejects when there is no pending effect choice for the room', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: 'not_real', optionId: 'anything' }, resolve);
  });
  expect(result.error).toBe('NO_ACTIVE_EFFECT_CHOICE');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('an effect choice that times out auto-resolves with the default option', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 50,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const promptResolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  const stateUpdatePromise = new Promise((resolve) => {
    currentClient.on('game:stateUpdate', (data) => {
      const me = data.players.find((p) => p.playerId === currentPlayerId);
      if (me.stats.might.currentIndex < me.stats.might.baseIndex) resolve(data);
    });
  });
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const resolved = await promptResolvedPromise;
  expect(resolved.wasTimeout).toBe(true);
  expect(resolved.chosenOptionId).toBe('opt_might');
  await stateUpdatePromise; // proves the default option's effects were actually applied

  clientA.close();
  clientB.close();
  httpServer.close();
}, 2000);

test('game:move that opens a room whose card requires a choice does not advance the turn, and further actions are blocked until resolved', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await pendingChoicePromise;
  const update = await updatePromise;

  // AP was zeroed by opening the door, but the turn must not have advanced
  // while the card effect is still waiting on a player choice.
  expect(update.turnOrder[update.currentPlayerIndex]).toBe(currentPlayerId);

  const secondMove = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'north' }, resolve));
  expect(secondMove.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  const selectActionResult = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item' }, resolve));
  expect(selectActionResult.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  const useStairsResult = await new Promise((resolve) => currentClient.emit('game:useStairs', {}, resolve));
  expect(useStairsResult.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('resolving a pending effect choice does not by itself advance the phase -- locking (game:endTurn) is still required', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;

  const respondedUpdatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });
  const respondedUpdate = await respondedUpdatePromise;
  expect(respondedUpdate.currentPhase).toBe('player_move');

  // The choice is resolved now, so EFFECT_CHOICE_IN_PROGRESS no longer blocks
  // game:endTurn -- proves resolving the choice actually cleared the gate.
  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a pending effect choice that times out still requires locking (game:endTurn) to advance the phase', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 50,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const timedOutUpdatePromise = new Promise((resolve) => {
    currentClient.on('game:stateUpdate', (data) => {
      const me = data.players.find((p) => p.playerId === currentPlayerId);
      if (me.stats.might.currentIndex < me.stats.might.baseIndex) resolve(data);
    });
  });
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const timedOutUpdate = await timedOutUpdatePromise;
  expect(timedOutUpdate.currentPhase).toBe('player_move');

  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
}, 2000);

test('a real effectPromptRespond before the deadline cancels the scheduled timeout so it cannot later double-resolve the choice', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 100,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  const resolvedEvents = [];
  currentClient.on('game:promptResolved', (payload) => resolvedEvents.push(payload));

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;

  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });

  // Wait past where the original 100ms deadline would have fired, to prove the
  // scheduled timeout was actually cancelled and cannot later double-resolve.
  await new Promise((resolve) => setTimeout(resolve, 150));

  const resolvedForPrompt = resolvedEvents.filter((r) => r.promptId === pendingChoice.promptId);
  expect(resolvedForPrompt).toHaveLength(1);
  expect(resolvedForPrompt[0].wasTimeout).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into a room with an unknown drawType does not crash the room, and the phase still locks normally via game:endTurn', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'unknown_deck_type' }],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(result.error).toBeUndefined(); // moveToRoom itself succeeded

  const update = await updatePromise;
  // Despite the resolveCardDraw failure (UNKNOWN_DECK_TYPE), the room stays in
  // sync and nothing crashes -- see M2c-2 final review Important I3. The phase
  // itself no longer auto-advances, so confirm it's still lockable.
  expect(update.currentPhase).toBe('player_move');

  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});

// C1's fix (defer advanceTurnIfOver until a pending effect choice actually
// resolves) lives entirely behind the generic `deckType` parameter in
// resolveCardDraw/DECK_FIELD_BY_TYPE -- it is not item-deck-specific. The
// tests above only exercised drawType: 'item'; these two prove the same
// full loop (choice opens -> turn stays put -> respond -> turn advances)
// for the event and omen decks too, per the developer's explicit request
// to verify this empirically rather than trust the code-path reading alone.
test('an event-deck card requiring a choice defers the phase the same way an item-deck card does', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_002',
        name: '測試選擇事件',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  const firstUpdatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  const firstUpdate = await firstUpdatePromise;
  expect(firstUpdate.currentPhase).toBe('player_move');

  const blockedMove = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'north' }, resolve));
  expect(blockedMove.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });

  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('an omen-deck card requiring a choice defers the phase the same way an item-deck card does', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{
        id: 'omen_002',
        name: '測試選擇預兆',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  const firstUpdatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  const firstUpdate = await firstUpdatePromise;
  expect(firstUpdate.currentPhase).toBe('player_move');

  const blockedSelectAction = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item' }, resolve));
  expect(blockedSelectAction.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });

  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: uses a held consumable item on self and removes it from inventory after it applies', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_003',
        name: '治療藥膏',
        effects: [{ type: 'stat_change', stat: 'might', delta: 1 }],
        category: 'consumable',
        canTargetOthers: true,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_003' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const result = await new Promise((resolve) => {
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result).toEqual({ kind: 'item', itemId: 'item_003', targetPlayerId: currentPlayerId });

  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.sourceId).toBe('item_003');
  expect(getPlayer(gameState, currentPlayerId).stats.might.currentIndex).toBe(3); // baseIndex 2 + 1
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([]); // consumable removed after applying

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_044 with rng landing on option 6 (行動力歸零): resets action points to 0', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_044',
        name: '有限手套',
        effects: [{
          type: 'random_effect',
          options: [
            { effects: [{ type: 'move_to_random_neighbor_room' }] },
            { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'knowledge', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
            { effects: [{ type: 'action_points', setTo: 0 }] },
          ],
        }],
        category: 'reusable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_044' });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // 0.99 * 6 options -> index 5 (action_points setTo 0)
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_044' }, resolve));
  await effectResolvedPromise;
  rngSpy.mockRestore();

  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_044 with rng landing on option 1 (移動到隨機一個鄰房): moves the player', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_044',
        name: '有限手套',
        effects: [{
          type: 'random_effect',
          options: [
            { effects: [{ type: 'move_to_random_neighbor_room' }] },
            { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'knowledge', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
            { effects: [{ type: 'action_points', setTo: 0 }] },
          ],
        }],
        category: 'reusable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_044' });
  const before = getPlayer(gameState, currentPlayerId);
  const startFloor = before.floor;
  const startX = before.x;
  const startY = before.y;

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // 0 * 6 options -> index 0 (move_to_random_neighbor_room), then its own rng call picks the first door-connected candidate
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_044' }, resolve));
  await effectResolvedPromise;
  rngSpy.mockRestore();

  const after = getPlayer(gameState, currentPlayerId);
  const moved = after.floor !== startFloor || after.x !== startX || after.y !== startY;
  expect(moved).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_044 with rng landing on option 6: sends the matching feedbacktextDice string as randomEffectText', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_044',
        name: '有限手套',
        feedbacktextDice: {
          '1': '藍色寶石閃了一下，你被移動到了隔壁房間',
          '2': '橙色寶石閃了一下，你心中充滿了惡念',
          '3': '黃色寶石閃了一下，你感覺遺忘了很多事情',
          '4': '紫色寶石閃了一下，你感覺手套吸走了你的力量',
          '5': '綠色寶石閃了一下，你感覺自己變遲鈍了',
          '6': '紅色寶石閃了一下，你無法動彈了',
        },
        effects: [{
          type: 'random_effect',
          options: [
            { effects: [{ type: 'move_to_random_neighbor_room' }] },
            { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'knowledge', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
            { effects: [{ type: 'action_points', setTo: 0 }] },
          ],
        }],
        category: 'reusable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_044' });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // 0.99 * 6 options -> index 5
  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_044' }, resolve));
  const itemUseResolved = await itemUseResolvedPromise;
  rngSpy.mockRestore();

  expect(itemUseResolved.randomEffectText).toBe('紅色寶石閃了一下，你無法動彈了');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_040 with rng landing on index 3: sends the matching feedbacktextOccur array entry as randomEffectText', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_040',
        name: '一疊紙牌',
        feedbacktextOccur: ['抽到了紅心七', '抽到了黑桃二', '抽到了梅花三', '抽到了鬼牌', '抽到了黑桃Ａ', '抽到了黑桃Ｊ'],
        effects: [{
          type: 'random_effect',
          options: [
            { effects: [] }, { effects: [] }, { effects: [] },
            { effects: [] }, { effects: [] }, { effects: [] },
          ],
        }],
        category: 'reusable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_040' });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5); // 0.5 * 6 options -> index 3
  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_040' }, resolve));
  const itemUseResolved = await itemUseResolvedPromise;
  rngSpy.mockRestore();

  expect(itemUseResolved.randomEffectText).toBe('抽到了鬼牌');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_044 with rng landing on option 1: broadcasts game:roomEntered when the random neighbor is a room the player has never visited', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    cards: {
      events: [],
      items: [{
        id: 'item_044',
        name: '有限手套',
        effects: [{
          type: 'random_effect',
          options: [
            { effects: [{ type: 'move_to_random_neighbor_room' }] },
            { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'knowledge', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
            { effects: [{ type: 'action_points', setTo: 0 }] },
          ],
        }],
        category: 'reusable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_044' });

  // Manually place a not-yet-visited neighbor to the east of the player's starting room
  // (room_lobby_a, (0,1)) so move_to_random_neighbor_room has a genuinely new room to reach.
  gameState.board.ground.set('1,1', { roomId: 'room_new_neighbor', x: 1, y: 1, doorSides: ['west'], droppedItems: [], item: null });

  // room_lobby_a's default board placement already has a door to room_lobby_b
  // (north), so 'north' is also a valid move_to_random_neighbor_room candidate
  // alongside our manually-placed east neighbor. Two sequential values pin
  // both rng calls deterministically: 0 for the outer 6-option pick (index 0,
  // move_to_random_neighbor_room) and 0.99 for the inner 2-candidate pick
  // (candidates are [north, east] in SIDES order -> index 1, east).
  const rngSpy = jest.spyOn(Math, 'random');
  rngSpy.mockReturnValueOnce(0);
  rngSpy.mockReturnValueOnce(0.99);
  const roomEnteredPromise = new Promise((resolve) => currentClient.once('game:roomEntered', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_044' }, resolve));
  const roomEntered = await roomEnteredPromise;
  rngSpy.mockRestore();

  expect(roomEntered.enteredNewRoom).toBe(true);
  expect(roomEntered.roomId).toBe('room_new_neighbor');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_038 sets might to the non-lethal floor and speed to max, reverting both at the start of the user\'s next round', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_038',
        name: '可疑藥丸',
        effects: [
          { type: 'stat_change', stat: 'might', setToLevel: 'min', revertAtNextTurnStart: true },
          { type: 'stat_change', stat: 'speed', setToLevel: 'max', revertAtNextTurnStart: true },
        ],
        category: 'consumable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_038' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_038' }, resolve));
  await effectResolvedPromise;

  let me = getPlayer(gameState, currentPlayerId);
  expect(me.stats.might.currentIndex).toBe(1); // skullIndex 0 + 1
  expect(me.stats.speed.currentIndex).toBe(4); // track.length 5 - 1
  expect(me.inventory).toEqual([]); // consumed

  // A round is 5 phases, not 1 immediate hand-off -- both real players must
  // lock through player_move, player_interact, and settlement before the
  // round wraps back to a fresh player_move, which is the only place the
  // revert fires (moved there from the old turnFlow.js advanceTurn in the
  // 2026-09-03 regression fix). Not reverted partway through.
  const finalLock = await completeFullRound(currentClient, otherClient);
  expect(finalLock.currentPhase).toBe('player_move');
  me = getPlayer(gameState, currentPlayerId);
  expect(me.stats.might.currentIndex).toBe(2); // baseIndex, reverted
  expect(me.stats.speed.currentIndex).toBe(2); // baseIndex, reverted

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: a dice_check effect can see the player\'s itemCatalog-eligible held items via context (regression guard for context threading)', async () => {
  // This test doesn't assert the full rollChoice flow (Task 7's job) -- it
  // only proves item-catalog data actually reaches handleDiceCheck through
  // game:selectAction's resolveEffects call, by observing that holding a
  // matching item changes the dice_check from "resolves immediately" to
  // "does not resolve immediately" (still pending after the ack).
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        {
          id: 'item_003',
          name: '測試道具',
          effects: [{
            type: 'dice_check',
            diceCount: 2,
            tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
          }],
          category: 'general',
        },
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [], consumesItem: false },
        },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const noEffectResolvedTimer = new Promise((resolve) => setTimeout(() => resolve('timeout'), 300));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const outcome = await Promise.race([effectResolvedPromise, noEffectResolvedTimer]);
  // Holding item_006 (a matching diceInterjection item) means the dice_check
  // must NOT have resolved immediately -- if context.itemCatalog wasn't
  // threaded through, it would have rolled right away and emitted effectResolved.
  expect(outcome).toBe('timeout');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: throws ITEM_NOT_HELD when the player does not have the item', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'not_held' }, resolve);
  });
  expect(result.error).toBe('ITEM_NOT_HELD');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: a general-category item is not removed from inventory after use', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_006',
        name: '詭異人偶',
        effects: [{ type: 'stat_change', stat: 'might', delta: 1 }],
        category: 'general',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_006' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_006' }, resolve));
  await effectResolvedPromise;

  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_006' }]); // still held

  clientA.close();
  clientB.close();
  httpServer.close();
});

const REVEAL_ITEM_ROOMS = [{ id: 'room_kitchen', name: '廚房', doors: 4, floor: 'ground' }];
const REVEAL_ITEM_CARD = { id: 'item_036', name: '老鷹木雕', effects: [{ type: 'reveal_player_locations' }], category: 'reusable', canTargetOthers: false };

test('game:selectAction item_036 reveals another player\'s room via revealText on game:itemUseResolved', async () => {
  const content = makeContent({
    rooms: REVEAL_ITEM_ROOMS,
    cards: { events: [], items: [REVEAL_ITEM_CARD], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_036' });
  const otherPlayer = getPlayer(gameState, otherPlayerId);
  otherPlayer.floor = 'ground';
  otherPlayer.x = 99;
  otherPlayer.y = 99;
  gameState.board.ground.set(coordKey(99, 99), { roomId: 'room_kitchen', x: 99, y: 99, doorSides: ['north'], droppedItems: [], item: null });

  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_036' }, resolve));
  const data = await itemUseResolvedPromise;

  expect(data.revealText).toContain('廚房');
  expect(data.revealText).toContain(otherPlayer.name);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_036 groups two other players in the same room onto one line', async () => {
  const content = makeContent({
    rooms: REVEAL_ITEM_ROOMS,
    cards: { events: [], items: [REVEAL_ITEM_CARD], omens: [] },
  });
  // setUpStartedGameWithContent only sets up 2 real socket clients/players (clientA/clientB) --
  // for a THIRD player, insert a synthetic player object directly into gameState.players (a Map)
  // after setup, rather than a third real socket client. Only the fields getPlayer/buildRevealText
  // actually read are required: playerId, name, floor, x, y.
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_036' });
  const otherPlayer = getPlayer(gameState, otherPlayerId);
  otherPlayer.floor = 'ground';
  otherPlayer.x = 99;
  otherPlayer.y = 99;
  gameState.players.set('synthetic_p3', { playerId: 'synthetic_p3', name: 'Carol-synthetic', floor: 'ground', x: 99, y: 99, inventory: [] });
  gameState.board.ground.set(coordKey(99, 99), { roomId: 'room_kitchen', x: 99, y: 99, doorSides: ['north'], droppedItems: [], item: null });

  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_036' }, resolve));
  const data = await itemUseResolvedPromise;

  // Both other players share room_kitchen -> exactly one room-group, both names on it
  expect(data.revealText).toContain('廚房');
  expect(data.revealText).toContain(otherPlayer.name);
  expect(data.revealText).toContain('Carol-synthetic');
  expect(data.revealText.split('；').length).toBe(1); // one room-group, not two separate lines
  expect(data.revealText).toMatch(/、/); // the two names are joined with 、 within that one group

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_036 does not merge two other players who are in different rooms that happen to share a name', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_hall_1', name: '大門廳', doors: 4, floor: 'ground' },
      { id: 'room_hall_2', name: '大門廳', doors: 4, floor: 'ground' },
    ],
    cards: { events: [], items: [REVEAL_ITEM_CARD], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_036' });
  const otherPlayer = getPlayer(gameState, otherPlayerId);
  otherPlayer.floor = 'ground';
  otherPlayer.x = 50;
  otherPlayer.y = 50;
  gameState.board.ground.set(coordKey(50, 50), { roomId: 'room_hall_1', x: 50, y: 50, doorSides: ['north'], droppedItems: [], item: null });
  gameState.players.set('synthetic_p3', { playerId: 'synthetic_p3', name: 'Carol-synthetic', floor: 'ground', x: 60, y: 60, inventory: [] });
  gameState.board.ground.set(coordKey(60, 60), { roomId: 'room_hall_2', x: 60, y: 60, doorSides: ['north'], droppedItems: [], item: null });

  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_036' }, resolve));
  const data = await itemUseResolvedPromise;

  // Same room NAME, but different room cells -- must stay two separate groups, not merge into one
  expect(data.revealText.split('；').length).toBe(2);
  expect(data.revealText).not.toMatch(/、/); // no two names joined onto the same line

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_036 used while alone (no other players) returns the fixed fallback text', async () => {
  const content = makeContent({
    cards: { events: [], items: [REVEAL_ITEM_CARD], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_036' });
  gameState.players.delete(otherPlayerId); // simulate being alone -- only the acting player remains

  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_036' }, resolve));
  const data = await itemUseResolvedPromise;

  expect(data.revealText).toBe('目前沒有發現其他玩家的蹤跡');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction a normal item without reveal_player_locations still emits game:itemUseResolved with no revealText field', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [{ id: 'item_001', name: '測試道具', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }], category: 'consumable' }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_001' });

  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_001' }, resolve));
  const data = await itemUseResolvedPromise;

  expect(data).toEqual({ playerId: currentPlayerId, itemId: 'item_001' });
  expect(data.revealText).toBeUndefined();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item use with no dice_check broadcasts game:itemUseResolved', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_050', name: '無考驗道具', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }], category: 'general' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_050' });

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_050' }, resolve));
  const resolved = await resolvedPromise;

  expect(resolved.playerId).toBe(currentPlayerId);
  expect(resolved.itemId).toBe('item_050');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item use with canTargetOthers broadcasts game:itemUseResolved to both the actor and the target', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_060', name: '可施放於他人的道具', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }], category: 'general', canTargetOthers: true },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  gameState.currentPhase = 'player_interact';
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_060' });

  // The fix emits game:itemUseResolved twice -- once for the acting player,
  // once for the effect target -- and both emits are broadcast to the whole
  // room, so both sockets see both events. Collect everything the
  // non-acting client's socket receives and check both payloads landed.
  const otherClientEvents = [];
  const otherClientDonePromise = new Promise((resolve) => {
    otherClient.on('game:itemUseResolved', (data) => {
      otherClientEvents.push(data);
      if (otherClientEvents.length === 2) resolve();
    });
  });

  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_060', targetPlayerId: otherPlayerId }, resolve)
  );
  await otherClientDonePromise;

  expect(otherClientEvents).toContainEqual({ playerId: currentPlayerId, itemId: 'item_060' });
  expect(otherClientEvents).toContainEqual({ playerId: otherPlayerId, itemId: 'item_060' });

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item use of item_050 (聖水) on another player removes the target\'s imprint, not the user\'s', async () => {
  const content = makeContent({
    cards: {
      events: [], items: [
        { id: 'item_050', name: '聖水', effects: [{ type: 'remove_imprint' }], category: 'consumable', canTargetOthers: true },
      ],
      omens: [
        { id: 'omen_002', name: '古書', category: 'imprint', effects: [{ type: 'stat_change', stat: 'knowledge', delta: 2 }] },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  gameState.currentPhase = 'player_interact';
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_050' }, { id: 'omen_002' });
  getPlayer(gameState, otherPlayerId).inventory.push({ id: 'omen_002' });

  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_050', targetPlayerId: otherPlayerId }, resolve)
  );

  expect(getPlayer(gameState, otherPlayerId).inventory).toEqual([]);
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'omen_002' }]); // item_050 itself is consumed by consumeItemIfApplied, the user's own omen_002 is untouched

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item use of item_050 (聖水) on a target with no imprint does not consume the item', async () => {
  const content = makeContent({
    cards: {
      events: [], items: [
        { id: 'item_050', name: '聖水', effects: [{ type: 'remove_imprint' }], category: 'consumable', canTargetOthers: true },
      ],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  gameState.currentPhase = 'player_interact';
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_050' });

  const result = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_050', targetPlayerId: otherPlayerId }, resolve)
  );

  expect(result.error).toBeUndefined(); // the action itself must actually run -- otherwise "no imprint to remove" and "blocked by phase gate" look identical below
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_050' }]);
  expect(getPlayer(gameState, otherPlayerId).inventory).toEqual([]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item use with a dice_check does NOT broadcast game:itemUseResolved', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        {
          id: 'item_051',
          name: '有考驗道具',
          effects: [{
            type: 'dice_check',
            diceCount: 2,
            tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
          }],
          category: 'general',
        },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_051' });

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 300));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_051' }, resolve));
  const outcome = await Promise.race([resolvedPromise, timeoutPromise]);

  expect(outcome).toBe('timeout');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: a consumable item that fails its check is not removed (matches 魔術方塊 rules)', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_009',
        name: '魔術方塊',
        effects: [{
          type: 'dice_check',
          diceCount: 1,
          tiers: [{ min: 0, max: 8, effects: [] }], // always "fails" -> no effects applied
        }],
        category: 'consumable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_009' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_009' }, resolve));
  await effectResolvedPromise;

  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_009' }]); // check "failed" -> not consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

const ITEM_027_MUSIC_SCORE = {
  id: 'item_027',
  name: '魔力樂譜',
  effects: [{
    type: 'room_gate',
    roomIds: ['room_organ', 'room_piano'],
    effects: [{
      type: 'dice_check',
      stat: 'knowledge',
      tiers: [
        { min: 6, max: 8, effects: [{ type: 'stat_change', stat: 'speed', delta: 1 }] },
        { min: 0, max: 5, effects: [] },
      ],
    }],
  }],
  category: 'consumable',
  canTargetOthers: false,
};

test('game:selectAction item_027 in room_organ with a passing knowledge check: speed +1, item consumed', async () => {
  const content = makeContent({
    cards: { events: [], items: [ITEM_027_MUSIC_SCORE], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_027' });
  player.floor = 'ground';
  player.x = 40;
  player.y = 40;
  player.stats.knowledge.currentIndex = 3; // 4 dice at baseIndex+2 track value -- guarantees a sum >= 6 with the mock below
  gameState.board.ground.set('40,40', { roomId: 'room_organ', x: 40, y: 40, doorSides: ['north'], droppedItems: [], item: null });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // every die -> highest face, guaranteed pass
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_027' }, resolve));
  await effectResolvedPromise;
  rngSpy.mockRestore();

  expect(getPlayer(gameState, currentPlayerId).stats.speed.currentIndex).toBe(3); // baseIndex 2 + 1
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([]); // consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_027 in room_organ with a failing knowledge check: no stat change, item kept', async () => {
  const content = makeContent({
    cards: { events: [], items: [ITEM_027_MUSIC_SCORE], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_027' });
  player.floor = 'ground';
  player.x = 40;
  player.y = 40;
  gameState.board.ground.set('40,40', { roomId: 'room_organ', x: 40, y: 40, doorSides: ['north'], droppedItems: [], item: null });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // every die -> lowest face, guaranteed fail
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_027' }, resolve));
  await effectResolvedPromise;
  rngSpy.mockRestore();

  expect(getPlayer(gameState, currentPlayerId).stats.speed.currentIndex).toBe(2); // unchanged (baseIndex)
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_027' }]); // not consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_027 outside room_organ/room_piano: no effect, item kept', async () => {
  const content = makeContent({
    cards: { events: [], items: [ITEM_027_MUSIC_SCORE], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_027' });
  player.floor = 'ground';
  player.x = 40;
  player.y = 40;
  gameState.board.ground.set('40,40', { roomId: 'room_lobby_a', x: 40, y: 40, doorSides: ['north'], droppedItems: [], item: null });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_027' }, resolve));
  await effectResolvedPromise;

  expect(getPlayer(gameState, currentPlayerId).stats.speed.currentIndex).toBe(2); // unchanged
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_027' }]); // not consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: resolves the current room\'s effects', async () => {
  const content = makeContent({
    rooms: [{
      id: 'room_new',
      doors: 4,
      floor: 'ground',
      actions: [{ label: '考驗', kind: 'effects', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
    }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  // Manually restore some actionPoints so there's a room action to perform
  // -- opening the door already spent them all on the move itself.
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  expect(result).toEqual({ kind: 'room_action' });

  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.sourceId).toBe('room_new');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a room with no effects/craftRecipes defaults to search, and the starting entrance hall finds nothing (item defaults to null)', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGame();
  // Default starting room (entrance hall) has no `effects`/`craftRecipes`/`item` field -- search defaults apply.
  const gameState = getGameState(gameManager, roomCode);
  const apBeforeSearch = getPlayer(gameState, currentPlayerId).actionPoints;

  const searchEmptyPromise = new Promise((resolve) => currentClient.once('game:searchEmpty', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const searchEmpty = await searchEmptyPromise;
  expect(searchEmpty.playerId).toBe(currentPlayerId);

  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(apBeforeSearch - 1);

  clientA.close();
  clientB.close();
  httpServer.close();
});

function makeSearchRoomContent(itemField) {
  return makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', item: itemField }],
  });
}

test('game:selectAction room_action with item:"random_one": finds a card from the shared item deck, adds it to inventory, and clears the room to null', async () => {
  const content = makeSearchRoomContent('random_one');
  content.cards.items = [{ id: 'item_001', name: '測試道具', effects: [] }];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.deckType).toBe('item');
  expect(cardDrawn.cardId).toBe('item_001');

  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_001' }]);
  expect(gameState.itemDeck.cards).toEqual([]);
  const placedRoom = gameState.board.ground.get(coordKey(1, 1));
  expect(placedRoom.item).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with item:"random_one": finds nothing when the shared item deck is empty, and the item field is unchanged', async () => {
  const content = makeSearchRoomContent('random_one');
  content.cards.items = [];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const searchEmptyPromise = new Promise((resolve) => currentClient.once('game:searchEmpty', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  await searchEmptyPromise;

  const placedRoom = gameState.board.ground.get(coordKey(1, 1));
  expect(placedRoom.item).toBe('random_one'); // 沒有真的抽到，狀態不變

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with a fixed item list: finds one of the listed ids still present in the shared deck and removes it from the room\'s own list', async () => {
  const content = makeSearchRoomContent(['item_001', 'item_002']);
  content.cards.items = [{ id: 'item_002', name: '測試道具', effects: [] }]; // item_001 already taken elsewhere
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.cardId).toBe('item_002');

  const placedRoom = gameState.board.ground.get(coordKey(1, 1));
  expect(placedRoom.item).toEqual(['item_001']);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with a fixed item list: finds nothing when every listed id has already been taken from the shared deck', async () => {
  const content = makeSearchRoomContent(['item_001']);
  content.cards.items = []; // item_001 already gone (taken by another room's random_one)
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const searchEmptyPromise = new Promise((resolve) => currentClient.once('game:searchEmpty', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  await searchEmptyPromise;

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: finding a weapon with a companionItemId also grants the companion item, with its own game:cardDrawn broadcast', async () => {
  const content = makeSearchRoomContent(['item_001']);
  content.cards.items = [
    { id: 'item_001', name: '左輪手槍', effects: [], companionItemId: 'item_046' },
    { id: 'item_046', name: '左輪子彈' },
  ];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const cardDrawnEvents = [];
  currentClient.on('game:cardDrawn', (data) => cardDrawnEvents.push(data));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();

  expect(cardDrawnEvents).toHaveLength(2);
  expect(cardDrawnEvents[0]).toMatchObject({ deckType: 'item', cardId: 'item_001', cardName: '左輪手槍', hasCheck: false });
  expect(cardDrawnEvents[1]).toMatchObject({ deckType: 'item', cardId: 'item_046', cardName: '左輪子彈', hasCheck: false });

  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_001' }, { id: 'item_046' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: finding an item with no companionItemId behaves exactly as before (no extra grant, no extra broadcast)', async () => {
  const content = makeSearchRoomContent(['item_002']);
  content.cards.items = [{ id: 'item_002', name: '測試道具', effects: [] }];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const cardDrawnEvents = [];
  currentClient.on('game:cardDrawn', (data) => cardDrawnEvents.push(data));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();

  expect(cardDrawnEvents).toHaveLength(1);
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_002' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a weapon plus its companion item together exceed the carry limit -- both are offered in the choice, with the companion (last newly-acquired item) as the default', async () => {
  const content = makeSearchRoomContent(['item_001']);
  content.cards.items = [
    { id: 'item_101', name: '道具一' },
    { id: 'item_102', name: '道具二' },
    { id: 'item_001', name: '左輪手槍', effects: [], companionItemId: 'item_046' },
    { id: 'item_046', name: '左輪子彈' },
  ];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode, effectResolverManager } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.actionPoints = 1;
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }); // default character has might 3 (see makeStats() in this file) -- 2 held + 2 newly acquired = 4 > cap 3

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const pending = await pendingPromise;

  expect(pending.itemIds.sort()).toEqual(['item_101', 'item_102', 'item_001', 'item_046'].sort());
  const entry = getResolver(effectResolverManager, roomCode);
  expect(entry.pendingInventoryChoice.triggeredByItemId).toBe('item_046');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: using item_001 (empty effects, companionItemId is a data field not an effect) is a harmless no-op, matching an ordinary effect-less weapon -- regression guard against the exploit the final review caught', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [{ id: 'item_001', name: '左輪手槍', effects: [], companionItemId: 'item_046', category: 'weapon' }, { id: 'item_046', name: '左輪子彈' }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_001' });

  const result = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_001' }, resolve)
  );
  expect(result.error).toBeUndefined();
  expect(player.inventory).toEqual([{ id: 'item_001' }]); // no item_046 granted, item_001 not consumed -- effects was empty, companionItemId is never read by this path

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a second search in the same turn is rejected with ALREADY_SEARCHED_THIS_TURN, without spending an action point', async () => {
  const content = makeSearchRoomContent('random_one');
  content.cards.items = [
    { id: 'item_001', name: '測試道具1', effects: [] },
    { id: 'item_002', name: '測試道具2', effects: [] },
  ];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 2;

  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  const afterFirst = getPlayer(gameState, currentPlayerId).actionPoints;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBe('ALREADY_SEARCHED_THIS_TURN');
  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(afterFirst); // 沒有再扣一次

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a player can search the same room again on their next round, after searching it once and completing a round', async () => {
  const content = makeSearchRoomContent(['item_001', 'item_002']);
  content.cards.items = [
    { id: 'item_001', name: '測試道具1', effects: [] },
    { id: 'item_002', name: '測試道具2', effects: [] },
  ];
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  // Round 1: search once, get one of the two listed items.
  const firstFoundPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  const firstFound = await firstFoundPromise;

  // Same-round second search is rejected (already covered by another test);
  // a round is 5 phases, not 1 immediate hand-off -- both real players must
  // lock through player_move, player_interact, and settlement before the
  // round wraps back to a fresh player_move, which is the only place
  // searchedThisTurn resets (moved there from the old turnFlow.js
  // advanceTurn in the 2026-09-03 regression fix).
  const finalLock = await completeFullRound(currentClient, otherClient);
  expect(finalLock.currentPhase).toBe('player_move');
  getPlayer(gameState, currentPlayerId).actionPoints = 1; // restore AP for the second search

  // Round 2 (same player, same room, no move needed -- they never left):
  // search again and get the other listed item.
  const secondFoundPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const secondFound = await secondFoundPromise;

  const remainingId = ['item_001', 'item_002'].find((id) => id !== firstFound.cardId);
  expect(secondFound.cardId).toBe(remainingId);
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual(
    expect.arrayContaining([{ id: 'item_001' }, { id: 'item_002' }])
  );

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: existing craftRecipes/effects rooms are unaffected by the search branch (regression)', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', actions: [{ label: '考驗', kind: 'effects', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }] }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.sourceId).toBe('room_new');

  clientA.close();
  clientB.close();
  httpServer.close();
});

function makeCraftRoomContent() {
  return makeContent({
    rooms: [{
      id: 'room_new',
      doors: 4,
      floor: 'ground',
      actions: [{ label: '烹飪', kind: 'craft' }],
      craftRecipes: [{ id: 'recipe_cooked_food', ingredients: ['item_016', 'item_017'], result: 'item_021' }],
    }],
  });
}

test('game:selectAction room_action with craftRecipes: holding both ingredients broadcasts a yes/no choice and spends 1 action point', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(makeCraftRoomContent());

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_016' }, { id: 'item_017' });
  player.actionPoints = 1;

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const pendingChoice = await pendingChoicePromise;

  expect(pendingChoice.description).toBe('要不要進行烹飪？');
  expect(pendingChoice.options.map((o) => o.optionId)).toEqual(['yes', 'no']);
  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with craftRecipes: choosing "yes" consumes the ingredients and grants the result item', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(makeCraftRoomContent());

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_016' }, { id: 'item_017' });
  player.actionPoints = 1;

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  const pendingChoice = await pendingChoicePromise;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'yes' }, resolve);
  });
  await effectResolvedPromise;

  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_021' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with craftRecipes: choosing "no" keeps the ingredients and does not refund the spent action point', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(makeCraftRoomContent());

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_016' }, { id: 'item_017' });
  player.actionPoints = 1;

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  const pendingChoice = await pendingChoicePromise;

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'no' }, resolve);
  });
  await updatePromise;

  const finalPlayer = getPlayer(gameState, currentPlayerId);
  expect(finalPlayer.inventory).toEqual([{ id: 'item_016' }, { id: 'item_017' }]);
  expect(finalPlayer.actionPoints).toBe(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with craftRecipes: missing an ingredient throws MISSING_CRAFT_MATERIALS without spending an action point', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(makeCraftRoomContent());

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_016' }); // missing item_017
  player.actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBe('MISSING_CRAFT_MATERIALS');
  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(1);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('drawing an omen card increments omenCount and broadcasts a haunt check', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{ id: 'omen_002', name: '書', effects: [{ type: 'stat_change', stat: 'knowledge', delta: 1 }] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const hauntCheckPromise = new Promise((resolve) => currentClient.once('game:hauntCheck', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const hauntCheck = await hauntCheckPromise;
  expect(hauntCheck.omenCount).toBe(1);
  expect(typeof hauntCheck.rollSum).toBe('number');

  const gameState = getGameState(gameManager, roomCode);
  expect(gameState.omenCount).toBe(1);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a haunt check summing over 5 sets hauntStarted and broadcasts game:hauntStarted', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{ id: 'omen_001', name: '測試預兆', effects: [] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  gameState.omenCount = 2; // this draw brings it to 3 -> 3 dice rolled

  // Force every die to roll its maximum face (2): 3 dice * 2 = 6 > 5, guaranteed trigger.
  jest.spyOn(Math, 'random').mockReturnValue(0.99);

  const hauntStartedPromise = new Promise((resolve) => currentClient.once('game:hauntStarted', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const hauntStarted = await hauntStartedPromise;
  expect(hauntStarted.omenCount).toBe(3);
  expect(hauntStarted.rollSum).toBe(6);
  expect(gameState.hauntStarted).toBe(true);

  jest.restoreAllMocks();
  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a haunt check that does not exceed 5 does not set hauntStarted', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{ id: 'omen_001', name: '測試預兆', effects: [] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  // Force every die to roll its minimum face (0): omenCount=1 -> 1 die -> sum 0, well under 5.
  jest.spyOn(Math, 'random').mockReturnValue(0);

  let hauntStartedFired = false;
  currentClient.on('game:hauntStarted', () => {
    hauntStartedFired = true;
  });

  const hauntCheckPromise = new Promise((resolve) => currentClient.once('game:hauntCheck', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const hauntCheck = await hauntCheckPromise;

  expect(hauntCheck.rollSum).toBe(0);
  expect(hauntStartedFired).toBe(false);
  const gameState = getGameState(gameManager, roomCode);
  expect(gameState.hauntStarted).toBe(false);

  jest.restoreAllMocks();
  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: a consumable item resolved via a pending choice is removed after the choice applies', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_020',
        name: '測試選擇型消耗品',
        effects: [{
          type: 'choice',
          description: '選擇效果',
          options: [
            { optionId: 'opt_apply', label: '套用', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_apply',
        }],
        category: 'consumable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_020' });

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  const selectResult = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_020' }, resolve));
  expect(selectResult.error).toBeUndefined();
  const pendingChoice = await pendingChoicePromise;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const respondResult = await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_apply' }, resolve);
  });
  expect(respondResult.error).toBeUndefined();

  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.sourceId).toBe('item_020');
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([]); // consumed after the choice actually applied

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: a consumable item whose choice effect also removes itself does not break the async resolution path (double-removal guard)', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_021',
        name: '測試自我移除消耗品',
        effects: [{
          type: 'choice',
          description: '選擇效果',
          options: [
            { optionId: 'opt_remove', label: '移除', effects: [{ type: 'lose_item', itemId: 'item_021' }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_remove',
        }],
        category: 'consumable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_021' });

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_021' }, resolve));
  const pendingChoice = await pendingChoicePromise;

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const respondResult = await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_remove' }, resolve);
  });
  // The item's own effect already removed it; consumeItemIfApplied's follow-up
  // removeItem call must not throw and must not skip turn-advancement/broadcast
  // (see M2c-4/M2c-5 independent review, Important #1).
  expect(respondResult.error).toBeUndefined();
  await updatePromise; // game:stateUpdate must still fire after the choice resolves
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([]); // removed exactly once, no crash

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: a draw_card effect privately notifies only the drawing player via game:cardsDrawn', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_030',
        name: '測試魔術方塊',
        effects: [{
          type: 'dice_check',
          diceCount: 1,
          tiers: [
            { min: 2, max: 2, effects: [{ type: 'draw_card', deck: 'item', count: 1 }] },
            { min: 0, max: 1, effects: [] },
          ],
        }],
        category: 'consumable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_030' });

  let otherClientReceivedCardsDrawn = false;
  otherClient.on('game:cardsDrawn', () => {
    otherClientReceivedCardsDrawn = true;
  });

  jest.spyOn(Math, 'random').mockReturnValue(0.99); // force the die's max face (2) -> hits the success tier

  const cardsDrawnPromise = new Promise((resolve) => currentClient.once('game:cardsDrawn', resolve));
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_030' }, resolve));
  await effectResolvedPromise;

  const cardsDrawn = await cardsDrawnPromise;
  expect(cardsDrawn.cards).toEqual([{ id: 'item_030', name: '測試魔術方塊' }]);
  expect(otherClientReceivedCardsDrawn).toBe(false);

  jest.restoreAllMocks();
  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into a room whose event card draws an item card privately notifies only the mover via game:cardsDrawn', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{ id: 'event_099', name: '測試抽卡事件', effects: [{ type: 'draw_card', deck: 'item', count: 1 }] }],
      items: [{ id: 'item_040', name: '測試抽到的道具', effects: [] }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient } = await setUpStartedGameWithContent(content);

  let otherClientReceivedCardsDrawn = false;
  otherClient.on('game:cardsDrawn', () => {
    otherClientReceivedCardsDrawn = true;
  });

  const cardsDrawnPromise = new Promise((resolve) => currentClient.once('game:cardsDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const cardsDrawn = await cardsDrawnPromise;
  expect(cardsDrawn.cards).toEqual([{ id: 'item_040', name: '測試抽到的道具' }]);
  expect(otherClientReceivedCardsDrawn).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('drawing an omen card adds the omen itself to the player inventory, like an item', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{ id: 'omen_002', name: '書', effects: [{ type: 'stat_change', stat: 'knowledge', delta: 1 }] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const gameState = getGameState(gameManager, roomCode);
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'omen_002' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: also finds items among held omens, not just content.cards.items', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [],
      omens: [{ id: 'omen_003', name: '水晶球', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'omen_003' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_003' }, resolve));
  expect(result.error).toBeUndefined();
  await effectResolvedPromise;

  expect(getPlayer(gameState, currentPlayerId).stats.might.currentIndex).toBe(3); // baseIndex 2 + 1

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('resolving an effect that grants item_010 clears a holdsItem modifier on the player (e.g. 電池耗盡 + 蠟燭)', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_099',
        name: '測試授予蠟燭道具',
        effects: [{ type: 'grant_item', itemId: 'item_010' }],
        category: 'general',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_099' });
  attachModifier(player, {
    effects: [{ hookType: 'blocksOpenDoor' }],
    removeWhen: [{ type: 'meetsAnotherPlayer' }, { type: 'holdsItem', itemId: 'item_010' }],
  });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_099' }, resolve));
  await effectResolvedPromise;

  expect(player.modifiers).toEqual([]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into a room with another player clears a meetsAnotherPlayer modifier on the mover (e.g. 電池耗盡)', async () => {
  const content = makeContent({ rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }] });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;

  const gameState = getGameState(gameManager, roomCode);
  const currentPlayer = getPlayer(gameState, currentPlayerId);
  const otherPlayer = getPlayer(gameState, otherPlayerId);

  // Pre-place an explored room east of the player's starting room (room_lobby_a,
  // 0,1) and put the other player there so the mover "meets" them on arrival.
  gameState.board.ground.set('1,1', { roomId: 'room_manual', x: 1, y: 1, doorSides: ['north', 'east', 'south', 'west'] });
  otherPlayer.floor = 'ground';
  otherPlayer.x = 1;
  otherPlayer.y = 1;

  attachModifier(currentPlayer, {
    effects: [{ hookType: 'blocksOpenDoor' }],
    removeWhen: [{ type: 'meetsAnotherPlayer' }, { type: 'holdsItem', itemId: 'item_010' }],
  });

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  expect(currentPlayer.modifiers).toEqual([]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item mode:give transfers an item to a same-room player via socket', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGame();
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  gameState.currentPhase = 'player_interact';
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' });

  const result = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003', mode: 'give', targetPlayerId: otherPlayerId }, resolve)
  );
  expect(result.error).toBeUndefined();
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([]);
  expect(getPlayer(gameState, otherPlayerId).inventory).toEqual([{ id: 'item_003' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item mode:give rejects an imprint-category card even if the client omits itemCategory', async () => {
  const content = makeContent({
    cards: { events: [], items: [], omens: [{ id: 'omen_002', name: '古書', category: 'imprint', effects: [] }] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  gameState.currentPhase = 'player_interact';
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'omen_002' });

  const result = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_002', mode: 'give', targetPlayerId: otherPlayerId }, resolve)
  );

  expect(result.error).toBe('IMPRINT_CANNOT_BE_GIVEN');
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'omen_002' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item mode:leave then mode:pickup round-trips an item through a room\'s droppedItems', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' });

  const leaveResult = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003', mode: 'leave' }, resolve)
  );
  expect(leaveResult.error).toBeUndefined();
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([]);

  const pickupResult = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003', mode: 'pickup' }, resolve)
  );
  expect(pickupResult.error).toBeUndefined();
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_003' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('drawing an activatedOnUse omen adds it to inventory without resolving its effects', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [], items: [],
      omens: [{
        id: 'omen_004',
        name: '犬靈',
        effects: [{ type: 'switch_control', summonType: 'spiritDog', actionPoints: 6 }],
        activatedOnUse: true,
      }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  const drawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const drawn = await drawnPromise;

  expect(drawn.cardId).toBe('omen_004');
  expect(player.inventory).toEqual([{ id: 'omen_004' }]);
  // The card says "當玩家使用..." -- drawing it must NOT seize control of a summon.
  expect(player.summons).toBeFalsy();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('an activatedOnUse omen resolves its effects only when the player later uses it via game:selectAction', async () => {
  const content = makeContent({
    cards: {
      events: [], items: [],
      omens: [{
        id: 'omen_004',
        name: '犬靈',
        effects: [{ type: 'switch_control', summonType: 'spiritDog', actionPoints: 6 }],
        activatedOnUse: true,
      }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_004' });
  expect(player.summons).toBeFalsy();

  const result = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve)
  );
  expect(result.error).toBeUndefined();
  expect(player.summons).toBeTruthy();
  expect(player.summons.type).toBe('spiritDog');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a player controlling a summon moves the summon via game:move, leaving the player\'s own position untouched', async () => {
  const content = makeContent({
    cards: {
      events: [], items: [],
      omens: [{ id: 'omen_004', name: '犬靈', effects: [{ type: 'switch_control', summonType: 'spiritDog', actionPoints: 6 }] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_004' });
  gameState.board.ground.set('-1,1', { roomId: 'room_manual', x: -1, y: 1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [] });

  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve));
  expect(player.summons).toBeTruthy();
  const playerX = player.x;
  const playerY = player.y;

  const moveResult = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'west' }, resolve));
  expect(moveResult.error).toBeUndefined();
  expect(player.summons.x).toBe(-1);
  expect(player.summons.y).toBe(1);
  expect(player.x).toBe(playerX); // player's own position frozen
  expect(player.y).toBe(playerY);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction actionType:dissipate clears the summon and does not end the turn by itself', async () => {
  const content = makeContent({
    cards: {
      events: [], items: [],
      omens: [{ id: 'omen_004', name: '犬靈', effects: [{ type: 'switch_control', summonType: 'spiritDog', actionPoints: 6 }] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_004' });

  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve));
  expect(player.summons).toBeTruthy();
  const apBeforeDissipate = player.actionPoints;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'dissipate' }, resolve));
  expect(result.error).toBeUndefined();
  expect(player.summons).toBeNull();
  // Dissipating is a pure state switch -- it must not itself spend the
  // player's own action points or force the turn to end.
  expect(player.actionPoints).toBe(apBeforeDissipate);
  expect(gameState.turnOrder[gameState.currentPlayerIndex]).toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
});

function makeDiceInterjectionContent(overrides = {}) {
  return makeContent({
    cards: {
      events: [], omens: [],
      items: [
        {
          id: 'item_003',
          name: '測試道具',
          effects: [{
            type: 'dice_check',
            diceCount: 2,
            tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
          }],
          category: 'general',
        },
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }], consumesItem: false },
        },
      ],
    },
    ...overrides,
  });
}

test('game:selectAction item: a dice_check with an eligible held item broadcasts game:diceChoicePending instead of resolving immediately', async () => {
  const content = makeDiceInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const pending = await pendingPromise;
  expect(pending.playerId).toBe(currentPlayerId);
  expect(pending.options).toEqual([{ itemId: 'item_006', name: '詭異人偶', diceInterjection: content.cards.items.find((i) => i.id === 'item_006').diceInterjection }]);
  expect(typeof pending.promptId).toBe('string');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond with an item optionId applies its cost/bonus and resolves the original dice_check', async () => {
  const content = makeDiceInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const pending = await pendingPromise;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_006' }, resolve)
  );
  expect(respondResult.error).toBeUndefined();
  await effectResolvedPromise;

  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex - 1); // cost applied
  expect(player.diceInterjectionUsedThisTurn).toEqual(['item_006']);
  expect(player.inventory).toEqual([{ id: 'item_003' }, { id: 'item_006' }]); // non-consumable, still held

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond with optionId:"__skip__" resolves the dice_check with no bonus', async () => {
  const content = makeDiceInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const pending = await pendingPromise;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: '__skip__' }, resolve));
  await effectResolvedPromise;

  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex); // no cost -- item never used
  expect(player.diceInterjectionUsedThisTurn || []).toEqual([]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond rejects an optionId that isn\'t one of the offered options', async () => {
  const content = makeDiceInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const pending = await pendingPromise;

  const result = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'not_a_real_item' }, resolve)
  );
  expect(result.error).toBe('INVALID_PROMPT_OPTION');

  clientA.close();
  clientB.close();
  httpServer.close();
});

function makeOverrideInterjectionContent() {
  return makeContent({
    cards: {
      events: [], omens: [],
      items: [
        {
          id: 'item_003',
          name: '測試道具',
          effects: [{
            type: 'dice_check',
            diceCount: 2,
            tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
          }],
          category: 'general',
        },
        {
          id: 'item_005',
          name: '天使羽毛',
          diceInterjection: { scope: 'any', override: true, consumesItem: true },
        },
      ],
    },
  });
}

test('game:diceChoiceRespond with an override interjection item auto-substitutes the max roll -- no overrideValue needed or accepted', async () => {
  const content = makeOverrideInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_003' }, { id: 'item_005' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const pending = await pendingPromise;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_005' }, resolve)
  );
  expect(respondResult.error).toBeUndefined();
  await effectResolvedPromise;

  // item_003's dice_check has one wide 0-8 tier, so any roll matches it --
  // this test's point is that the response succeeds and the item is consumed
  // without the client ever sending an overrideValue.
  expect(player.inventory).toEqual([{ id: 'item_003' }]);
  expect(getResolver(effectResolverManager, roomCode).pendingRollChoice).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('opening a roll choice clears any pendingChoice left on the room entry', async () => {
  // A choice effect whose chosen option contains a dice_check: handleEffectResolveResult
  // takes the rollChoice branch before it would have nulled pendingChoice, so the entry
  // would otherwise hold both a pendingChoice and a pendingRollChoice at once.
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        {
          id: 'item_007',
          name: '巢狀選擇道具',
          category: 'general',
          effects: [{
            type: 'choice',
            description: '選一個',
            options: [{
              optionId: 'opt_roll',
              label: '擲骰',
              effects: [{
                type: 'dice_check',
                diceCount: 2,
                tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
              }],
            }],
            timeoutMs: 20000,
            defaultOptionId: 'opt_roll',
          }],
        },
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [], consumesItem: false },
        },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_007' }, { id: 'item_006' });

  const effectChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_007' }, resolve));
  const effectChoice = await effectChoicePromise;
  expect(getResolver(effectResolverManager, roomCode).pendingChoice).not.toBeNull();

  const rollPendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:effectPromptRespond', { promptId: effectChoice.promptId, optionId: 'opt_roll' }, resolve)
  );
  await rollPendingPromise;

  const entry = getResolver(effectResolverManager, roomCode);
  expect(entry.pendingRollChoice).not.toBeNull();
  expect(entry.pendingChoice).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond rejects when there is no active roll choice', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();
  const result = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: 'not_real', optionId: '__skip__' }, resolve)
  );
  expect(result.error).toBe('NO_ACTIVE_ROLL_CHOICE');
  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a grant_item effect that pushes the player over the item cap opens a pendingInventoryChoice and blocks game:endTurn', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        {
          id: 'item_104',
          name: '會送人道具的卡',
          category: 'consumable',
          effects: [{ type: 'grant_item', itemId: 'item_999' }],
        },
        { id: 'item_999', name: '第四件道具' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' }, { id: 'item_104' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104' }, resolve)
  );
  expect(ack.error).toBeUndefined();
  const pending = await pendingPromise;
  expect(pending.playerId).toBe(currentPlayerId);
  expect(pending.itemIds.sort()).toEqual(['item_101', 'item_102', 'item_103', 'item_999'].sort());

  const entry = getResolver(effectResolverManager, roomCode);
  expect(entry.pendingInventoryChoice).not.toBeNull();
  expect(entry.pendingInventoryChoice.triggeredByItemId).toBe('item_999');

  const blocked = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(blocked.error).toBe('INVENTORY_CHOICE_IN_PROGRESS');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('holding exactly the cap does not open a pendingInventoryChoice', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        {
          id: 'item_104',
          name: '會送人道具的卡',
          category: 'consumable',
          effects: [{ type: 'grant_item', itemId: 'item_999' }],
        },
        { id: 'item_999', name: '第三件道具' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_104' });

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104' }, resolve)
  );
  expect(ack.error).toBeUndefined();
  await resolvedPromise;

  const entry = getResolver(effectResolverManager, roomCode);
  expect(entry.pendingInventoryChoice).toBeNull(); // 剛好等於上限（might=3），不觸發

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a pending roll choice blocks game:move/game:selectAction/game:endTurn/game:useStairs with ROLL_CHOICE_IN_PROGRESS', async () => {
  const content = makeDiceInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  await pendingPromise;

  const moveResult = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(moveResult.error).toBe('ROLL_CHOICE_IN_PROGRESS');
  const selectActionResult = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'attack' }, resolve));
  expect(selectActionResult.error).toBe('ROLL_CHOICE_IN_PROGRESS');
  const endTurnResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endTurnResult.error).toBe('ROLL_CHOICE_IN_PROGRESS');
  const useStairsResult = await new Promise((resolve) => currentClient.emit('game:useStairs', {}, resolve));
  expect(useStairsResult.error).toBe('ROLL_CHOICE_IN_PROGRESS');

  clientA.close();
  clientB.close();
  httpServer.close();
}, 3000);

test('a pending inventory choice blocks game:move/game:selectAction/game:endTurn/game:useStairs with INVENTORY_CHOICE_IN_PROGRESS', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        {
          id: 'item_104',
          name: '會送人道具的卡',
          category: 'consumable',
          effects: [{ type: 'grant_item', itemId: 'item_999' }],
        },
        { id: 'item_999', name: '第四件道具' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' }, { id: 'item_104' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104' }, resolve)
  );
  expect(ack.error).toBeUndefined();
  await pendingPromise;

  const moveResult = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(moveResult.error).toBe('INVENTORY_CHOICE_IN_PROGRESS');
  const selectActionResult = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'attack' }, resolve));
  expect(selectActionResult.error).toBe('INVENTORY_CHOICE_IN_PROGRESS');
  const useStairsResult = await new Promise((resolve) => currentClient.emit('game:useStairs', {}, resolve));
  expect(useStairsResult.error).toBe('INVENTORY_CHOICE_IN_PROGRESS');
  const endTurnResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endTurnResult.error).toBe('INVENTORY_CHOICE_IN_PROGRESS');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a roll choice that times out resolves with no item used (default skip)', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        {
          id: 'item_003',
          name: '測試道具',
          effects: [{
            type: 'dice_check',
            diceCount: 2,
            tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
          }],
          category: 'general',
        },
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }], consumesItem: false },
        },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content, { rollChoiceTimeoutMs: 50 });
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  await pendingPromise;

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await resolvedPromise;
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex); // timed out -- no item used, no cost

  clientA.close();
  clientB.close();
  httpServer.close();
}, 2000);

test('picking up a dropped item that pushes the player over the cap opens a pendingInventoryChoice', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        { id: 'item_104', name: '道具四' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' });
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push({ id: 'item_104' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104', mode: 'pickup' }, resolve)
  );
  expect(ack.error).toBeUndefined();
  const pending = await pendingPromise;
  expect(pending.playerId).toBe(currentPlayerId);

  const entry = getResolver(effectResolverManager, roomCode);
  expect(entry.pendingInventoryChoice.triggeredByItemId).toBe('item_104');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item mode:wield resolves itemCategory from content and sets wieldedWeaponId', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [{ id: 'item_101', name: '短劍', category: 'weapon' }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' });

  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_101', mode: 'wield' }, resolve)
  );
  expect(ack.error).toBeUndefined();
  expect(player.wieldedWeaponId).toBe('item_101');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item mode:wear on a non-gear item is rejected with INVALID_ITEM_CATEGORY', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [{ id: 'item_101', name: '短劍', category: 'weapon' }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' });

  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_101', mode: 'wear' }, resolve)
  );
  expect(ack.error).toBe('INVALID_ITEM_CATEGORY');
  expect(player.wornGearIds).toEqual([]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:inventoryChoiceRespond leaves the chosen item in the room and clears the pending state', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        { id: 'item_104', name: '道具四' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' });
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push({ id: 'item_104' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104', mode: 'pickup' }, resolve)
  );
  const pending = await pendingPromise;

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  const respondAck = await new Promise((resolve) =>
    currentClient.emit('game:inventoryChoiceRespond', { promptId: pending.promptId, optionId: 'item_101' }, resolve)
  );
  expect(respondAck.error).toBeUndefined();
  await resolvedPromise;

  expect(player.inventory.map((i) => i.id).sort()).toEqual(['item_102', 'item_103', 'item_104'].sort());
  expect(room.droppedItems).toEqual([{ id: 'item_101' }]);
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice).toBeNull();

  // 已經解決，接下來的動作不應該再被擋
  const endTurnAck = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endTurnAck.error).toBeUndefined();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:inventoryChoiceRespond clears wieldedWeaponId when the forced-left item was wielded', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        { id: 'item_104', name: '道具四' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' });
  player.wieldedWeaponId = 'item_101';
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push({ id: 'item_104' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104', mode: 'pickup' }, resolve)
  );
  const pending = await pendingPromise;

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:inventoryChoiceRespond', { promptId: pending.promptId, optionId: 'item_101' }, resolve)
  );
  await resolvedPromise;

  expect(player.wieldedWeaponId).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:inventoryChoiceRespond opens a second round when still over the cap after leaving one item', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        {
          id: 'item_201',
          name: '一次抽兩張的卡',
          effects: [{ type: 'draw_card', deck: 'item', count: 2 }],
          category: 'consumable',
        },
        { id: 'item_301', name: '被抽到的道具A' },
        { id: 'item_302', name: '被抽到的道具B' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' }, { id: 'item_201' });
  gameState.itemDeck.cards = [{ id: 'item_301', name: '被抽到的道具A' }, { id: 'item_302', name: '被抽到的道具B' }];

  const firstPendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_201' }, resolve)
  );
  const firstPending = await firstPendingPromise;
  // might 上限 3、目前持有 5 件（101/102/103/301/302）-> 觸發，逾時預設會是 item_302（最後抽到的）
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice.triggeredByItemId).toBe('item_302');

  const secondPendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:inventoryChoiceRespond', { promptId: firstPending.promptId, optionId: 'item_101' }, resolve)
  );
  const secondPending = await secondPendingPromise;
  // 還是超過上限(4件) -> 開第二輪，這次逾時預設沿用 newlyAcquiredItemIds 找仍持有的最後一件 -> 還是 item_302（還沒被選走）
  expect(secondPending.itemIds.sort()).toEqual(['item_102', 'item_103', 'item_301', 'item_302'].sort());
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice.triggeredByItemId).toBe('item_302');

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:inventoryChoiceRespond', { promptId: secondPending.promptId, optionId: 'item_302' }, resolve)
  );
  await resolvedPromise;

  expect(player.inventory.map((i) => i.id).sort()).toEqual(['item_102', 'item_103', 'item_301'].sort());
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a timed-out inventory choice auto-leaves the triggering item and does not affect the player\'s other items', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        { id: 'item_104', name: '道具四' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content, { inventoryChoiceTimeoutMs: 50 });
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' });
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push({ id: 'item_104' });

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104', mode: 'pickup' }, resolve)
  );
  const resolved = await resolvedPromise;
  expect(resolved.wasTimeout).toBe(true);
  expect(resolved.chosenOptionId).toBe('item_104');

  expect(player.inventory.map((i) => i.id).sort()).toEqual(['item_101', 'item_102', 'item_103'].sort());
  expect(room.droppedItems).toEqual([{ id: 'item_104' }]);
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
}, 5000);

test('game:move into event_031 (紅藍藥丸) opens a red/blue/give-up choice, and give_up still triggers the 50/50 sanity swing', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_031',
        name: '紅藍藥丸',
        effects: [{
          type: 'choice',
          description: '紅色藥丸還是藍色藥丸？',
          timeoutMs: 20000,
          defaultOptionId: 'give_up',
          options: [
            { optionId: 'red', label: '紅色', effects: [{ type: 'random_effect', options: [{ effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] }, { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] }] }] },
            { optionId: 'blue', label: '藍色', effects: [{ type: 'random_effect', options: [{ effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] }, { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] }] }] },
            { optionId: 'give_up', label: '放棄', effects: [{ type: 'random_effect', options: [{ effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] }, { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] }] }] },
          ],
        }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  expect(pendingChoice.options.map((o) => o.optionId)).toEqual(['red', 'blue', 'give_up']);

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // random_effect index 0 -> sanity +1
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'give_up' }, resolve);
  });
  await effectResolvedPromise;
  const update = await updatePromise;
  rngSpy.mockRestore();

  const me = update.players.find((p) => p.playerId === currentPlayerId);
  expect(me.stats.sanity.currentIndex).toBe(me.stats.sanity.baseIndex + 1); // give_up still triggered the 50/50, landed on +1

  clientA.close();
  clientB.close();
  httpServer.close();
});
