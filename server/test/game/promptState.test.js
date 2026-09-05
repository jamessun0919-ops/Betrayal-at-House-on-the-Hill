const {
  createPromptState,
  createPrompt,
  respondToPrompt,
  resolvePromptTimeout,
  getPendingPrompt,
} = require('../../src/game/promptState');

function makePromptInput(overrides = {}) {
  return {
    type: 'character_select',
    targetPlayerId: 'p1',
    description: '請選擇角色',
    options: ['char_001', 'char_002'],
    timeoutMs: 30000,
    now: 1000,
    ...overrides,
  };
}

test('createPromptState starts with no pending prompt', () => {
  const container = createPromptState();
  expect(getPendingPrompt(container, 'p1')).toBeNull();
});

test('createPrompt sets the pending prompt with a computed deadline', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  expect(prompt.targetPlayerId).toBe('p1');
  expect(prompt.deadline).toBe(31000); // now(1000) + timeoutMs(30000)
  expect(getPendingPrompt(container, 'p1')).toEqual(prompt);
});

test('createPrompt throws PROMPT_ALREADY_PENDING when the SAME player already has one pending', () => {
  const container = createPromptState();
  createPrompt(container, makePromptInput({ targetPlayerId: 'p1' }));
  expect(() => createPrompt(container, makePromptInput({ targetPlayerId: 'p1' }))).toThrow('PROMPT_ALREADY_PENDING');
});

test('createPrompt does NOT throw when a DIFFERENT player has a pending prompt -- each player has their own independent slot', () => {
  const container = createPromptState();
  createPrompt(container, makePromptInput({ targetPlayerId: 'p1' }));
  expect(() => createPrompt(container, makePromptInput({ targetPlayerId: 'p2' }))).not.toThrow();
  expect(getPendingPrompt(container, 'p1')).not.toBeNull();
  expect(getPendingPrompt(container, 'p2')).not.toBeNull();
});

test('createPrompt throws INVALID_PROMPT_OPTIONS for missing or empty options', () => {
  const container = createPromptState();
  expect(() => createPrompt(container, makePromptInput({ options: [] }))).toThrow('INVALID_PROMPT_OPTIONS');
  expect(() => createPrompt(container, makePromptInput({ options: undefined }))).toThrow('INVALID_PROMPT_OPTIONS');
});

test('createPrompt throws INVALID_TIMEOUT for a non-positive-integer timeoutMs', () => {
  const container = createPromptState();
  expect(() => createPrompt(container, makePromptInput({ timeoutMs: 0 }))).toThrow('INVALID_TIMEOUT');
  expect(() => createPrompt(container, makePromptInput({ timeoutMs: -5 }))).toThrow('INVALID_TIMEOUT');
  expect(() => createPrompt(container, makePromptInput({ timeoutMs: 1.5 }))).toThrow('INVALID_TIMEOUT');
});

test('respondToPrompt resolves the prompt and clears pending state', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  const result = respondToPrompt(container, { promptId: prompt.promptId, playerId: 'p1', optionId: 'char_002' });
  expect(result).toEqual({ promptId: prompt.promptId, chosenOptionId: 'char_002', wasTimeout: false });
  expect(getPendingPrompt(container, 'p1')).toBeNull();
});

test('respondToPrompt throws PROMPT_MISMATCH for a stale or wrong promptId', () => {
  const container = createPromptState();
  createPrompt(container, makePromptInput());
  expect(() =>
    respondToPrompt(container, { promptId: 'not-the-real-id', playerId: 'p1', optionId: 'char_001' })
  ).toThrow('PROMPT_MISMATCH');
});

test('respondToPrompt throws PROMPT_MISMATCH when the responder is not the target player (no pending prompt for that player)', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  expect(() =>
    respondToPrompt(container, { promptId: prompt.promptId, playerId: 'someone-else', optionId: 'char_001' })
  ).toThrow('PROMPT_MISMATCH');
});

test('respondToPrompt throws INVALID_PROMPT_OPTION for an option not in the list', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  expect(() =>
    respondToPrompt(container, { promptId: prompt.promptId, playerId: 'p1', optionId: 'not_an_option' })
  ).toThrow('INVALID_PROMPT_OPTION');
});

test('resolvePromptTimeout resolves with the default option and clears pending state', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  const result = resolvePromptTimeout(container, { playerId: 'p1', promptId: prompt.promptId, defaultOptionId: 'char_001' });
  expect(result).toEqual({ promptId: prompt.promptId, chosenOptionId: 'char_001', wasTimeout: true });
  expect(getPendingPrompt(container, 'p1')).toBeNull();
});

test('resolvePromptTimeout is a no-op (returns null) if the prompt was already resolved by a real response', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  respondToPrompt(container, { promptId: prompt.promptId, playerId: 'p1', optionId: 'char_001' });
  // The real timer for the same prompt fires late, after the response already resolved it.
  const result = resolvePromptTimeout(container, { playerId: 'p1', promptId: prompt.promptId, defaultOptionId: 'char_002' });
  expect(result).toBeNull();
});
