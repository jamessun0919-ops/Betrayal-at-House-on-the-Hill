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
const { serializeGameState, getPlayer } = require('./game/gameState');
const { moveToRoom, selectAction, useStairs, isTurnOver, advanceTurn } = require('./game/turnFlow');
const { coordKey } = require('./game/boardGenerator');
const { startResolver, getResolver } = require('./game/effectResolverManager');
const { resolveEffects, resolveChoiceOption } = require('./game/effectResolver');
const { hasCards, drawCard } = require('./game/cardDeck');
const { removeItem } = require('./game/playerEntity');

const DEFAULT_CHARACTER_SELECT_TIMEOUT_MS = 30000;

const DECK_FIELD_BY_TYPE = { item: 'itemDeck', event: 'eventDeck', omen: 'omenDeck' };

function registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, options = {}) {
  const characterSelectTimeoutMs = options.characterSelectTimeoutMs || DEFAULT_CHARACTER_SELECT_TIMEOUT_MS;
  const characterSelectTimeouts = new Map(); // roomCode -> Timeout handle
  const effectChoiceTimeouts = new Map(); // roomCode -> Timeout handle

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
        if (getCharacterSelection(characterSelectionManager, roomCode) || getGameState(gameManager, roomCode)) {
          return ack({ error: 'ROOM_IN_PROGRESS' });
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
        if (getGameState(gameManager, roomCode)) {
          return ack({ error: 'GAME_ALREADY_STARTED' });
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
        advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts);
        ack({});
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
        clearCharacterSelectTimeout(roomCode, characterSelectTimeouts);
        confirmCharacterChoice(entry.characterSelectionState, { playerId, characterId: optionId });
        io.to(roomCode).emit('game:promptResolved', result);
        advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts);
        ack({});
      } catch (err) {
        console.error('game:promptRespond error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:move', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        const { direction } = payload || {};
        const result = moveToRoom(gameState, playerId, direction);
        ack(result);
        let stillResolving = false;
        if (result.pendingCardDraw) {
          try {
            const drawOutcome = resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck, effectChoiceTimeouts);
            stillResolving = drawOutcome.pending;
          } catch (drawErr) {
            // A card-effect resolution failure (e.g. malformed content) must not
            // prevent the turn from advancing and the room from staying in sync —
            // see M2c-2 final review, Critical C1.
            console.error('resolveCardDraw error', drawErr);
          }
        }
        if (!stillResolving) {
          advanceTurnIfOver(gameState, playerId);
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:move error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:selectAction', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        const { actionType, itemId, targetPlayerId } = payload || {};
        const selectOptions = { itemId, targetPlayerId };
        let sourceEffects = null;
        let sourceId = null;
        let consumeItemIfApplied = false;

        if (actionType === 'item') {
          const itemContent = content.cards.items.find((i) => i.id === itemId);
          selectOptions.itemCanTargetOthers = Boolean(itemContent && itemContent.canTargetOthers);
          sourceEffects = itemContent ? itemContent.effects : [];
          sourceId = itemId;
          consumeItemIfApplied = Boolean(itemContent && itemContent.category === 'consumable');
        }

        if (actionType === 'room_action') {
          const currentPlayer = getPlayer(gameState, playerId);
          const placedRoom = gameState.board[currentPlayer.floor].get(coordKey(currentPlayer.x, currentPlayer.y));
          const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
          sourceEffects =
            roomDefinition && Array.isArray(roomDefinition.effects) && roomDefinition.effects.length > 0
              ? roomDefinition.effects
              : null;
          selectOptions.hasRoomAction = Boolean(sourceEffects);
          sourceId = placedRoom.roomId;
        }

        const result = selectAction(gameState, playerId, actionType, selectOptions);
        ack(result);

        let stillResolving = false;
        if (sourceEffects) {
          try {
            const resolverEntry = getResolver(effectResolverManager, roomCode);
            const targetForEffects = result.targetPlayerId || playerId;
            const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now() });
            const outcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, targetForEffects, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied);
            stillResolving = outcome.pending;
          } catch (err) {
            console.error('selectAction effect resolution error', err);
          }
        } else if (result.pending) {
          io.to(roomCode).emit('game:pendingAction', { playerId, actionType: result.kind });
        }

        if (!stillResolving) {
          advanceTurnIfOver(gameState, playerId);
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:selectAction error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:useStairs', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        const result = useStairs(gameState, playerId);
        ack(result);
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:useStairs error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:effectPromptRespond', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        const resolverEntry = getResolver(effectResolverManager, roomCode);
        if (!resolverEntry || !resolverEntry.pendingChoice) {
          return ack({ error: 'NO_ACTIVE_EFFECT_CHOICE' });
        }
        const { promptId, optionId } = payload || {};
        const { playerId: choicePlayerId, sourceId, options, consumeItemIfApplied } = resolverEntry.pendingChoice;
        const result = respondToPrompt(resolverEntry.promptState, { promptId, playerId, optionId });
        clearEffectChoiceTimeout(roomCode, effectChoiceTimeouts);
        io.to(roomCode).emit('game:promptResolved', result);
        const chosenEffects = resolveChoiceOption(options, result.chosenOptionId);
        const nextResult = resolveEffects(gameState, resolverEntry.promptState, choicePlayerId, chosenEffects, { now: Date.now() });
        const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, choicePlayerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied);
        if (!resolveOutcome.pending) {
          advanceTurnIfOver(gameState, choicePlayerId);
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
        ack({});
      } catch (err) {
        console.error('game:effectPromptRespond error', err);
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

function advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts) {
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
  if (isCharacterSelectionComplete(entry.characterSelectionState)) {
    finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode);
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
      effectResolverManager,
      content,
      roomCode,
      prompt.promptId,
      picker,
      characterSelectTimeoutMs,
      characterSelectTimeouts
    );
  }, characterSelectTimeoutMs);
  characterSelectTimeouts.set(roomCode, handle);
}

function clearCharacterSelectTimeout(roomCode, characterSelectTimeouts) {
  const handle = characterSelectTimeouts.get(roomCode);
  if (handle) {
    clearTimeout(handle);
    characterSelectTimeouts.delete(roomCode);
  }
}

function advanceTurnIfOver(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (isTurnOver(player)) {
    advanceTurn(gameState);
  }
}

function hasPendingEffectChoice(effectResolverManager, roomCode) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  return Boolean(resolverEntry && resolverEntry.pendingChoice);
}

function findRoomDefinition(content, roomId) {
  return (
    content.rooms.find((r) => r.id === roomId) ||
    content.startingRooms.find((r) => r.id === roomId)
  );
}

function resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, deckType, effectChoiceTimeouts) {
  const deckField = DECK_FIELD_BY_TYPE[deckType];
  if (!deckField) {
    throw new Error('UNKNOWN_DECK_TYPE');
  }
  const deck = gameState[deckField];
  if (!hasCards(deck)) {
    return { pending: false };
  }
  const card = drawCard(deck);
  io.to(roomCode).emit('game:cardDrawn', { playerId, deckType, cardId: card.id, cardName: card.name });
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, { now: Date.now() });
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, card.id, effectResult, effectChoiceTimeouts);
}

// Returns {pending: boolean} so callers know whether the turn should advance
// now or wait until the choice this call may have just opened gets resolved
// (see M2c-2 final review, Critical C1: advancing the turn while a choice is
// still pending let a second card draw collide with the first).
function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied = false) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending) {
    resolverEntry.pendingChoice = {
      promptId: effectResult.promptId,
      options: effectResult.options,
      defaultOptionId: effectResult.defaultOptionId,
      playerId,
      sourceId,
      consumeItemIfApplied,
    };
    io.to(roomCode).emit('game:effectPendingChoice', {
      playerId,
      promptId: effectResult.promptId,
      description: effectResult.description,
      options: effectResult.options,
    });
    const delayMs = Math.max(effectResult.deadline - Date.now(), 0);
    const handle = setTimeout(() => {
      handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, effectResult.promptId, effectChoiceTimeouts);
    }, delayMs);
    effectChoiceTimeouts.set(roomCode, handle);
    return { pending: true };
  }
  resolverEntry.pendingChoice = null;
  if (consumeItemIfApplied && effectResult.appliedCount > 0) {
    const player = getPlayer(gameState, playerId);
    removeItem(player, sourceId);
  }
  io.to(roomCode).emit('game:effectResolved', { playerId, sourceId });
  return { pending: false };
}

function clearEffectChoiceTimeout(roomCode, effectChoiceTimeouts) {
  const handle = effectChoiceTimeouts.get(roomCode);
  if (handle) {
    clearTimeout(handle);
    effectChoiceTimeouts.delete(roomCode);
  }
}

function handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, promptId, effectChoiceTimeouts) {
  try {
    const resolverEntry = getResolver(effectResolverManager, roomCode);
    if (!resolverEntry || !resolverEntry.pendingChoice) return;
    effectChoiceTimeouts.delete(roomCode);
    const { playerId, sourceId, options, defaultOptionId, consumeItemIfApplied } = resolverEntry.pendingChoice;
    const result = resolvePromptTimeout(resolverEntry.promptState, { promptId, defaultOptionId });
    if (!result) {
      return;
    }
    io.to(roomCode).emit('game:promptResolved', result);
    const chosenEffects = resolveChoiceOption(options, result.chosenOptionId);
    const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, chosenEffects, { now: Date.now() });
    const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied);
    if (!resolveOutcome.pending) {
      advanceTurnIfOver(gameState, playerId);
    }
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('effect choice timeout error', err);
  }
}

function handleCharacterSelectTimeout(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, promptId, playerId, characterSelectTimeoutMs, characterSelectTimeouts) {
  try {
    const entry = getCharacterSelection(characterSelectionManager, roomCode);
    if (!entry) return;
    characterSelectTimeouts.delete(roomCode);
    const characterId = assignRandomCharacter(entry.characterSelectionState, playerId);
    const result = resolvePromptTimeout(entry.promptState, { promptId, defaultOptionId: characterId });
    if (!result) {
      return;
    }
    io.to(roomCode).emit('game:promptResolved', result);
    advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts);
  } catch (err) {
    console.error('character select timeout error', err);
  }
}

function finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode) {
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
  const lobbyPlayersById = new Map(lobbyManager.getPlayers(roomCode).map((p) => [p.playerId, p]));
  const assignments = getAssignments(entry.characterSelectionState);
  const players = entry.characterSelectionState.order.map((playerId) => ({
    playerId,
    name: lobbyPlayersById.has(playerId) ? lobbyPlayersById.get(playerId).name : playerId,
    characterId: assignments.get(playerId),
  }));
  const gameState = startGame(gameManager, roomCode, {
    startingRooms: content.startingRooms,
    rooms: content.rooms,
    cards: content.cards,
    characters: content.characters,
    players,
  });
  startResolver(effectResolverManager, roomCode);
  endSelection(characterSelectionManager, roomCode);
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
