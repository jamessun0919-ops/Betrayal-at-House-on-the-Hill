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

function resolveFinalRoll(baseCount, chosenDiceInterjection, rng, tiers) {
  if (chosenDiceInterjection && chosenDiceInterjection.override) {
    // "Guaranteed pass" targets the tier the card's own data marks pass:true
    // directly, rather than synthesizing a dice sum and hoping it lands in
    // range -- authored tier ranges aren't guaranteed to cover an item's
    // theoretical max roll (2026-09-01 final review: they didn't, for 5 real
    // checks, and the old approach threw NO_MATCHING_TIER and destroyed the
    // item without resolving the check). leaveCheck/collapseCheck have no
    // tiers (they're threshold-based, not tiered) and fall through to the
    // auto-max branch below, where "higher roll is always better" genuinely
    // holds.
    if (Array.isArray(tiers)) {
      const passTier = tiers.find((t) => t.pass === true);
      if (passTier) {
        return passTier.min;
      }
    }
    const faces = chosenDiceInterjection.customFaces || DIE_FACES;
    const clampedBaseCount = Math.max(1, Math.min(8, baseCount));
    return clampedBaseCount * Math.max(...faces);
  }
  const boostedCount = baseCount + (chosenDiceInterjection ? (chosenDiceInterjection.bonusDice || 0) : 0);
  const clampedCount = Math.max(1, Math.min(8, boostedCount));
  return rollDice(clampedCount, rng);
}

module.exports = { findInterjectionOptions, resolveFinalRoll };
