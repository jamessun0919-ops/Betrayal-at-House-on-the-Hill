let modifierCounter = 0;

function generateModifierId() {
  modifierCounter += 1;
  return `modifier_${modifierCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function attachModifier(entity, { effects, removeWhen }) {
  if (!Array.isArray(effects) || effects.length === 0) {
    throw new Error('INVALID_MODIFIER_EFFECTS');
  }
  if (!removeWhen || typeof removeWhen.type !== 'string' || removeWhen.type.length === 0) {
    throw new Error('INVALID_REMOVE_WHEN');
  }
  const modifier = { id: generateModifierId(), effects, removeWhen };
  entity.modifiers = entity.modifiers || [];
  entity.modifiers.push(modifier);
  return modifier;
}

function removeModifier(entity, modifierId) {
  const modifiers = entity.modifiers || [];
  const index = modifiers.findIndex((m) => m.id === modifierId);
  if (index === -1) {
    throw new Error('MODIFIER_NOT_FOUND');
  }
  modifiers.splice(index, 1);
}

function matchesRemoveWhen(removeWhen, context) {
  if (removeWhen.type !== context.type) return false;
  if (removeWhen.type === 'holdsItem') {
    return removeWhen.itemId === context.itemId;
  }
  return true;
}

function checkRemoveConditions(entity, context) {
  const modifiers = entity.modifiers || [];
  const toRemove = modifiers.filter((m) => matchesRemoveWhen(m.removeWhen, context));
  for (const modifier of toRemove) {
    removeModifier(entity, modifier.id);
  }
  return toRemove;
}

module.exports = { attachModifier, removeModifier, checkRemoveConditions };
