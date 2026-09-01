const DIE_FACES = [0, 0, 1, 1, 2, 2];

function rollDice(count, rng = Math.random, faces = DIE_FACES) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('INVALID_DICE_COUNT');
  }
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * faces.length);
    sum += faces[index];
  }
  return sum;
}

function applyModifiers(value, modifiers, hookType, context = {}) {
  if (!Array.isArray(modifiers)) {
    throw new Error('INVALID_MODIFIER_LIST');
  }
  let result = value;
  for (const modifier of modifiers) {
    if (!Array.isArray(modifier.effects)) {
      throw new Error('INVALID_MODIFIER_EFFECTS');
    }
    for (const effect of modifier.effects) {
      if (effect.hookType !== hookType) continue;
      if (effect.checkContext && effect.checkContext !== context.checkContext) continue;
      result += effect.delta;
    }
  }
  return result;
}

function evaluateTiers(rollResult, tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new Error('INVALID_TIERS');
  }
  const tier = tiers.find((t) => rollResult >= t.min && rollResult <= t.max);
  if (!tier) {
    throw new Error('NO_MATCHING_TIER');
  }
  return tier;
}

module.exports = { rollDice, applyModifiers, evaluateTiers, DIE_FACES };
