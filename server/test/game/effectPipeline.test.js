const { rollDice, applyModifiers, evaluateTiers } = require('../../src/game/effectPipeline');

test('rollDice returns 0 for zero dice without calling rng', () => {
  const rng = jest.fn();
  expect(rollDice(0, rng)).toBe(0);
  expect(rng).not.toHaveBeenCalled();
});

test('rollDice sums faces from the custom 0/0/1/1/2/2 die using the injected rng', () => {
  // 6 equal-width buckets over [0,1): indices 0,1 -> face 0; 2,3 -> face 1; 4,5 -> face 2
  const values = [0, 0.2, 0.4, 0.6, 0.8, 0.99]; // -> indices 0,1,2,3,4,5 -> faces 0,0,1,1,2,2
  let call = 0;
  const rng = () => values[call++];
  expect(rollDice(6, rng)).toBe(0 + 0 + 1 + 1 + 2 + 2); // 6
});

test('rollDice defaults to Math.random when no rng is given', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.99); // -> face 2
  expect(rollDice(3)).toBe(6);
  jest.restoreAllMocks();
});

test('rollDice uses a custom faces array when provided, instead of the default DIE_FACES', () => {
  const values = [0, 0.2, 0.4, 0.6, 0.8, 0.99]; // -> indices 0..5
  let call = 0;
  const rng = () => values[call++];
  const customFaces = [1, 1, 1, 2, 2, 2]; // same bucket layout as DIE_FACES, shifted up by 1 for indices 0-1
  expect(rollDice(6, rng, customFaces)).toBe(1 + 1 + 1 + 2 + 2 + 2); // 9, vs 6 with the default DIE_FACES
});

test('rollDice falls back to the default DIE_FACES when faces is not provided', () => {
  const rng = () => 0; // index 0
  expect(rollDice(1, rng)).toBe(0); // DIE_FACES[0] === 0
});

test('rollDice throws INVALID_DICE_COUNT for a negative or non-integer count', () => {
  expect(() => rollDice(-1)).toThrow('INVALID_DICE_COUNT');
  expect(() => rollDice(1.5)).toThrow('INVALID_DICE_COUNT');
  expect(() => rollDice(undefined)).toThrow('INVALID_DICE_COUNT');
});

test('applyModifiers returns the value unchanged when there are no modifiers', () => {
  expect(applyModifiers(5, [], 'onBeforeRoll')).toBe(5);
});

test('applyModifiers adds matching-hookType deltas', () => {
  const modifiers = [{ effects: [{ hookType: 'onBeforeRoll', delta: 2 }] }];
  expect(applyModifiers(5, modifiers, 'onBeforeRoll')).toBe(7);
});

test('applyModifiers ignores effects whose hookType does not match', () => {
  const modifiers = [{ effects: [{ hookType: 'onAfterRoll', delta: 2 }] }];
  expect(applyModifiers(5, modifiers, 'onBeforeRoll')).toBe(5);
});

test('applyModifiers only applies a checkContext-scoped effect when the context matches', () => {
  const modifiers = [{ effects: [{ hookType: 'onEventCardCheck', delta: 1, checkContext: 'event' }] }];
  expect(applyModifiers(5, modifiers, 'onEventCardCheck', { checkContext: 'event' })).toBe(6);
  expect(applyModifiers(5, modifiers, 'onEventCardCheck', { checkContext: 'might_attack' })).toBe(5);
});

test('applyModifiers sums deltas across multiple modifiers and multiple matching effects', () => {
  const modifiers = [
    { effects: [{ hookType: 'onBeforeRoll', delta: 1 }] },
    { effects: [{ hookType: 'onBeforeRoll', delta: 2 }, { hookType: 'onAfterRoll', delta: 100 }] },
  ];
  expect(applyModifiers(5, modifiers, 'onBeforeRoll')).toBe(8);
});

test('applyModifiers throws INVALID_MODIFIER_LIST for a non-array modifiers argument', () => {
  expect(() => applyModifiers(5, null, 'onBeforeRoll')).toThrow('INVALID_MODIFIER_LIST');
  expect(() => applyModifiers(5, undefined, 'onBeforeRoll')).toThrow('INVALID_MODIFIER_LIST');
});

test('applyModifiers throws INVALID_MODIFIER_EFFECTS when a modifier entry has no valid effects array', () => {
  expect(() => applyModifiers(5, [{ effects: undefined }], 'onBeforeRoll')).toThrow('INVALID_MODIFIER_EFFECTS');
  expect(() => applyModifiers(5, [{}], 'onBeforeRoll')).toThrow('INVALID_MODIFIER_EFFECTS');
});

test('evaluateTiers picks the first tier whose min/max range contains the roll (inclusive)', () => {
  const tiers = [
    { min: 5, max: 8, effects: ['high'] },
    { min: 1, max: 4, effects: ['mid'] },
    { min: 0, max: 0, effects: ['low'] },
  ];
  expect(evaluateTiers(5, tiers).effects).toEqual(['high']);
  expect(evaluateTiers(8, tiers).effects).toEqual(['high']);
  expect(evaluateTiers(4, tiers).effects).toEqual(['mid']);
  expect(evaluateTiers(0, tiers).effects).toEqual(['low']);
});

test('evaluateTiers uses the first matching tier when ranges overlap', () => {
  const tiers = [
    { min: 0, max: 10, effects: ['first'] },
    { min: 5, max: 10, effects: ['second'] },
  ];
  expect(evaluateTiers(7, tiers).effects).toEqual(['first']);
});

test('evaluateTiers throws NO_MATCHING_TIER when no range contains the roll', () => {
  const tiers = [{ min: 5, max: 8, effects: [] }];
  expect(() => evaluateTiers(2, tiers)).toThrow('NO_MATCHING_TIER');
});

test('evaluateTiers throws INVALID_TIERS for a non-array or empty tiers argument', () => {
  expect(() => evaluateTiers(5, [])).toThrow('INVALID_TIERS');
  expect(() => evaluateTiers(5, null)).toThrow('INVALID_TIERS');
});
