const {
  startSelection,
  getSelection: getCharacterSelection,
  endSelection,
} = require('./game/characterSelectionManager');
const {
  getCurrentPicker,
  getAvailableCharacterIds,
  confirmCharacterChoice,
  assignRandomCharacter,
  isCharacterSelectionComplete,
  getAssignments,
} = require('./game/characterSelection');
const { createPrompt, respondToPrompt, resolvePromptTimeout } = require('./game/promptState');
const { startGame, getGameState } = require('./game/gameManager');
const { serializeGameState } = require('./game/gameState');

const DEFAULT_CHARACTER_SELECT_TIMEOUT_MS = 30000;
const characterSelectTimeouts = new Map(); // roomCode -> Timeout handle

function registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, content, options = {}) {
  const characterSelectTimeoutMs = options.characterSelectTimeoutMs || DEFAULT_CHARACTER_SELECT_TIMEOUT_MS;

  io.on('connection', (socket) => {
    socket.on('lobby:create', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { playerName } = payload || {};
        if (socket.data.roomCode) {
          return ack({ error: 'ALREADY_IN_ROOM' });
        }
        const { roomCode, playerId } = lobbyManager.createRoom(playerName, socket.id);
        socket.data.roomCode = roomCode;
        socket.data.playerId = playerId;
        socket.join(roomCode);
        ack({ roomCode, playerId });
        broadcastPlayers(io, lobbyManager, roomCode);
      } catch (err) {
        console.error('lobby:create error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('lobby:join', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerName } = payload || {};
        if (socket.data.roomCode) {
          return ack({ error: 'ALREADY_IN_ROOM' });
        }
        const { playerId } = lobbyManager.joinRoom(roomCode, playerName, socket.id);
        socket.data.roomCode = roomCode;
        socket.data.playerId = playerId;
        socket.join(roomCode);
        ack({ playerId, roomCode });
        broadcastPlayers(io, lobbyManager, roomCode);
      } catch (err) {
        console.error('lobby:join error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:startCharacterSelect', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        if (!lobbyManager.isHost(roomCode, playerId)) {
          return ack({ error: 'NOT_HOST' });
        }
        const players = lobbyManager.getPlayers(roomCode);
        if (players.length < 2) {
          return ack({ error: 'TOO_FEW_PLAYERS' });
        }
        if (players.length > content.characters.length) {
          return ack({ error: 'TOO_MANY_PLAYERS' });
        }
        startSelection(
          characterSelectionManager,
          roomCode,
          players.map((p) => p.playerId),
          content.characters
        );
        ack({});
        advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode, characterSelectTimeoutMs);
      } catch (err) {
        console.error('game:startCharacterSelect error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:promptRespond', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const { promptId, optionId } = payload || {};
        const entry = getCharacterSelection(characterSelectionManager, roomCode);
        if (!entry) {
          return ack({ error: 'NO_ACTIVE_PROMPT' });
        }
        // This handler currently only ever serves character-selection prompts
        // (M2b-2 doesn't add turn-flow prompts yet) — respondToPrompt's own
        // promptId/target-player checks are what actually guard correctness.
        const result = respondToPrompt(entry.promptState, { promptId, playerId, optionId });
        clearCharacterSelectTimeout(roomCode);
        confirmCharacterChoice(entry.characterSelectionState, { playerId, characterId: optionId });
        ack({});
        io.to(roomCode).emit('game:promptResolved', result);
        advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode, characterSelectTimeoutMs);
      } catch (err) {
        console.error('game:promptRespond error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
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

function advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode, characterSelectTimeoutMs) {
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
  if (isCharacterSelectionComplete(entry.characterSelectionState)) {
    finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode);
    return;
  }
  const picker = getCurrentPicker(entry.characterSelectionState);
  const available = getAvailableCharacterIds(entry.characterSelectionState);
  const prompt = createPrompt(entry.promptState, {
    type: 'character_select',
    targetPlayerId: picker,
    description: '請選擇角色',
    options: available,
    timeoutMs: characterSelectTimeoutMs,
    now: Date.now(),
  });
  io.to(roomCode).emit('game:prompt', prompt);
  io.to(roomCode).emit('game:characterSelectUpdate', serializeCharacterSelection(entry.characterSelectionState));
  const handle = setTimeout(() => {
    handleCharacterSelectTimeout(
      io,
      lobbyManager,
      gameManager,
      characterSelectionManager,
      content,
      roomCode,
      prompt.promptId,
      picker,
      characterSelectTimeoutMs
    );
  }, characterSelectTimeoutMs);
  characterSelectTimeouts.set(roomCode, handle);
}

function clearCharacterSelectTimeout(roomCode) {
  const handle = characterSelectTimeouts.get(roomCode);
  if (handle) {
    clearTimeout(handle);
    characterSelectTimeouts.delete(roomCode);
  }
}

function handleCharacterSelectTimeout(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode, promptId, playerId, characterSelectTimeoutMs) {
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
  if (!entry) return;
  characterSelectTimeouts.delete(roomCode);
  const characterId = assignRandomCharacter(entry.characterSelectionState, playerId);
  const result = resolvePromptTimeout(entry.promptState, { promptId, defaultOptionId: characterId });
  if (result) {
    io.to(roomCode).emit('game:promptResolved', result);
  }
  advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode, characterSelectTimeoutMs);
}

function finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode) {
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
  const lobbyPlayers = lobbyManager.getPlayers(roomCode);
  const assignments = getAssignments(entry.characterSelectionState);
  const players = lobbyPlayers.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    characterId: assignments.get(p.playerId),
  }));
  endSelection(characterSelectionManager, roomCode);
  const gameState = startGame(gameManager, roomCode, {
    startingRooms: content.startingRooms,
    rooms: content.rooms,
    characters: content.characters,
    players,
  });
  io.to(roomCode).emit('game:started', serializeGameState(gameState));
}

function serializeCharacterSelection(characterSelectionState) {
  return {
    order: characterSelectionState.order,
    currentPicker: getCurrentPicker(characterSelectionState),
    lockedCharacterIds: Array.from(characterSelectionState.lockedCharacterIds),
    assignments: Array.from(characterSelectionState.assignments.entries()).map(([playerId, characterId]) => ({
      playerId,
      characterId,
    })),
    characters: characterSelectionState.characters,
  };
}

function broadcastPlayers(io, lobbyManager, roomCode) {
  io.to(roomCode).emit('lobby:players', { players: lobbyManager.getPlayers(roomCode) });
}

module.exports = { registerSocketHandlers };
