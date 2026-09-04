const {
  createEffectResolverManager,
  startResolver,
  getResolver,
  endResolver,
} = require('../../src/game/effectResolverManager');

test('startResolver creates an entry with a promptState and no pending choice', () => {
  const manager = createEffectResolverManager();
  const entry = startResolver(manager, 'ROOM1');
  expect(entry.promptState).toEqual({ pending: new Map() });
  expect(entry.pendingChoice.size).toBe(0);
  expect(entry.pendingRollChoice.size).toBe(0);
  expect(getResolver(manager, 'ROOM1')).toBe(entry);
});

test('startResolver throws RESOLVER_ALREADY_STARTED for a roomCode already in progress', () => {
  const manager = createEffectResolverManager();
  startResolver(manager, 'ROOM1');
  expect(() => startResolver(manager, 'ROOM1')).toThrow('RESOLVER_ALREADY_STARTED');
});

test('getResolver returns undefined for an unknown roomCode', () => {
  const manager = createEffectResolverManager();
  expect(getResolver(manager, 'UNKNOWN')).toBeUndefined();
});

test('endResolver removes the entry and is a no-op for an unknown roomCode', () => {
  const manager = createEffectResolverManager();
  startResolver(manager, 'ROOM1');
  endResolver(manager, 'ROOM1');
  expect(getResolver(manager, 'ROOM1')).toBeUndefined();
  expect(() => endResolver(manager, 'NEVER_STARTED')).not.toThrow();
});
