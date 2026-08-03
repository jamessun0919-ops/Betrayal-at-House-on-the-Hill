let promptCounter = 0;

function generatePromptId() {
  promptCounter += 1;
  return `prompt_${promptCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPromptState() {
  return { pending: null };
}

function createPrompt(container, { type, targetPlayerId, description, options, timeoutMs, now }) {
  if (container.pending !== null) {
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
  container.pending = prompt;
  return prompt;
}

function respondToPrompt(container, { promptId, playerId, optionId }) {
  const pending = container.pending;
  if (!pending || pending.promptId !== promptId) {
    throw new Error('PROMPT_MISMATCH');
  }
  if (pending.targetPlayerId !== playerId) {
    throw new Error('PROMPT_FORBIDDEN');
  }
  if (!pending.options.includes(optionId)) {
    throw new Error('INVALID_PROMPT_OPTION');
  }
  container.pending = null;
  return { promptId, chosenOptionId: optionId, wasTimeout: false };
}

function resolvePromptTimeout(container, { promptId, defaultOptionId }) {
  const pending = container.pending;
  if (!pending || pending.promptId !== promptId) {
    return null;
  }
  container.pending = null;
  return { promptId, chosenOptionId: defaultOptionId, wasTimeout: true };
}

function getPendingPrompt(container) {
  return container.pending;
}

module.exports = {
  createPromptState,
  createPrompt,
  respondToPrompt,
  resolvePromptTimeout,
  getPendingPrompt,
};
