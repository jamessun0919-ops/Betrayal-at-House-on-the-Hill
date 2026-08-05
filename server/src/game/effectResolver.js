const { getPlayer } = require('./gameState');
const { changeStat, addItem, removeItem, getStatValue } = require('./playerEntity');
const { attachModifier } = require('./modifiers');
const { coordKey } = require('./boardGenerator');
const { rollDice, applyModifiers, evaluateTiers } = require('./effectPipeline');
const { createPrompt } = require('./promptState');

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
    const delta = statTrack.baseIndex - statTrack.currentIndex;
    changeStat(player, effect.stat, delta, gameState.hauntStarted);
  } else {
    changeStat(player, effect.stat, effect.delta, gameState.hauntStarted);
  }
  return { pending: false };
}

function handleGrantItem(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  addItem(player, { id: effect.itemId });
  return { pending: false };
}

function handleLoseItem(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  removeItem(player, effect.itemId);
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

function handleDiceCheck(gameState, promptState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];

  const baseCount = effect.stat !== undefined ? getStatValue(player, effect.stat) : effect.diceCount;
  if (!Number.isInteger(baseCount) || baseCount < 0) {
    throw new Error('INVALID_DICE_CHECK_COUNT');
  }

  const adjustedCount = applyModifiers(baseCount, modifiers, 'onBeforeRoll', context);
  const rolled = rollDice(adjustedCount, context.rng);
  const finalSum = applyModifiers(rolled, modifiers, 'onAfterRoll', context);
  const tier = evaluateTiers(finalSum, effect.tiers);
  return resolveEffects(gameState, promptState, playerId, tier.effects, context);
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
  persistent_modifier: (gameState, promptState, playerId, effect) => handlePersistentModifier(gameState, playerId, effect),
  dice_check: (gameState, promptState, playerId, effect, context) => handleDiceCheck(gameState, promptState, playerId, effect, context),
  choice: (gameState, promptState, playerId, effect, context) => handleChoice(gameState, promptState, playerId, effect, context),
});

function resolveEffects(gameState, promptState, playerId, effects, context = {}) {
  if (!Array.isArray(effects)) {
    throw new Error('INVALID_EFFECTS_LIST');
  }
  requirePlayer(gameState, playerId);
  for (const effect of effects) {
    const handler = HANDLERS[effect.type];
    if (!handler) {
      throw new Error('UNSUPPORTED_EFFECT_TYPE');
    }
    const result = handler(gameState, promptState, playerId, effect, context);
    if (result && result.pending) {
      return result;
    }
  }
  return { pending: false };
}

module.exports = { resolveEffects, resolveChoiceOption };
