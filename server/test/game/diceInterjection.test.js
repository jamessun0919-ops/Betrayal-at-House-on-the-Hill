const { findInterjectionOptions, resolveFinalRoll } = require('../../src/game/diceInterjection');

function makeCatalog() {
  return [
    { id: 'item_005', name: '天使羽毛', diceInterjection: { scope: 'any', override: true, consumesItem: true } },
    {
      id: 'item_006',
      name: '詭異人偶',
      diceInterjection: {
        scope: 'any',
        bonusDice: 2,
        cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }],
        consumesItem: false,
      },
    },
    { id: 'item_010', name: '蠟燭', diceInterjection: { scope: 'eventTriggered', bonusDice: 1, consumesItem: false } },
    { id: 'item_003', name: '治療藥膏' }, // 沒有 diceInterjection 的一般道具，對照組
  ];
}

test('findInterjectionOptions returns held items with a matching scope', () => {
  const player = { inventory: [{ id: 'item_005' }, { id: 'item_003' }] };
  const options = findInterjectionOptions(player, makeCatalog(), undefined);
  expect(options).toEqual([
    { itemId: 'item_005', name: '天使羽毛', diceInterjection: makeCatalog()[0].diceInterjection },
  ]);
});

test('findInterjectionOptions excludes eventTriggered items unless sourceDeckType is "event"', () => {
  const player = { inventory: [{ id: 'item_010' }] };
  expect(findInterjectionOptions(player, makeCatalog(), undefined)).toEqual([]);
  expect(findInterjectionOptions(player, makeCatalog(), 'item')).toEqual([]);
  const eventOptions = findInterjectionOptions(player, makeCatalog(), 'event');
  expect(eventOptions).toEqual([{ itemId: 'item_010', name: '蠟燭', diceInterjection: makeCatalog()[2].diceInterjection }]);
});

test('findInterjectionOptions excludes diceCheckOnly items when sourceDeckType is null (leaveCheck/collapseCheck)', () => {
  const player = { inventory: [{ id: 'item_048' }] };
  const itemCatalog = [{ id: 'item_048', name: '海盜金幣', diceInterjection: { scope: 'diceCheckOnly', bonusDice: -1, consumesItem: true } }];
  expect(findInterjectionOptions(player, itemCatalog, null)).toEqual([]);
});

test('findInterjectionOptions includes diceCheckOnly items when sourceDeckType is undefined or a string (real dice_check)', () => {
  const player = { inventory: [{ id: 'item_048' }] };
  const itemCatalog = [{ id: 'item_048', name: '海盜金幣', diceInterjection: { scope: 'diceCheckOnly', bonusDice: -1, consumesItem: true } }];
  expect(findInterjectionOptions(player, itemCatalog, undefined)).toEqual([
    { itemId: 'item_048', name: '海盜金幣', diceInterjection: itemCatalog[0].diceInterjection },
  ]);
  expect(findInterjectionOptions(player, itemCatalog, 'event')).toEqual([
    { itemId: 'item_048', name: '海盜金幣', diceInterjection: itemCatalog[0].diceInterjection },
  ]);
});

test('findInterjectionOptions excludes a non-consumable item already used this turn', () => {
  const player = { inventory: [{ id: 'item_006' }], diceInterjectionUsedThisTurn: ['item_006'] };
  expect(findInterjectionOptions(player, makeCatalog(), undefined)).toEqual([]);
});

test('findInterjectionOptions still includes a consumable item even if its id happens to be in diceInterjectionUsedThisTurn', () => {
  // consumesItem items are removed from inventory on use, not tracked via
  // diceInterjectionUsedThisTurn -- this proves the "used this turn" filter
  // only applies to non-consumable items.
  const player = { inventory: [{ id: 'item_005' }], diceInterjectionUsedThisTurn: ['item_005'] };
  expect(findInterjectionOptions(player, makeCatalog(), undefined)).toEqual([
    { itemId: 'item_005', name: '天使羽毛', diceInterjection: makeCatalog()[0].diceInterjection },
  ]);
});

test('findInterjectionOptions ignores held items with no diceInterjection field', () => {
  const player = { inventory: [{ id: 'item_003' }] };
  expect(findInterjectionOptions(player, makeCatalog(), undefined)).toEqual([]);
});

test('findInterjectionOptions excludes a gear-category diceInterjection item when it is not worn', () => {
  const player = { inventory: [{ id: 'item_010' }], wornGearIds: [], diceInterjectionUsedThisTurn: [] };
  const itemCatalog = [
    { id: 'item_010', name: '油燈', category: 'gear', diceInterjection: { scope: 'eventTriggered', bonusDice: 1, consumesItem: false } },
  ];
  const options = findInterjectionOptions(player, itemCatalog, 'event');
  expect(options).toEqual([]);
});

test('findInterjectionOptions includes a gear-category diceInterjection item when it is worn', () => {
  const player = { inventory: [{ id: 'item_010' }], wornGearIds: ['item_010'], diceInterjectionUsedThisTurn: [] };
  const itemCatalog = [
    { id: 'item_010', name: '油燈', category: 'gear', diceInterjection: { scope: 'eventTriggered', bonusDice: 1, consumesItem: false } },
  ];
  const options = findInterjectionOptions(player, itemCatalog, 'event');
  expect(options).toEqual([{ itemId: 'item_010', name: '油燈', diceInterjection: { scope: 'eventTriggered', bonusDice: 1, consumesItem: false } }]);
});

test('findInterjectionOptions includes a non-gear diceInterjection item regardless of wornGearIds', () => {
  const player = { inventory: [{ id: 'item_006' }], wornGearIds: [], diceInterjectionUsedThisTurn: [] };
  const itemCatalog = [
    { id: 'item_006', name: '詭異人偶', category: 'reusable', diceInterjection: { scope: 'any', bonusDice: 2, consumesItem: false } },
  ];
  const options = findInterjectionOptions(player, itemCatalog, 'event');
  expect(options).toEqual([{ itemId: 'item_006', name: '詭異人偶', diceInterjection: { scope: 'any', bonusDice: 2, consumesItem: false } }]);
});

test('findInterjectionOptions throws INVALID_ITEM_CATALOG when itemCatalog is not an array', () => {
  const player = { inventory: [] };
  expect(() => findInterjectionOptions(player, null, undefined)).toThrow('INVALID_ITEM_CATALOG');
});

test('resolveFinalRoll with no chosen interjection rolls baseCount dice, clamped to [1,8]', () => {
  const rng = () => 0.99; // every die -> face 2
  expect(resolveFinalRoll(3, null, rng)).toBe(6); // 3 dice * 2
  expect(resolveFinalRoll(0, null, rng)).toBe(2); // clamped up to 1 die
  expect(resolveFinalRoll(10, null, rng)).toBe(16); // clamped down to 8 dice
});

test('resolveFinalRoll with a bonusDice interjection adds to the dice count before rolling', () => {
  const rng = () => 0.99; // every die -> face 2
  const di = { bonusDice: 2 };
  expect(resolveFinalRoll(3, di, rng)).toBe(10); // (3+2) dice * 2
});

test('resolveFinalRoll with an override interjection auto-substitutes the max possible roll for the default dice faces, ignoring rng', () => {
  const rng = () => { throw new Error('should not be called'); };
  const di = { override: true };
  expect(resolveFinalRoll(3, di, rng)).toBe(6); // 3 dice * default max face (2)
});

test('resolveFinalRoll with an override interjection uses the item\'s own customFaces max, if present', () => {
  const rng = () => { throw new Error('should not be called'); };
  const di = { override: true, customFaces: [3, 3, 4, 4, 5, 5] };
  expect(resolveFinalRoll(2, di, rng)).toBe(10); // 2 dice * custom max face (5)
});

test('resolveFinalRoll with an override interjection and tiers picks the pass:true tier, returning its min', () => {
  const rng = () => { throw new Error('should not be called'); };
  const di = { override: true };
  const tiers = [
    { min: 5, max: 8, pass: true },
    { min: 0, max: 4, pass: false },
  ];
  // baseCount 8 would auto-max to 8*2=16, which overshoots max:8 -- proves
  // the tier lookup is used INSTEAD of the auto-max computation, not just
  // as a fallback that happens to agree with it.
  expect(resolveFinalRoll(8, di, rng, tiers)).toBe(5); // picks the pass tier's min directly
});

test('resolveFinalRoll with an override interjection falls back to auto-max when tiers has no pass:true entry', () => {
  const rng = () => { throw new Error('should not be called'); };
  const di = { override: true };
  const tiers = [{ min: 0, max: 8, pass: false }];
  expect(resolveFinalRoll(3, di, rng, tiers)).toBe(6); // no pass:true tier -- falls back to 3 dice * default max face (2)
});
