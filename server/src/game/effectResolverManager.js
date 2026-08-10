const { createPromptState } = require('./promptState');

function createEffectResolverManager() {
  return { resolvers: new Map() };
}

function startResolver(manager, roomCode) {
  if (manager.resolvers.has(roomCode)) {
    throw new Error('RESOLVER_ALREADY_STARTED');
  }
  const entry = { promptState: createPromptState(), pendingChoice: null, pendingRollChoice: null };
  manager.resolvers.set(roomCode, entry);
  return entry;
}

function getResolver(manager, roomCode) {
  return manager.resolvers.get(roomCode);
}

function endResolver(manager, roomCode) {
  manager.resolvers.delete(roomCode);
}

module.exports = { createEffectResolverManager, startResolver, getResolver, endResolver };
