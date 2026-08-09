const { attachModifier, removeModifier, checkRemoveConditions } = require('../../src/game/modifiers');

test('attachModifier lazily creates entity.modifiers and pushes the new modifier', () => {
  const player = {};
  const modifier = attachModifier(player, {
    effects: [{ hookType: 'onEventCardCheck', delta: 1, checkContext: 'event' }],
    removeWhen: { type: 'holdsItem', itemId: 'item_010' },
  });
  expect(player.modifiers).toEqual([modifier]);
  expect(modifier.id).toEqual(expect.any(String));
  expect(modifier.removeWhen).toEqual({ type: 'holdsItem', itemId: 'item_010' });
});

test('attachModifier generates distinct ids across calls', () => {
  const player = {};
  const first = attachModifier(player, { effects: [{ hookType: 'onBeforeRoll', delta: 1 }], removeWhen: { type: 'leavesRoom' } });
  const second = attachModifier(player, { effects: [{ hookType: 'onBeforeRoll', delta: 1 }], removeWhen: { type: 'leavesRoom' } });
  expect(first.id).not.toBe(second.id);
  expect(player.modifiers).toHaveLength(2);
});

test('attachModifier works on a room entity the same way as a player entity', () => {
  const room = { roomId: 'room_1' };
  attachModifier(room, { effects: [{ hookType: 'onBeforeRoll', delta: -1 }], removeWhen: { type: 'leavesRoom' } });
  expect(room.modifiers).toHaveLength(1);
});

test('attachModifier throws INVALID_MODIFIER_EFFECTS for missing or empty effects', () => {
  expect(() => attachModifier({}, { effects: [], removeWhen: { type: 'leavesRoom' } })).toThrow('INVALID_MODIFIER_EFFECTS');
  expect(() => attachModifier({}, { removeWhen: { type: 'leavesRoom' } })).toThrow('INVALID_MODIFIER_EFFECTS');
});

test('attachModifier throws INVALID_REMOVE_WHEN for a malformed removeWhen', () => {
  const effects = [{ hookType: 'onBeforeRoll', delta: 1 }];
  expect(() => attachModifier({}, { effects, removeWhen: {} })).toThrow('INVALID_REMOVE_WHEN');
  expect(() => attachModifier({}, { effects, removeWhen: null })).toThrow('INVALID_REMOVE_WHEN');
});

test('attachModifier allows an omitted removeWhen for a permanent modifier with no removal condition', () => {
  const player = {};
  const modifier = attachModifier(player, { effects: [{ hookType: 'onBeforeRoll', delta: -1 }] });
  expect(modifier.removeWhen).toBeUndefined();
  expect(player.modifiers).toEqual([modifier]);
});

test('checkRemoveConditions never matches a permanent modifier that has no removeWhen', () => {
  const player = {};
  attachModifier(player, { effects: [{ hookType: 'onBeforeRoll', delta: -1 }] });
  const removed = checkRemoveConditions(player, { type: 'meetsAnotherPlayer' });
  expect(removed).toEqual([]);
  expect(player.modifiers).toHaveLength(1);
});

test('removeModifier removes the matching modifier by id', () => {
  const player = {};
  const a = attachModifier(player, { effects: [{ hookType: 'onBeforeRoll', delta: 1 }], removeWhen: { type: 'leavesRoom' } });
  const b = attachModifier(player, { effects: [{ hookType: 'onBeforeRoll', delta: 1 }], removeWhen: { type: 'leavesRoom' } });
  removeModifier(player, a.id);
  expect(player.modifiers).toEqual([b]);
});

test('removeModifier throws MODIFIER_NOT_FOUND when the id is not present', () => {
  const player = { modifiers: [] };
  expect(() => removeModifier(player, 'unknown')).toThrow('MODIFIER_NOT_FOUND');
});

test('checkRemoveConditions removes modifiers whose removeWhen.type matches the context type', () => {
  const player = {};
  attachModifier(player, { effects: [{ hookType: 'onBeforeRoll', delta: 1 }], removeWhen: { type: 'meetsAnotherPlayer' } });
  attachModifier(player, { effects: [{ hookType: 'onBeforeRoll', delta: 1 }], removeWhen: { type: 'leavesRoom' } });
  const removed = checkRemoveConditions(player, { type: 'meetsAnotherPlayer' });
  expect(removed).toHaveLength(1);
  expect(removed[0].removeWhen.type).toBe('meetsAnotherPlayer');
  expect(player.modifiers).toHaveLength(1);
  expect(player.modifiers[0].removeWhen.type).toBe('leavesRoom');
});

test('checkRemoveConditions for holdsItem only matches when itemId also matches', () => {
  const player = {};
  attachModifier(player, { effects: [{ hookType: 'onBeforeRoll', delta: 1 }], removeWhen: { type: 'holdsItem', itemId: 'item_010' } });
  const notRemoved = checkRemoveConditions(player, { type: 'holdsItem', itemId: 'item_099' });
  expect(notRemoved).toEqual([]);
  expect(player.modifiers).toHaveLength(1);
  const removed = checkRemoveConditions(player, { type: 'holdsItem', itemId: 'item_010' });
  expect(removed).toHaveLength(1);
  expect(player.modifiers).toHaveLength(0);
});

test('checkRemoveConditions returns an empty array and does not throw when entity.modifiers is undefined', () => {
  const player = {};
  expect(checkRemoveConditions(player, { type: 'meetsAnotherPlayer' })).toEqual([]);
});
