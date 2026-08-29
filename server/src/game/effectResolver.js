const { getPlayer } = require('./gameState');
const { changeStat, addItem, removeItem, getStatValue, movePlayerTo, STATS } = require('./playerEntity');
const { attachModifier } = require('./modifiers');
const { coordKey, DIRECTION_DELTA, canMoveBetween } = require('./boardGenerator');
const { SIDES, OPPOSITE_SIDE } = require('./doorLayout');
const { dropToBasement } = require('./collapseFall');
const { rollDice, applyModifiers, evaluateTiers } = require('./effectPipeline');
const { createPrompt } = require('./promptState');
const { hasCards, drawCard } = require('./cardDeck');
const { findInterjectionOptions, resolveFinalRoll } = require('./diceInterjection');

const DECK_FIELD_BY_TYPE = { item: 'itemDeck', event: 'eventDeck', omen: 'omenDeck' };

function requirePlayer(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (!player) {
    throw new Error('PLAYER_NOT_FOUND');
  }
  return player;
}

function getRoomForPlayer(gameState, player) {
  return gameState.board[player.floor].get(coordKey(player.x, player.y));
}

function handleStatChange(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  if (effect.restoreToBase) {
    const statTrack = player.stats[effect.stat];
    if (!statTrack) {
      throw new Error('UNKNOWN_STAT');
    }
    const delta = Math.max(0, statTrack.baseIndex - statTrack.currentIndex);
    changeStat(player, effect.stat, delta, gameState.hauntStarted);
  } else if (effect.setToLevel) {
    const statTrack = player.stats[effect.stat];
    if (!statTrack) {
      throw new Error('UNKNOWN_STAT');
    }
    let targetIndex;
    if (effect.setToLevel === 'min') {
      targetIndex = statTrack.skullIndex + 1;
    } else if (effect.setToLevel === 'max') {
      targetIndex = statTrack.track.length - 1;
    } else {
      throw new Error('INVALID_SET_TO_LEVEL');
    }
    const rawDelta = targetIndex - statTrack.currentIndex;
    const delta = rawDelta < 0 ? rawDelta - statTrack.overflow : rawDelta;
    changeStat(player, effect.stat, delta, gameState.hauntStarted);
    if (effect.revertAtNextTurnStart && delta !== 0) {
      player.pendingStatReverts.push({ stat: effect.stat, delta: -delta });
    }
  } else {
    changeStat(player, effect.stat, effect.delta, gameState.hauntStarted);
  }
  return { pending: false };
}

function handleRandomStatChange(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  const stat = STATS[Math.floor(Math.random() * STATS.length)];
  changeStat(player, stat, effect.delta, gameState.hauntStarted);
  return { pending: false };
}

function handleActionPoints(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  if (effect.setTo !== undefined) {
    player.actionPoints = effect.setTo;
  } else {
    player.actionPoints = Math.max(0, player.actionPoints + effect.delta);
  }
  return { pending: false };
}

function handleGrantItem(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  addItem(player, { id: effect.itemId });
  return { pending: false, drawnCards: [{ id: effect.itemId }] };
}

function handleLoseItem(gameState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  removeItem(player, effect.itemId);
  if (effect.destination === 'deck') {
    const cardDef = ((context && context.itemCatalog) || []).find((c) => c.id === effect.itemId);
    if (!cardDef) {
      throw new Error('UNKNOWN_ITEM_CARD');
    }
    gameState.itemDeck.cards.push(cardDef);
  } else if (effect.destination === 'room') {
    const room = getRoomForPlayer(gameState, player);
    room.droppedItems.push({ id: effect.itemId });
  }
  return { pending: false };
}

function handleRemoveImprint(gameState, promptState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const catalog = [...((context && context.itemCatalog) || []), ...((context && context.omenCatalog) || [])];
  const imprintIds = player.inventory
    .map((item) => item.id)
    .filter((id) => {
      const cardDef = catalog.find((c) => c.id === id);
      return cardDef && cardDef.category === 'imprint';
    });
  if (imprintIds.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const chosenId = imprintIds[Math.floor(Math.random() * imprintIds.length)];
  const cardDef = catalog.find((c) => c.id === chosenId);
  removeItem(player, chosenId);
  for (const cardEffect of cardDef.effects || []) {
    if (cardEffect.type === 'stat_change' && !cardEffect.restoreToBase && !cardEffect.setToLevel) {
      changeStat(player, cardEffect.stat, -cardEffect.delta, gameState.hauntStarted);
    }
  }
  if (Array.isArray(effect.effects) && effect.effects.length > 0) {
    return resolveEffects(gameState, promptState, playerId, effect.effects, context);
  }
  return { pending: false };
}

function handleRemoveRoomDoors(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  const enteredFromSide = player.enteredFromSide;
  if (!enteredFromSide) {
    // Can happen when a collapsed-room fall drops the player into a fresh
    // basement room before this event card's own draw resolves against it
    // (see docs/superpowers/specs/2026-08-27-room-door-state-design.md,
    // 前置事實確認) -- no valid entry side to remove doors relative to, so
    // no-op rather than stripping every door off a room with no neighbors.
    return { pending: false, appliedCount: 0 };
  }
  if (effect.mode === 'entry') {
    if (room.doorSides.length <= 1) {
      // redrawIf (roomDoorCount==1) is not a hard guarantee -- drawFeasibleCard
      // can still hand out a rejected card as a fallback. Removing the only
      // remaining door would leave the room with zero doors, so no-op instead.
      return { pending: false, appliedCount: 0 };
    }
    room.doorSides = room.doorSides.filter((side) => side !== enteredFromSide);
    const delta = DIRECTION_DELTA[enteredFromSide];
    const neighbor = gameState.board[player.floor].get(coordKey(player.x + delta.dx, player.y + delta.dy));
    if (neighbor) {
      const facingSide = OPPOSITE_SIDE[enteredFromSide];
      neighbor.doorSides = neighbor.doorSides.filter((side) => side !== facingSide);
    }
  } else if (effect.mode === 'unexplored_except_entry') {
    room.doorSides = room.doorSides.filter((side) => {
      if (side === enteredFromSide) {
        return true;
      }
      const delta = DIRECTION_DELTA[side];
      const hasNeighbor = gameState.board[player.floor].has(coordKey(player.x + delta.dx, player.y + delta.dy));
      return hasNeighbor; // keep already-explored sides, drop unexplored ones
    });
  } else {
    throw new Error('UNKNOWN_REMOVE_ROOM_DOORS_MODE');
  }
  return { pending: false };
}

function handleAddRoomDoor(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  const candidateSides = SIDES.filter((side) => !room.doorSides.includes(side));
  if (candidateSides.length === 0) {
    throw new Error('NO_DOORLESS_WALL_AVAILABLE');
  }
  const chosenSide = candidateSides[Math.floor(Math.random() * candidateSides.length)];
  room.doorSides.push(chosenSide);
  const delta = DIRECTION_DELTA[chosenSide];
  const neighbor = gameState.board[player.floor].get(coordKey(player.x + delta.dx, player.y + delta.dy));
  if (neighbor) {
    const facingSide = OPPOSITE_SIDE[chosenSide];
    if (!neighbor.doorSides.includes(facingSide)) {
      neighbor.doorSides.push(facingSide);
    }
  }
  return { pending: false };
}

function handleFallToBasement(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const currentRoom = getRoomForPlayer(gameState, player);
  dropToBasement(gameState, player, currentRoom);
  return { pending: false };
}

function handleRevealPlayerLocations(gameState, playerId) {
  requirePlayer(gameState, playerId);
  const revealedLocations = [];
  for (const other of gameState.players.values()) {
    if (other.playerId === playerId) continue;
    revealedLocations.push({ playerId: other.playerId, floor: other.floor, x: other.x, y: other.y });
  }
  return { pending: false, revealedLocations };
}

// Moves the player to wherever a specific room (by id) is currently placed
// on the board -- floor-agnostic by design, so it keeps working once a third
// floor exists. Used by the entrance-hall stairs rooms (LobbyC <-> upper
// landing) so up/down movement can be triggered through the same generic
// room_action pathway as any other room effect (e.g. the vault's dice
// check), instead of a dedicated stairs button/socket event.
function handleMoveToRoom(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  for (const floor of Object.keys(gameState.board)) {
    const grid = gameState.board[floor];
    if (!(grid instanceof Map)) continue;
    for (const room of grid.values()) {
      if (room.roomId === effect.targetRoomId) {
        const enteredNewRoom = movePlayerTo(player, floor, room.x, room.y);
        return { pending: false, enteredNewRoom };
      }
    }
  }
  throw new Error('TARGET_ROOM_NOT_FOUND');
}

function handleMoveToPreviousRoom(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  if (!player.previousPosition) {
    return { pending: false, appliedCount: 0 };
  }
  const { floor, x, y } = player.previousPosition;
  const enteredNewRoom = movePlayerTo(player, floor, x, y);
  return { pending: false, enteredNewRoom };
}

function handleMoveToRandomNeighborRoom(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const candidates = [];
  for (const side of SIDES) {
    if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, side)) {
      candidates.push(side);
    }
  }
  if (candidates.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const chosenSide = candidates[Math.floor(Math.random() * candidates.length)];
  const delta = DIRECTION_DELTA[chosenSide];
  const enteredNewRoom = movePlayerTo(player, player.floor, player.x + delta.dx, player.y + delta.dy, OPPOSITE_SIDE[chosenSide]);
  return { pending: false, enteredNewRoom };
}

function handleRandomEffect(gameState, promptState, playerId, effect, context) {
  if (!Array.isArray(effect.options) || effect.options.length === 0) {
    throw new Error('INVALID_RANDOM_EFFECT_OPTIONS');
  }
  const index = Math.floor(Math.random() * effect.options.length);
  const nestedResult = resolveEffects(gameState, promptState, playerId, effect.options[index].effects, context);
  if (nestedResult.pending) {
    return nestedResult;
  }
  return { ...nestedResult, randomEffectIndex: index };
}

function handleToggleActive(gameState, promptState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const item = player.inventory.find((i) => i.id === effect.itemId);
  if (!item) {
    throw new Error('ITEM_NOT_HELD');
  }
  const wasActive = Boolean(item.active);
  item.active = !wasActive;
  const effectsToApply = wasActive ? effect.inactiveEffects : effect.activeEffects;
  return resolveEffects(gameState, promptState, playerId, effectsToApply, context);
}

function handleRoomGate(gameState, promptState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  if (!effect.roomIds.includes(room.roomId)) {
    return { pending: false, appliedCount: 0 };
  }
  return resolveEffects(gameState, promptState, playerId, effect.effects, context);
}

function handleSwitchControl(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  if (typeof effect.summonType !== 'string' || effect.summonType.length === 0) {
    throw new Error('INVALID_SWITCH_CONTROL_EFFECT');
  }
  if (!Number.isInteger(effect.actionPoints) || effect.actionPoints < 1) {
    throw new Error('INVALID_SWITCH_CONTROL_EFFECT');
  }
  if (player.summons) {
    throw new Error('SUMMON_ALREADY_ACTIVE');
  }
  if (player.summonUsedThisTurn) {
    throw new Error('SUMMON_ALREADY_USED_THIS_TURN');
  }
  player.summons = {
    type: effect.summonType,
    floor: player.floor,
    x: player.x,
    y: player.y,
    actionPoints: effect.actionPoints,
    carryingItemId: null,
  };
  player.summonUsedThisTurn = true;
  return { pending: false };
}

function handlePersistentModifier(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  if (effect.appliesTo !== 'player' && effect.appliesTo !== 'room' && effect.appliesTo !== 'roomAndNeighbors') {
    throw new Error('INVALID_MODIFIER_APPLIES_TO');
  }
  if (effect.appliesTo === 'player') {
    attachModifier(player, { effects: effect.effects, removeWhen: effect.removeWhen });
    return { pending: false };
  }
  const room = getRoomForPlayer(gameState, player);
  attachModifier(room, { effects: effect.effects, removeWhen: effect.removeWhen });
  if (effect.appliesTo === 'roomAndNeighbors') {
    for (const side of SIDES) {
      if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, side)) {
        const delta = DIRECTION_DELTA[side];
        const neighbor = gameState.board[player.floor].get(coordKey(player.x + delta.dx, player.y + delta.dy));
        attachModifier(neighbor, { effects: effect.effects, removeWhen: effect.removeWhen });
      }
    }
  }
  return { pending: false };
}

function computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice, context) {
  if (!interjectionChoice) {
    const adjustedCount = Math.max(1, Math.min(8, applyModifiers(baseCount, modifiers, 'onBeforeRoll', context)));
    const rolled = rollDice(adjustedCount, context.rng);
    return applyModifiers(rolled, modifiers, 'onAfterRoll', context);
  }
  const player = requirePlayer(gameState, playerId);
  const { itemId, diceInterjection, overrideValue } = interjectionChoice;
  if (Array.isArray(diceInterjection.cost) && diceInterjection.cost.length > 0) {
    resolveEffects(gameState, promptState, playerId, diceInterjection.cost, context);
  }
  if (diceInterjection.consumesItem) {
    removeItem(player, itemId);
  } else {
    player.diceInterjectionUsedThisTurn = [...(player.diceInterjectionUsedThisTurn || []), itemId];
  }
  if (diceInterjection.override) {
    return resolveFinalRoll(baseCount, diceInterjection, overrideValue, context.rng);
  }
  const boostedCount = baseCount + (diceInterjection.bonusDice || 0);
  const adjustedCount = Math.max(1, Math.min(8, applyModifiers(boostedCount, modifiers, 'onBeforeRoll', context)));
  const rolled = rollDice(adjustedCount, context.rng, diceInterjection.customFaces);
  return applyModifiers(rolled, modifiers, 'onAfterRoll', context);
}

function handleDiceCheck(gameState, promptState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];

  const baseCount = effect.stat !== undefined ? getStatValue(player, effect.stat) : effect.diceCount;
  if (!Number.isInteger(baseCount) || baseCount < 0) {
    throw new Error('INVALID_DICE_CHECK_COUNT');
  }

  if (context.interjectionChoice === undefined) {
    const itemCatalog = context.itemCatalog || [];
    const options = findInterjectionOptions(player, itemCatalog, context.sourceDeckType);
    if (options.length > 0) {
      return { pending: true, rollChoice: true, baseCount, options, effect, sourceDeckType: context.sourceDeckType };
    }
  }
  // Strip interjectionChoice once it's been consumed for *this* dice_check --
  // it must not leak into any resolveEffects call triggered from here (the
  // chosen item's own cost effects, or the matched tier's effects), each of
  // which needs a fresh scan if it contains its own nested dice_check.
  const { interjectionChoice, ...restContext } = context;
  const finalSum = computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice || null, restContext);
  const tier = evaluateTiers(finalSum, effect.tiers);
  const bonusOnPass = (tier.pass && interjectionChoice && Array.isArray(interjectionChoice.diceInterjection.bonusOnPass))
    ? interjectionChoice.diceInterjection.bonusOnPass
    : [];
  const nestedResult = resolveEffects(gameState, promptState, playerId, [...tier.effects, ...bonusOnPass], restContext);
  if (nestedResult.pending) {
    const pendingResult = { ...nestedResult };
    if (bonusOnPass.length > 0) {
      pendingResult.pendingBonusEffects = bonusOnPass;
    }
    return pendingResult;
  }
  return {
    ...nestedResult,
    diceCheckResult: { stat: effect.stat, diceCount: baseCount, rolled: finalSum, tierEffects: tier.effects, pass: tier.pass },
  };
}

function handleDrawCard(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  const deckField = DECK_FIELD_BY_TYPE[effect.deck];
  if (!deckField) {
    throw new Error('UNKNOWN_DECK_TYPE');
  }
  const deck = gameState[deckField];
  const drawnCards = [];
  for (let i = 0; i < effect.count; i += 1) {
    if (!hasCards(deck)) {
      break;
    }
    const card = drawCard(deck);
    addItem(player, { id: card.id });
    drawnCards.push({ id: card.id, name: card.name });
  }
  const result = { pending: false, appliedCount: drawnCards.length };
  if (drawnCards.length > 0) {
    result.drawnCards = drawnCards;
  }
  return result;
}

function handleTakePreviewedCard(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  const deckField = DECK_FIELD_BY_TYPE[effect.deck];
  if (!deckField) {
    throw new Error('UNKNOWN_DECK_TYPE');
  }
  const deck = gameState[deckField];
  const index = deck.cards.findIndex((c) => c.id === effect.cardId);
  if (index === -1) {
    // Someone else already drew it between the preview and this choice resolving.
    return { pending: false, appliedCount: 0 };
  }
  const [card] = deck.cards.splice(index, 1);
  addItem(player, { id: card.id });
  return { pending: false, appliedCount: 1, drawnCards: [{ id: card.id, name: card.name }] };
}

function handlePreviewAndChoose(gameState, promptState, playerId, effect, context) {
  const deckField = DECK_FIELD_BY_TYPE[effect.deck];
  if (!deckField) {
    throw new Error('UNKNOWN_DECK_TYPE');
  }
  const deck = gameState[deckField];
  const previewCards = deck.cards.slice(0, effect.count);
  if (previewCards.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const options = previewCards.map((card) => ({
    optionId: card.id,
    label: card.name,
    effects: [{ type: 'take_previewed_card', deck: effect.deck, cardId: card.id }],
  }));
  options.push({ optionId: '__skip__', label: '放棄', effects: [] });
  return handleChoice(gameState, promptState, playerId, {
    description: effect.description,
    timeoutMs: effect.timeoutMs,
    defaultOptionId: '__skip__',
    options,
  }, context);
}

function handleChoice(gameState, promptState, playerId, effect, context) {
  const prompt = createPrompt(promptState, {
    type: 'effect_choice',
    targetPlayerId: playerId,
    description: effect.description,
    options: effect.options.map((o) => o.optionId),
    timeoutMs: effect.timeoutMs,
    now: context.now,
  });
  return {
    pending: true,
    promptId: prompt.promptId,
    description: prompt.description,
    deadline: prompt.deadline,
    defaultOptionId: effect.defaultOptionId,
    options: effect.options,
  };
}

function resolveChoiceOption(options, optionId) {
  const option = options.find((o) => o.optionId === optionId);
  if (!option) {
    throw new Error('INVALID_CHOICE_OPTION');
  }
  return option.effects;
}

const HANDLERS = Object.assign(Object.create(null), {
  stat_change: (gameState, promptState, playerId, effect) => handleStatChange(gameState, playerId, effect),
  action_points: (gameState, promptState, playerId, effect) => handleActionPoints(gameState, playerId, effect),
  grant_item: (gameState, promptState, playerId, effect) => handleGrantItem(gameState, playerId, effect),
  lose_item: (gameState, promptState, playerId, effect, context) => handleLoseItem(gameState, playerId, effect, context),
  remove_imprint: (gameState, promptState, playerId, effect, context) => handleRemoveImprint(gameState, promptState, playerId, effect, context),
  random_stat_change: (gameState, promptState, playerId, effect) => handleRandomStatChange(gameState, playerId, effect),
  room_gate: (gameState, promptState, playerId, effect, context) => handleRoomGate(gameState, promptState, playerId, effect, context),
  remove_room_doors: (gameState, promptState, playerId, effect) => handleRemoveRoomDoors(gameState, playerId, effect),
  add_room_door: (gameState, promptState, playerId, effect) => handleAddRoomDoor(gameState, playerId),
  fall_to_basement: (gameState, promptState, playerId) => handleFallToBasement(gameState, playerId),
  reveal_player_locations: (gameState, promptState, playerId) => handleRevealPlayerLocations(gameState, playerId),
  move_to_room: (gameState, promptState, playerId, effect) => handleMoveToRoom(gameState, playerId, effect),
  move_to_previous_room: (gameState, promptState, playerId) => handleMoveToPreviousRoom(gameState, playerId),
  move_to_random_neighbor_room: (gameState, promptState, playerId) => handleMoveToRandomNeighborRoom(gameState, playerId),
  random_effect: (gameState, promptState, playerId, effect, context) => handleRandomEffect(gameState, promptState, playerId, effect, context),
  toggle_active: (gameState, promptState, playerId, effect, context) => handleToggleActive(gameState, promptState, playerId, effect, context),
  switch_control: (gameState, promptState, playerId, effect) => handleSwitchControl(gameState, playerId, effect),
  persistent_modifier: (gameState, promptState, playerId, effect) => handlePersistentModifier(gameState, playerId, effect),
  draw_card: (gameState, promptState, playerId, effect) => handleDrawCard(gameState, playerId, effect),
  take_previewed_card: (gameState, promptState, playerId, effect) => handleTakePreviewedCard(gameState, playerId, effect),
  preview_and_choose: (gameState, promptState, playerId, effect, context) => handlePreviewAndChoose(gameState, promptState, playerId, effect, context),
  dice_check: (gameState, promptState, playerId, effect, context) => handleDiceCheck(gameState, promptState, playerId, effect, context),
  choice: (gameState, promptState, playerId, effect, context) => handleChoice(gameState, promptState, playerId, effect, context),
});

function resolveEffects(gameState, promptState, playerId, effects, context = {}) {
  if (!Array.isArray(effects)) {
    throw new Error('INVALID_EFFECTS_LIST');
  }
  requirePlayer(gameState, playerId);
  let appliedCount = 0;
  let drawnCards = [];
  let diceCheckResult = null;
  let enteredNewRoom = null;
  let revealedLocations = null;
  let randomEffectIndex = null;
  for (const effect of effects) {
    const handler = HANDLERS[effect.type];
    if (!handler) {
      throw new Error('UNSUPPORTED_EFFECT_TYPE');
    }
    const result = handler(gameState, promptState, playerId, effect, context);
    if (result && result.pending) {
      return result;
    }
    appliedCount += (result && typeof result.appliedCount === 'number') ? result.appliedCount : 1;
    if (result && Array.isArray(result.drawnCards)) {
      drawnCards = drawnCards.concat(result.drawnCards);
    }
    if (result && result.diceCheckResult) {
      diceCheckResult = result.diceCheckResult;
    }
    if (result && result.enteredNewRoom !== undefined) {
      enteredNewRoom = result.enteredNewRoom;
    }
    if (result && Array.isArray(result.revealedLocations)) {
      revealedLocations = result.revealedLocations;
    }
    if (result && typeof result.randomEffectIndex === 'number') {
      randomEffectIndex = result.randomEffectIndex;
    }
  }
  const output = { pending: false, appliedCount };
  if (drawnCards.length > 0) {
    output.drawnCards = drawnCards;
  }
  if (diceCheckResult) {
    output.diceCheckResult = diceCheckResult;
  }
  if (enteredNewRoom !== null) {
    output.enteredNewRoom = enteredNewRoom;
  }
  if (revealedLocations !== null) {
    output.revealedLocations = revealedLocations;
  }
  if (randomEffectIndex !== null) {
    output.randomEffectIndex = randomEffectIndex;
  }
  return output;
}

module.exports = { resolveEffects, resolveChoiceOption, computeInterjectedRoll };
