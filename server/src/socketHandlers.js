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
const { moveToRoom, moveSummon, selectAction, selectSummonAction, useStairs, endTurn } = require('./game/turnFlow');
const { coordKey } = require('./game/boardGenerator');
const { startResolver, getResolver } = require('./game/effectResolverManager');
const { resolveEffects, resolveChoiceOption, computeInterjectedRoll } = require('./game/effectResolver');
const { rollDice } = require('./game/effectPipeline');
const { hasCards, drawCard } = require('./game/cardDeck');
const { addItem, removeItem, getStatValue } = require('./game/playerEntity');
const { checkRemoveConditions } = require('./game/modifiers');

const DEFAULT_CHARACTER_SELECT_TIMEOUT_MS = 30000;

const DECK_FIELD_BY_TYPE = { item: 'itemDeck', event: 'eventDeck', omen: 'omenDeck' };

function registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, options = {}) {
  const characterSelectTimeoutMs = options.characterSelectTimeoutMs || DEFAULT_CHARACTER_SELECT_TIMEOUT_MS;
  const characterSelectTimeouts = new Map(); // roomCode -> Timeout handle
  const effectChoiceTimeouts = new Map(); // roomCode -> Timeout handle
  const rollChoiceTimeouts = new Map(); // roomCode -> Timeout handle
  const rollChoiceTimeoutMs = options.rollChoiceTimeoutMs || 20000;

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
        if (hasPendingRollChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
        const { direction } = payload || {};
        const player = getPlayer(gameState, playerId);
        if (player.summons) {
          const result = moveSummon(gameState, playerId, direction);
          ack(result);
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
          return;
        }
        const currentRoom = gameState.board[player.floor].get(coordKey(player.x, player.y));
        const currentRoomDefinition = findRoomDefinition(content, currentRoom.roomId);
        const leaveCheck = currentRoomDefinition ? currentRoomDefinition.leaveCheck : null;
        const result = moveToRoom(gameState, playerId, direction, leaveCheck, { itemCatalog: content.cards.items });

        if (result.kind === 'leaveCheckPending') {
          handleLeaveCheckRollPending(io, effectResolverManager, gameState, roomCode, playerId, result, rollChoiceTimeouts, rollChoiceTimeoutMs, effectChoiceTimeouts, content);
          ack({ kind: 'leaveCheckPending' });
          return;
        }

        ack(result);
        finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
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
        if (hasPendingRollChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
        const player = getPlayer(gameState, playerId);
        if (player.summons) {
          const { actionType, itemId, mode } = payload || {};
          const result = selectSummonAction(gameState, playerId, actionType, { itemId, mode });
          ack(result);
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
          return;
        }
        const { actionType, itemId, targetPlayerId, mode } = payload || {};
        const selectOptions = { itemId, targetPlayerId, mode };
        let sourceEffects = null;
        let sourceId = null;
        let consumeItemIfApplied = false;

        if (actionType === 'item' && (!mode || mode === 'use')) {
          const itemContent = content.cards.items.find((i) => i.id === itemId) || content.cards.omens.find((o) => o.id === itemId);
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

        if (sourceEffects) {
          try {
            const resolverEntry = getResolver(effectResolverManager, roomCode);
            const targetForEffects = result.targetPlayerId || playerId;
            const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now(), itemCatalog: content.cards.items });
            const outcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, targetForEffects, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
            if (outcome.drawnCards) {
              socket.emit('game:cardsDrawn', { cards: outcome.drawnCards });
            }
          } catch (err) {
            console.error('selectAction effect resolution error', err);
          }
        } else if (result.pending) {
          io.to(roomCode).emit('game:pendingAction', { playerId, actionType: result.kind });
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
        if (hasPendingRollChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
        const result = useStairs(gameState, playerId);
        ack(result);
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:useStairs error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:endTurn', (payload, callback) => {
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
        if (hasPendingRollChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
        const player = getPlayer(gameState, playerId);
        const placedRoom = gameState.board[player.floor].get(coordKey(player.x, player.y));
        const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
        const nextPlayerId = endTurn(gameState, playerId);
        try {
          applyRoomEndTurnBonus(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
        } catch (bonusErr) {
          // Same rationale as the resolveCardDraw catch below -- a bad room
          // bonus definition must not prevent the turn from having already
          // advanced, or skip the state broadcast.
          console.error('applyRoomEndTurnBonus error', bonusErr);
        }
        ack({ nextPlayerId });
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:endTurn error', err);
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
        const nextResult = resolveEffects(gameState, resolverEntry.promptState, choicePlayerId, chosenEffects, { now: Date.now(), itemCatalog: content.cards.items });
        const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, choicePlayerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
        if (resolveOutcome.drawnCards) {
          socket.emit('game:cardsDrawn', { cards: resolveOutcome.drawnCards });
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
        ack({});
      } catch (err) {
        console.error('game:effectPromptRespond error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:diceChoiceRespond', (payload, callback) => {
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
        if (!resolverEntry || !resolverEntry.pendingRollChoice) {
          return ack({ error: 'NO_ACTIVE_ROLL_CHOICE' });
        }
        const { promptId, optionId, overrideValue } = payload || {};
        const { playerId: choicePlayerId, options, resumeKind, resumeContext } = resolverEntry.pendingRollChoice;

        // Validate BEFORE consuming the prompt (respondToPrompt below) so a
        // malformed response doesn't destroy the item or drop the pending
        // choice -- the player can simply retry with a valid overrideValue.
        if (optionId !== '__skip__') {
          const candidateOption = options.find((o) => o.itemId === optionId);
          if (candidateOption && candidateOption.diceInterjection.override) {
            if (!Number.isInteger(overrideValue) || overrideValue < 0 || overrideValue > 8) {
              return ack({ error: 'INVALID_OVERRIDE_VALUE' });
            }
          }
        }

        const result = respondToPrompt(resolverEntry.promptState, { promptId, playerId, optionId });
        clearRollChoiceTimeout(roomCode, rollChoiceTimeouts);
        resolverEntry.pendingRollChoice = null;
        io.to(roomCode).emit('game:promptResolved', result);

        const chosenOption = optionId === '__skip__' ? null : options.find((o) => o.itemId === optionId);
        const interjectionChoice = chosenOption
          ? { itemId: chosenOption.itemId, diceInterjection: chosenOption.diceInterjection, overrideValue }
          : null;

        const outcome = resumeRollChoice(io, effectResolverManager, gameState, roomCode, choicePlayerId, resumeKind, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs, socket);
        if (outcome.drawnCards) {
          socket.emit('game:cardsDrawn', { cards: outcome.drawnCards });
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
        ack({});
      } catch (err) {
        console.error('game:diceChoiceRespond error', err);
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

function hasPendingEffectChoice(effectResolverManager, roomCode) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  return Boolean(resolverEntry && resolverEntry.pendingChoice);
}

function hasPendingRollChoice(effectResolverManager, roomCode) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  return Boolean(resolverEntry && resolverEntry.pendingRollChoice);
}

function findRoomDefinition(content, roomId) {
  return (
    content.rooms.find((r) => r.id === roomId) ||
    content.startingRooms.find((r) => r.id === roomId)
  );
}

function finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
  // Any modifier gated on "meets another player" (e.g. 電池耗盡) clears
  // once the mover shares a room with someone -- check everyone now
  // standing there, not just the mover, since it could be the other
  // player's modifier that clears.
  const mover = getPlayer(gameState, playerId);
  const roommates = [...gameState.players.values()].filter(
    (p) => p.floor === mover.floor && p.x === mover.x && p.y === mover.y
  );
  if (roommates.length > 1) {
    for (const roommate of roommates) {
      checkRemoveConditions(roommate, { type: 'meetsAnotherPlayer' });
    }
  }

  if (result.pendingCardDraw) {
    try {
      const drawOutcome = resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
      if (socket && drawOutcome.drawnCards) {
        socket.emit('game:cardsDrawn', { cards: drawOutcome.drawnCards });
      }
    } catch (drawErr) {
      // A card-effect resolution failure (e.g. malformed content) must not
      // prevent the turn from advancing and the room from staying in sync --
      // see M2c-2 final review, Critical C1.
      console.error('resolveCardDraw error', drawErr);
    }
  }
}

function handleLeaveCheckRollPending(io, effectResolverManager, gameState, roomCode, playerId, moveResult, rollChoiceTimeouts, rollChoiceTimeoutMs, effectChoiceTimeouts, content) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const optionIds = moveResult.options.map((o) => o.itemId).concat('__skip__');
  const prompt = createPrompt(resolverEntry.promptState, {
    type: 'dice_interjection',
    targetPlayerId: playerId,
    description: '要不要使用道具介入這次擲骰？',
    options: optionIds,
    timeoutMs: rollChoiceTimeoutMs,
    now: Date.now(),
  });
  resolverEntry.pendingRollChoice = {
    playerId,
    promptId: prompt.promptId,
    deadline: prompt.deadline,
    options: moveResult.options,
    resumeKind: 'leaveCheck',
    resumeContext: { direction: moveResult.direction, leaveCheck: moveResult.leaveCheck },
  };
  resolverEntry.pendingChoice = null; // a roll choice and a plain choice can never be simultaneously pending -- opening this one invalidates any other
  io.to(roomCode).emit('game:diceChoicePending', {
    playerId,
    promptId: prompt.promptId,
    options: moveResult.options,
    deadline: prompt.deadline,
  });
  const delayMs = Math.max(prompt.deadline - Date.now(), 0);
  const handle = setTimeout(() => {
    handleRollChoiceTimeout(io, effectResolverManager, gameState, roomCode, prompt.promptId, rollChoiceTimeouts, effectChoiceTimeouts, content, rollChoiceTimeoutMs);
  }, delayMs);
  rollChoiceTimeouts.set(roomCode, handle);
}

function applyRoomEndTurnBonus(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
  if (!roomDefinition || !Array.isArray(roomDefinition.effects)) {
    return;
  }
  const player = getPlayer(gameState, playerId);
  const received = player.roomBonusesReceived || [];
  if (received.includes(roomDefinition.id)) {
    return;
  }
  const bonusEffects = roomDefinition.effects.filter((e) => e.onceOnlyPerPlayer);
  if (bonusEffects.length === 0) {
    return;
  }
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, bonusEffects, { now: Date.now(), itemCatalog: content.cards.items });
  handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition.id, effectResult, effectChoiceTimeouts, false, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
  player.roomBonusesReceived = [...received, roomDefinition.id];
}

function resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, deckType, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
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

  if (deckType === 'omen') {
    // Omens are kept by the player like items -- some (crystal ball, mask) have
    // an active use ability invoked later via game:selectAction's 'item' path.
    addItem(getPlayer(gameState, playerId), { id: card.id });
  }

  if (deckType === 'omen' && !gameState.hauntStarted) {
    gameState.omenCount += 1;
    const rollSum = rollDice(gameState.omenCount);
    io.to(roomCode).emit('game:hauntCheck', { omenCount: gameState.omenCount, rollSum });
    if (rollSum > 5) {
      gameState.hauntStarted = true;
      io.to(roomCode).emit('game:hauntStarted', { omenCount: gameState.omenCount, rollSum });
    }
  }

  if (card.activatedOnUse) {
    // This card's effects are only meant to fire when the player later
    // chooses to use it (game:selectAction actionType:'item') -- not the
    // instant it's drawn. The card is already in inventory (above); stop here.
    return { pending: false };
  }

  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, {
    now: Date.now(),
    itemCatalog: content.cards.items,
    sourceDeckType: deckType,
  });
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, card.id, effectResult, effectChoiceTimeouts, false, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
}

// Returns {pending: boolean} so callers know whether the turn should advance
// now or wait until the choice this call may have just opened gets resolved
// (see M2c-2 final review, Critical C1: advancing the turn while a choice is
// still pending let a second card draw collide with the first).
function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied = false, content = null, rollChoiceTimeouts = null, rollChoiceTimeoutMs = 20000) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending && effectResult.rollChoice) {
    return handleRollChoicePending(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, consumeItemIfApplied, rollChoiceTimeouts, rollChoiceTimeoutMs, effectChoiceTimeouts, content);
  }
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
      handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, effectResult.promptId, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
    }, delayMs);
    effectChoiceTimeouts.set(roomCode, handle);
    return { pending: true };
  }
  resolverEntry.pendingChoice = null;
  const player = getPlayer(gameState, playerId);
  if (consumeItemIfApplied && effectResult.appliedCount > 0) {
    try {
      removeItem(player, sourceId);
    } catch (err) {
      // The item's own effects may have already removed it (e.g. an explicit
      // lose_item targeting itself) -- treat "already gone" as a benign no-op
      // rather than letting this throw skip turn-advancement/state-broadcast
      // in the callers of this function (M2c-4/M2c-5 independent review, Important #1).
      console.error('consumeItemIfApplied removeItem failed (already removed?)', err);
    }
  }
  // Any effect resolution may have changed what the player holds (grant_item,
  // draw_card, an omen added to inventory, etc.) -- re-check holdsItem-gated
  // modifiers (e.g. 電池耗盡 clearing once the player picks up 蠟燭).
  for (const item of player.inventory) {
    checkRemoveConditions(player, { type: 'holdsItem', itemId: item.id });
  }
  io.to(roomCode).emit('game:effectResolved', { playerId, sourceId });
  const outcome = { pending: false };
  if (Array.isArray(effectResult.drawnCards) && effectResult.drawnCards.length > 0) {
    outcome.drawnCards = effectResult.drawnCards;
  }
  return outcome;
}

function handleRollChoicePending(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, consumeItemIfApplied, rollChoiceTimeouts, rollChoiceTimeoutMs, effectChoiceTimeouts, content) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const optionIds = effectResult.options.map((o) => o.itemId).concat('__skip__');
  const prompt = createPrompt(resolverEntry.promptState, {
    type: 'dice_interjection',
    targetPlayerId: playerId,
    description: '要不要使用道具介入這次擲骰？',
    options: optionIds,
    timeoutMs: rollChoiceTimeoutMs,
    now: Date.now(),
  });
  resolverEntry.pendingRollChoice = {
    playerId,
    promptId: prompt.promptId,
    deadline: prompt.deadline,
    options: effectResult.options,
    resumeKind: 'diceCheck',
    resumeContext: { effect: effectResult.effect, sourceId, consumeItemIfApplied, sourceDeckType: effectResult.sourceDeckType },
  };
  resolverEntry.pendingChoice = null; // a roll choice and a plain choice can never be simultaneously pending -- opening this one invalidates any other
  io.to(roomCode).emit('game:diceChoicePending', {
    playerId,
    promptId: prompt.promptId,
    options: effectResult.options,
    deadline: prompt.deadline,
  });
  const delayMs = Math.max(prompt.deadline - Date.now(), 0);
  const handle = setTimeout(() => {
    handleRollChoiceTimeout(io, effectResolverManager, gameState, roomCode, prompt.promptId, rollChoiceTimeouts, effectChoiceTimeouts, content, rollChoiceTimeoutMs);
  }, delayMs);
  rollChoiceTimeouts.set(roomCode, handle);
  return { pending: true };
}

function resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, resumeKind, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs, socket = null) {
  if (resumeKind === 'leaveCheck') {
    return resumeLeaveCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
  }
  if (resumeKind !== 'diceCheck') {
    throw new Error('UNSUPPORTED_ROLL_CHOICE_RESUME_KIND');
  }
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const { effect, sourceId, consumeItemIfApplied, sourceDeckType } = resumeContext;
  const context = { now: Date.now(), interjectionChoice, itemCatalog: content.cards.items, sourceDeckType };
  const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, [effect], context);
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
}

function resumeLeaveCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const { direction, leaveCheck } = resumeContext;
  const player = getPlayer(gameState, playerId);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];
  const diceCount = getStatValue(player, leaveCheck.stat);
  const finalRoll = computeInterjectedRoll(
    gameState,
    resolverEntry.promptState,
    playerId,
    diceCount,
    modifiers,
    interjectionChoice,
    { now: Date.now(), itemCatalog: content.cards.items, rng: Math.random }
  );
  const result = moveToRoom(gameState, playerId, direction, leaveCheck, { resolvedRoll: finalRoll });
  finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
  return { pending: false };
}

function clearRollChoiceTimeout(roomCode, rollChoiceTimeouts) {
  const handle = rollChoiceTimeouts.get(roomCode);
  if (handle) {
    clearTimeout(handle);
    rollChoiceTimeouts.delete(roomCode);
  }
}

function handleRollChoiceTimeout(io, effectResolverManager, gameState, roomCode, promptId, rollChoiceTimeouts, effectChoiceTimeouts, content, rollChoiceTimeoutMs) {
  try {
    const resolverEntry = getResolver(effectResolverManager, roomCode);
    if (!resolverEntry || !resolverEntry.pendingRollChoice) return;
    rollChoiceTimeouts.delete(roomCode);
    const { playerId, resumeKind, resumeContext } = resolverEntry.pendingRollChoice;
    const result = resolvePromptTimeout(resolverEntry.promptState, { promptId, defaultOptionId: '__skip__' });
    if (!result) {
      resolverEntry.pendingRollChoice = null;
      return;
    }
    resolverEntry.pendingRollChoice = null;
    io.to(roomCode).emit('game:promptResolved', result);
    resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, resumeKind, resumeContext, null, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('roll choice timeout error', err);
  }
}

function clearEffectChoiceTimeout(roomCode, effectChoiceTimeouts) {
  const handle = effectChoiceTimeouts.get(roomCode);
  if (handle) {
    clearTimeout(handle);
    effectChoiceTimeouts.delete(roomCode);
  }
}

function handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, promptId, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
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
    const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, chosenEffects, { now: Date.now(), itemCatalog: content.cards.items });
    const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
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
