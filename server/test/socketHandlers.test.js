const ioClient = require('socket.io-client');
const { createServer } = require('../src/createServer');
const { LobbyManager } = require('../src/lobbyManager');
const { registerSocketHandlers } = require('../src/socketHandlers');
const { createGameManager } = require('../src/game/gameManager');
const { createCharacterSelectionManager } = require('../src/game/characterSelectionManager');
const { createEffectResolverManager } = require('../src/game/effectResolverManager');
const { getGameState } = require('../src/game/gameManager');
const { getPlayer } = require('../src/game/gameState');
const { attachModifier } = require('../src/game/modifiers');

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

test('game:move to open a door places a room, zeroes AP, and broadcasts game:stateUpdate', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => {
    currentClient.emit('game:move', { direction: 'east' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('open_door');

  const update = await updatePromise;
  const movedPlayer = update.players.find((p) => p.x === 1 && p.y === 0);
  expect(movedPlayer).toBeTruthy();
  expect(movedPlayer.actionPoints).toBe(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move applies a room\'s leaveCheck before allowing the player to move out, blocking on a failed roll', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_entrance_hall', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_foyer', name: '廊廳', floor: 'ground' },
      { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
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

test('game:move rejects a caller who is not the current turn player', async () => {
  const { httpServer, clientA, clientB, otherClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    otherClient.emit('game:move', { direction: 'east' }, resolve);
  });
  expect(result.error).toBe('NOT_YOUR_TURN');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction spends 1 action point, broadcasts game:pendingAction, and updates state', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

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

test('game:endTurn advances the turn even when the current player still has unspent action points', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGame();

  const updatePromise = new Promise((resolve) => otherClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBeUndefined();
  expect(result.nextPlayerId).not.toBe(currentPlayerId);

  const update = await updatePromise;
  expect(update.turnOrder[update.currentPlayerIndex]).not.toBe(currentPlayerId);
  const newCurrentPlayer = update.players.find((p) => p.playerId === update.turnOrder[update.currentPlayerIndex]);
  expect(newCurrentPlayer.actionPoints).toBeGreaterThan(0); // reset by advanceTurn

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn rejects a caller who is not the current turn player', async () => {
  const { httpServer, clientA, clientB, otherClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBe('NOT_YOUR_TURN');

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
      { id: 'room_entrance_hall', name: '大門廳', floor: 'ground', effects: [{ type: 'stat_change', stat: 'sanity', delta: 1, onceOnlyPerPlayer: true }] },
      { id: 'room_foyer', name: '廊廳', floor: 'ground' },
      { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  const baseSanity = player.stats.sanity.currentIndex;

  const result = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBeUndefined();
  expect(player.stats.sanity.currentIndex).toBe(baseSanity + 1);
  expect(player.roomBonusesReceived).toEqual(['room_entrance_hall']);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn does not re-apply a room\'s onceOnlyPerPlayer bonus once the player has already received it', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_entrance_hall', name: '大門廳', floor: 'ground', effects: [{ type: 'stat_change', stat: 'sanity', delta: 1, onceOnlyPerPlayer: true }] },
      { id: 'room_foyer', name: '廊廳', floor: 'ground' },
      { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex + 1);

  // Cycle back around to the same player without moving them, then end turn again.
  await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex + 1); // unchanged
  expect(player.roomBonusesReceived).toEqual(['room_entrance_hall']); // not duplicated

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('when a move exhausts action points, the turn does not auto-advance -- game:endTurn is required', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGame();

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // zeroes AP
  const update = await updatePromise;

  // AP is zero, but the turn must stay with the same player until they
  // explicitly end it -- see Task 5's manual-end-turn mechanism.
  expect(update.turnOrder[update.currentPlayerIndex]).toBe(currentPlayerId);
  const me = update.players.find((p) => p.playerId === currentPlayerId);
  expect(me.actionPoints).toBe(0);

  // otherClient may still have an unconsumed copy of the stateUpdate broadcast
  // from the move above sitting in its event queue -- a plain .once() here could
  // catch that stale broadcast instead of the one from game:endTurn (same race
  // class as setUpStartedGame's game:promptResolved handling above). Use a
  // persistent, filtered listener instead so a stale event is ignored.
  const nextUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);
  const newCurrentPlayer = nextUpdate.players.find((p) => p.playerId === nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]);
  expect(newCurrentPlayer.actionPoints).toBeGreaterThan(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into a room with a populated item deck draws a card and resolves its non-choice effects', async () => {
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
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.deckType).toBe('item');
  expect(cardDrawn.cardId).toBe('item_001');

  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.sourceId).toBe('item_001');

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
  const { httpServer, port, gameManager } = await startTestServer(content, options);
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

test('resolving a pending effect choice does not by itself advance the turn -- game:endTurn is still required', async () => {
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
  expect(respondedUpdate.turnOrder[respondedUpdate.currentPlayerIndex]).toBe(currentPlayerId);

  // The choice is resolved now, so EFFECT_CHOICE_IN_PROGRESS no longer blocks
  // game:endTurn -- proves resolving the choice actually cleared the gate.
  // (Persistent filtered listener, not .once() -- see the race-class comment
  // on the first game:endTurn test above.)
  const nextUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a pending effect choice that times out still requires game:endTurn to advance the turn', async () => {
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
  expect(timedOutUpdate.turnOrder[timedOutUpdate.currentPlayerIndex]).toBe(currentPlayerId);

  // Persistent filtered listener, not .once() -- see the race-class comment on
  // the first game:endTurn test above.
  const nextUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

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

test('game:move into a room with an unknown drawType does not crash the room, and the turn still ends normally via game:endTurn', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'unknown_deck_type' }],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(result.error).toBeUndefined(); // moveToRoom itself succeeded

  const update = await updatePromise;
  // Despite the resolveCardDraw failure (UNKNOWN_DECK_TYPE), the room stays in
  // sync and nothing crashes -- see M2c-2 final review Important I3. The turn
  // itself no longer auto-advances (Task 5), so confirm it's still endable.
  expect(update.turnOrder[update.currentPlayerIndex]).toBe(currentPlayerId);

  // Persistent filtered listener, not .once() -- see the race-class comment on
  // the first game:endTurn test above.
  const nextUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

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
test('an event-deck card requiring a choice defers the turn the same way an item-deck card does', async () => {
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
  expect(firstUpdate.turnOrder[firstUpdate.currentPlayerIndex]).toBe(currentPlayerId);

  const blockedMove = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'north' }, resolve));
  expect(blockedMove.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });

  // Persistent filtered listener, not .once() -- see the race-class comment on
  // the first game:endTurn test above.
  const advancedUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const advancedUpdate = await advancedUpdatePromise;
  expect(advancedUpdate.turnOrder[advancedUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('an omen-deck card requiring a choice defers the turn the same way an item-deck card does', async () => {
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
  expect(firstUpdate.turnOrder[firstUpdate.currentPlayerIndex]).toBe(currentPlayerId);

  const blockedSelectAction = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item' }, resolve));
  expect(blockedSelectAction.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });

  // Persistent filtered listener, not .once() -- see the race-class comment on
  // the first game:endTurn test above.
  const advancedUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const advancedUpdate = await advancedUpdatePromise;
  expect(advancedUpdate.turnOrder[advancedUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

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

test('game:selectAction room_action: resolves the current room\'s effects', async () => {
  const content = makeContent({
    rooms: [{
      id: 'room_new',
      doors: 4,
      floor: 'ground',
      effects: [{ type: 'stat_change', stat: 'might', delta: 1 }],
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

test('game:selectAction room_action: throws NO_ROOM_ACTION_AVAILABLE when the current room has no effects', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();
  // Default starting room (entrance hall) has no `effects` field.

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBe('NO_ROOM_ACTION_AVAILABLE');

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

  // Pre-place an explored room east of the entrance hall (0,0) and put the
  // other player there so the mover "meets" them on arrival.
  gameState.board.ground.set('1,0', { roomId: 'room_manual', x: 1, y: 0, doorSides: ['north', 'east', 'south', 'west'] });
  otherPlayer.floor = 'ground';
  otherPlayer.x = 1;
  otherPlayer.y = 0;

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
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [] });

  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve));
  expect(player.summons).toBeTruthy();
  const playerX = player.x;
  const playerY = player.y;

  const moveResult = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'north' }, resolve));
  expect(moveResult.error).toBeUndefined();
  expect(player.summons.x).toBe(0);
  expect(player.summons.y).toBe(-1);
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
