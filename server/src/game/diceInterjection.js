const { rollDice, DIE_FACES } = require('./effectPipeline');

function findInterjectionOptions(player, itemCatalog, sourceDeckType) {
  if (!Array.isArray(itemCatalog)) {
    throw new Error('INVALID_ITEM_CATALOG');
  }
  const used = player.diceInterjectionUsedThisTurn || [];
  const options = [];
  for (const invItem of player.inventory || []) {
    const content = itemCatalog.find((c) => c.id === invItem.id);
    if (!content || !content.diceInterjection) continue;
    if (content.category === 'gear' && !player.wornGearIds.includes(invItem.id)) continue;
    const di = content.diceInterjection;
    if (di.scope === 'eventTriggered' && sourceDeckType !== 'event') continue;
    if (di.scope === 'diceCheckOnly' && sourceDeckType === null) continue;
    if (!di.consumesItem && used.includes(invItem.id)) continue;
    options.push({ itemId: invItem.id, name: content.name, diceInterjection: di });
  }
  return options;
}

function resolveFinalRoll(baseCount, chosenDiceInterjection, rng) {
  if (chosenDiceInterjection && chosenDiceInterjection.override) {
    const faces = chosenDiceInterjection.customFaces || DIE_FACES;
    return baseCount * Math.max(...faces);
  }
  const boostedCount = baseCount + (chosenDiceInterjection ? (chosenDiceInterjection.bonusDice || 0) : 0);
  const clampedCount = Math.max(1, Math.min(8, boostedCount));
  return rollDice(clampedCount, rng);
}

module.exports = { findInterjectionOptions, resolveFinalRoll };
