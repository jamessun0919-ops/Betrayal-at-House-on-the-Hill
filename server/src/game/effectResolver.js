const { getPlayer } = require('./gameState');
const { changeStat, addItem, removeItem, getStatValue, movePlayerTo } = require('./playerEntity');
const { attachModifier } = require('./modifiers');
const { coordKey } = require('./boardGenerator');
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
  } else {
    changeStat(player, effect.stat, effect.delta, gameState.hauntStarted);
  }
  return { pending: false };
}

function handleGrantItem(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  addItem(player, { id: effect.itemId });
  return { pending: false, drawnCards: [{ id: effect.itemId }] };
}

function handleLoseItem(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  removeItem(player, effect.itemId);
  return { pending: false };
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
  if (effect.appliesTo !== 'player' && effect.appliesTo !== 'room') {
    throw new Error('INVALID_MODIFIER_APPLIES_TO');
  }
  const entity = effect.appliesTo === 'room' ? getRoomForPlayer(gameState, player) : player;
  attachModifier(entity, { effects: effect.effects, removeWhen: effect.removeWhen });
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
  const rolled = rollDice(adjustedCount, context.rng);
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
  const nestedResult = resolveEffects(gameState, promptState, playerId, tier.effects, restContext);
  return {
    ...nestedResult,
    diceCheckResult: { stat: effect.stat, diceCount: baseCount, rolled: finalSum, tierEffects: tier.effects },
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
  grant_item: (gameState, promptState, playerId, effect) => handleGrantItem(gameState, playerId, effect),
  lose_item: (gameState, promptState, playerId, effect) => handleLoseItem(gameState, playerId, effect),
  move_to_room: (gameState, promptState, playerId, effect) => handleMoveToRoom(gameState, playerId, effect),
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
  return output;
}

module.exports = { resolveEffects, resolveChoiceOption, computeInterjectedRoll };
