let promptCounter = 0;

function generatePromptId() {
  promptCounter += 1;
  return `prompt_${promptCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPromptState() {
  return { pending: new Map() };
}

function createPrompt(container, { type, targetPlayerId, description, options, timeoutMs, now }) {
  if (container.pending.has(targetPlayerId)) {
    throw new Error('PROMPT_ALREADY_PENDING');
  }
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('INVALID_PROMPT_OPTIONS');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('INVALID_TIMEOUT');
  }
  const prompt = {
    promptId: generatePromptId(),
    type,
    targetPlayerId,
    description,
    options,
    deadline: now + timeoutMs,
  };
  container.pending.set(targetPlayerId, prompt);
  return prompt;
}

function respondToPrompt(container, { promptId, playerId, optionId }) {
  const pending = container.pending.get(playerId);
  if (!pending || pending.promptId !== promptId) {
    throw new Error('PROMPT_MISMATCH');
  }
  if (pending.targetPlayerId !== playerId) {
    throw new Error('PROMPT_FORBIDDEN');
  }
  if (!pending.options.includes(optionId)) {
    throw new Error('INVALID_PROMPT_OPTION');
  }
  container.pending.delete(playerId);
  return { promptId, chosenOptionId: optionId, wasTimeout: false };
}

function resolvePromptTimeout(container, { playerId, promptId, defaultOptionId }) {
  const pending = container.pending.get(playerId);
  if (!pending || pending.promptId !== promptId) {
    return null;
  }
  container.pending.delete(playerId);
  return { promptId, chosenOptionId: defaultOptionId, wasTimeout: true };
}

function getPendingPrompt(container, playerId) {
  return container.pending.get(playerId) || null;
}

module.exports = {
  createPromptState,
  createPrompt,
  respondToPrompt,
  resolvePromptTimeout,
  getPendingPrompt,
};
