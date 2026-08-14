const { resolveEffects, resolveChoiceOption, computeInterjectedRoll } = require('../../src/game/effectResolver');
const { createGameState, addPlayer } = require('../../src/game/gameState');
const { createPromptState, respondToPrompt } = require('../../src/game/promptState');

const STARTING_ROOMS = [
  { id: 'room_lobby_a', name: '大門廳', floor: 'ground' },
  { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
  { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

function makeGameStateWithPlayer(playerId = 'p1', cards = {}) {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_x', doors: 2 }], cards);
  addPlayer(gameState, { playerId, name: 'Alice', stats: makeStats() });
  return gameState;
}

test('resolveEffects applies a stat_change delta', () => {
  const gameState = makeGameStateWithPlayer();
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', delta: 1 },
  ]);
  expect(result).toEqual({ pending: false, appliedCount: 1 });
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(3); // baseIndex 2 + 1
});

test('resolveEffects restores a stat to its baseIndex when restoreToBase is set', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.stats.might.currentIndex = 0; // dropped below base (baseIndex 2)
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', restoreToBase: true },
  ]);
  expect(player.stats.might.currentIndex).toBe(2);
});

test('resolveEffects does not lower a stat that is already at or above baseIndex when restoreToBase is set', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.stats.might.currentIndex = 4; // already above base (baseIndex 2)
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', restoreToBase: true },
  ]);
  expect(player.stats.might.currentIndex).toBe(4); // unchanged, restoreToBase only raises
});

test('resolveEffects processes multiple effects in order', () => {
  const gameState = makeGameStateWithPlayer();
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', delta: 1 },
    { type: 'stat_change', stat: 'speed', delta: -1 },
  ]);
  const player = gameState.players.get('p1');
  expect(player.stats.might.currentIndex).toBe(3);
  expect(player.stats.speed.currentIndex).toBe(1);
});

test('resolveEffects grant_item adds the item to the player inventory', () => {
  const gameState = makeGameStateWithPlayer();
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'grant_item', itemId: 'item_001' },
  ]);
  expect(gameState.players.get('p1').inventory).toEqual([{ id: 'item_001' }]);
});

test('resolveEffects lose_item removes the item from the player inventory', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_001' });
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'lose_item', itemId: 'item_001' },
  ]);
  expect(player.inventory).toEqual([]);
});

test('resolveEffects lose_item propagates ITEM_NOT_FOUND when the player does not hold it', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'lose_item', itemId: 'not_held' }])
  ).toThrow('ITEM_NOT_FOUND');
});

test('resolveEffects toggle_active applies activeEffects and marks the item active when it was inactive', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'omen_008' });
  resolveEffects(gameState, createPromptState(), 'p1', [{
    type: 'toggle_active',
    itemId: 'omen_008',
    activeEffects: [{ type: 'stat_change', stat: 'knowledge', delta: 2 }, { type: 'stat_change', stat: 'sanity', delta: -2 }],
    inactiveEffects: [{ type: 'stat_change', stat: 'knowledge', delta: -2 }, { type: 'stat_change', stat: 'sanity', delta: 2 }],
  }]);
  expect(player.inventory).toEqual([{ id: 'omen_008', active: true }]);
  expect(player.stats.knowledge.currentIndex).toBe(3); // baseIndex 1 + 2
  expect(player.stats.sanity.currentIndex).toBe(1); // baseIndex 2 - 2, clamped to the pre-haunt floor (skullIndex 0 + 1)
});

test('resolveEffects toggle_active applies inactiveEffects and marks the item inactive when it was active', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'omen_008', active: true });
  resolveEffects(gameState, createPromptState(), 'p1', [{
    type: 'toggle_active',
    itemId: 'omen_008',
    activeEffects: [{ type: 'stat_change', stat: 'knowledge', delta: 2 }, { type: 'stat_change', stat: 'sanity', delta: -2 }],
    inactiveEffects: [{ type: 'stat_change', stat: 'knowledge', delta: -2 }, { type: 'stat_change', stat: 'sanity', delta: 2 }],
  }]);
  expect(player.inventory).toEqual([{ id: 'omen_008', active: false }]);
  expect(player.stats.knowledge.currentIndex).toBe(1); // baseIndex 1 - 2, clamped to the pre-haunt floor (skullIndex 0 + 1)
  expect(player.stats.sanity.currentIndex).toBe(4); // baseIndex 2 + 2
});

test('resolveEffects toggle_active throws ITEM_NOT_HELD when the player does not hold the item', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{
      type: 'toggle_active', itemId: 'omen_008', activeEffects: [], inactiveEffects: [],
    }])
  ).toThrow('ITEM_NOT_HELD');
});

test('resolveEffects switch_control creates player.summons at the player\'s current position', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.floor = 'ground';
  player.x = 3;
  player.y = -2;
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'switch_control', summonType: 'spiritDog', actionPoints: 6 },
  ]);
  expect(player.summons).toEqual({
    type: 'spiritDog',
    floor: 'ground',
    x: 3,
    y: -2,
    actionPoints: 6,
    carryingItemId: null,
  });
  expect(player.summonUsedThisTurn).toBe(true);
});

test('resolveEffects switch_control throws SUMMON_ALREADY_USED_THIS_TURN on a second switch in the same turn', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  const effect = { type: 'switch_control', summonType: 'spiritDog', actionPoints: 6 };
  resolveEffects(gameState, createPromptState(), 'p1', [effect]);
  // Dissipate the first summon so only the once-per-turn flag can block the retry.
  player.summons = null;
  expect(() => resolveEffects(gameState, createPromptState(), 'p1', [effect])).toThrow(
    'SUMMON_ALREADY_USED_THIS_TURN'
  );
});

test('resolveEffects switch_control throws SUMMON_ALREADY_ACTIVE when a summon is already out', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null };
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [
      { type: 'switch_control', summonType: 'spiritDog', actionPoints: 6 },
    ])
  ).toThrow('SUMMON_ALREADY_ACTIVE');
});

test('resolveEffects switch_control throws INVALID_SWITCH_CONTROL_EFFECT for a missing or non-string summonType', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'switch_control', actionPoints: 6 }])
  ).toThrow('INVALID_SWITCH_CONTROL_EFFECT');
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'switch_control', summonType: '', actionPoints: 6 }])
  ).toThrow('INVALID_SWITCH_CONTROL_EFFECT');
});

test('resolveEffects switch_control throws INVALID_SWITCH_CONTROL_EFFECT for missing or non-positive actionPoints', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'switch_control', summonType: 'spiritDog' }])
  ).toThrow('INVALID_SWITCH_CONTROL_EFFECT');
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [
      { type: 'switch_control', summonType: 'spiritDog', actionPoints: 0 },
    ])
  ).toThrow('INVALID_SWITCH_CONTROL_EFFECT');
});

test('resolveEffects draw_card draws the requested count from the given deck, adds them to inventory, and reports appliedCount/drawnCards', () => {
  const gameState = makeGameStateWithPlayer('p1', {
    items: [
      { id: 'item_a', name: 'A', effects: [] },
      { id: 'item_b', name: 'B', effects: [] },
    ],
  });
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'draw_card', deck: 'item', count: 2 },
  ]);
  expect(result.appliedCount).toBe(2);
  // createCardDeck shuffles on creation, so with both cards drawn the order
  // is not deterministic -- compare as sets.
  expect([...result.drawnCards].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
    { id: 'item_a', name: 'A' },
    { id: 'item_b', name: 'B' },
  ]);
  expect([...gameState.players.get('p1').inventory].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
    { id: 'item_a' },
    { id: 'item_b' },
  ]);
});

test('resolveEffects draw_card stops early and reports a partial appliedCount when the deck runs out', () => {
  const gameState = makeGameStateWithPlayer('p1', {
    items: [{ id: 'item_a', name: 'A', effects: [] }],
  });
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'draw_card', deck: 'item', count: 2 },
  ]);
  expect(result.appliedCount).toBe(1);
  expect(result.drawnCards).toEqual([{ id: 'item_a', name: 'A' }]);
  expect(gameState.players.get('p1').inventory).toEqual([{ id: 'item_a' }]);
});

test('resolveEffects draw_card reports appliedCount 0 and no drawnCards key when the deck is already empty', () => {
  const gameState = makeGameStateWithPlayer('p1', { items: [] });
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'draw_card', deck: 'item', count: 2 },
  ]);
  expect(result).toEqual({ pending: false, appliedCount: 0 });
});

test('resolveEffects draw_card throws UNKNOWN_DECK_TYPE for an unrecognized deck', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'draw_card', deck: 'monster', count: 1 }])
  ).toThrow('UNKNOWN_DECK_TYPE');
});

test('resolveEffects persistent_modifier attaches to the player by default', () => {
  const gameState = makeGameStateWithPlayer();
  resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'persistent_modifier',
      appliesTo: 'player',
      effects: [{ hookType: 'onEventCardCheck', delta: 1, checkContext: 'event' }],
      removeWhen: { type: 'holdsItem', itemId: 'item_010' },
    },
  ]);
  expect(gameState.players.get('p1').modifiers).toHaveLength(1);
});

test('resolveEffects persistent_modifier attaches to the room the player currently stands in', () => {
  const gameState = makeGameStateWithPlayer();
  resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'persistent_modifier',
      appliesTo: 'room',
      effects: [{ hookType: 'onBeforeRoll', delta: -1 }],
      removeWhen: { type: 'leavesRoom' },
    },
  ]);
  const room = gameState.board.ground.get('0,0'); // player starts at entrance hall (0,0)
  expect(room.modifiers).toHaveLength(1);
});

test('resolveEffects throws INVALID_EFFECTS_LIST for a non-array effects argument', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() => resolveEffects(gameState, createPromptState(), 'p1', null)).toThrow('INVALID_EFFECTS_LIST');
});

test('resolveEffects throws PLAYER_NOT_FOUND for an unknown playerId', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'unknown', [{ type: 'stat_change', stat: 'might', delta: 1 }])
  ).toThrow('PLAYER_NOT_FOUND');
});

test('resolveEffects throws UNSUPPORTED_EFFECT_TYPE for an unknown effect type', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'not_a_real_type' }])
  ).toThrow('UNSUPPORTED_EFFECT_TYPE');
});

test('resolveEffects throws UNSUPPORTED_EFFECT_TYPE for peek_and_reorder (not implemented in M2c-1)', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'peek_and_reorder', deckType: 'item', count: 2 }])
  ).toThrow('UNSUPPORTED_EFFECT_TYPE');
});

test('resolveEffects dice_check with an explicit diceCount picks the matching tier and applies its nested effects', () => {
  const gameState = makeGameStateWithPlayer();
  // rng sequence -> 3 dice, faces [1,1,1] sum=3
  const values = [0.5, 0.5, 0.5];
  let call = 0;
  const rng = () => values[call++];
  resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 3,
      tiers: [
        { min: 5, max: 6, effects: [{ type: 'stat_change', stat: 'might', delta: 2 }] },
        { min: 0, max: 4, effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
      ],
    },
  ], { rng });
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(1); // baseIndex 2 - 1
});

test('resolveEffects dice_check with a stat field rolls a dice count equal to that stat value', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.stats.knowledge.currentIndex = 0; // getStatValue -> track[0] = 1
  const rng = jest.fn().mockReturnValue(0.99); // every die -> face 2
  resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      stat: 'knowledge',
      tiers: [{ min: 0, max: 8, effects: [] }],
    },
  ], { rng });
  expect(rng).toHaveBeenCalledTimes(1); // knowledge value = 1 -> 1 die rolled
});

test('resolveEffects dice_check applies onBeforeRoll/onAfterRoll modifiers from the player before/after rolling', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.modifiers = [
    { effects: [{ hookType: 'onBeforeRoll', delta: 1 }, { hookType: 'onAfterRoll', delta: 10 }] },
  ];
  const rng = jest.fn().mockReturnValue(0); // every die -> face 0
  resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 1, // onBeforeRoll bumps this to 2 dice, but both roll 0 -> sum 0, onAfterRoll adds 10 -> 10
      tiers: [{ min: 10, max: 10, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
    },
  ], { rng });
  expect(rng).toHaveBeenCalledTimes(2);
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(3);
});

test('resolveEffects dice_check clamps an onBeforeRoll-reduced dice count to a minimum of 1', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.modifiers = [{ effects: [{ hookType: 'onBeforeRoll', delta: -1 }] }]; // e.g. 滴答聲
  const rng = jest.fn().mockReturnValue(0);
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'dice_check', diceCount: 1, tiers: [{ min: 0, max: 8, effects: [] }] }, // would go to 0 without the clamp
  ], { rng });
  expect(rng).toHaveBeenCalledTimes(1); // clamped to 1 die, not 0
});

test('resolveEffects dice_check clamps an onBeforeRoll-increased dice count to a maximum of 8', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.modifiers = [{ effects: [{ hookType: 'onBeforeRoll', delta: 5 }] }]; // e.g. 祈禱聲
  const rng = jest.fn().mockReturnValue(0);
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'dice_check', diceCount: 6, tiers: [{ min: 0, max: 8, effects: [] }] }, // would go to 11 without the clamp
  ], { rng });
  expect(rng).toHaveBeenCalledTimes(8); // clamped to 8 dice, not 11
});

test('resolveEffects dice_check throws INVALID_DICE_CHECK_COUNT when neither stat nor diceCount is usable', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'dice_check', tiers: [{ min: 0, max: 8, effects: [] }] }])
  ).toThrow('INVALID_DICE_CHECK_COUNT');
});

test('resolveEffects dice_check with no matching interjection items rolls immediately (unchanged behavior)', () => {
  const gameState = makeGameStateWithPlayer();
  const rng = jest.fn().mockReturnValue(0.99); // every die -> face 2
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 2,
      tiers: [{ min: 4, max: 4, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
    },
  ], { rng, itemCatalog: [] });
  expect(result.pending).toBe(false);
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(3); // baseIndex 2 + 1
});

test('resolveEffects dice_check with a matching interjection item held pauses and returns rollChoice pending', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_006' });
  const itemCatalog = [{
    id: 'item_006',
    name: '詭異人偶',
    diceInterjection: { scope: 'any', bonusDice: 2, cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }], consumesItem: false },
  }];
  const effect = {
    type: 'dice_check',
    diceCount: 2,
    tiers: [{ min: 0, max: 8, effects: [] }],
  };
  const result = resolveEffects(gameState, createPromptState(), 'p1', [effect], { itemCatalog });
  expect(result.pending).toBe(true);
  expect(result.rollChoice).toBe(true);
  expect(result.baseCount).toBe(2);
  expect(result.options).toEqual([{ itemId: 'item_006', name: '詭異人偶', diceInterjection: itemCatalog[0].diceInterjection }]);
  expect(result.effect).toBe(effect);
  // Nothing rolled or applied yet -- still waiting on the player's choice.
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex);
});

test('resolveEffects dice_check resumed with interjectionChoice:null (skipped) rolls normally with no bonus', () => {
  const gameState = makeGameStateWithPlayer();
  const rng = jest.fn().mockReturnValue(0.99); // every die -> face 2
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 2,
      tiers: [{ min: 4, max: 4, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
    },
  ], { rng, interjectionChoice: null }); // itemCatalog irrelevant -- scan is skipped once interjectionChoice is defined
  expect(result.pending).toBe(false);
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(3);
});

test('resolveEffects dice_check resumed with a chosen bonusDice item applies its cost, adds dice, and marks it used', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_006' });
  const rng = jest.fn().mockReturnValue(0.99); // every die -> face 2
  const diceInterjection = { scope: 'any', bonusDice: 2, cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }], consumesItem: false };
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 2,
      tiers: [{ min: 8, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
    },
  ], { rng, interjectionChoice: { itemId: 'item_006', diceInterjection, overrideValue: undefined } });
  expect(result.pending).toBe(false);
  expect(player.stats.might.currentIndex).toBe(3); // tier matched sum=8 -> (2+2 dice)*2=8
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex - 1); // cost applied
  expect(player.diceInterjectionUsedThisTurn).toEqual(['item_006']); // not consumable -- tracked as used
  expect(player.inventory).toEqual([{ id: 'item_006' }]); // still held
});

test('resolveEffects dice_check resumed with a chosen override item returns the override value directly and removes the consumable item', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_005' });
  const diceInterjection = { scope: 'any', override: true, consumesItem: true };
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 2,
      tiers: [
        { min: 5, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] },
        { min: 0, max: 4, effects: [] },
      ],
    },
  ], {
    rng: () => { throw new Error('should not roll when overriding'); },
    interjectionChoice: { itemId: 'item_005', diceInterjection, overrideValue: 6 },
  });
  expect(result.pending).toBe(false);
  expect(player.stats.might.currentIndex).toBe(3); // override 6 -> matched the 5-8 tier
  expect(player.inventory).toEqual([]); // consumable item removed
});

test('resolveEffects dice_check does not leak interjectionChoice into a nested effect resolved from the matched tier', () => {
  // Regression guard: if the matched tier's own effects happened to contain
  // another dice_check, it must not silently reuse the outer interjection
  // decision -- it needs its own fresh scan (context.interjectionChoice
  // must be undefined again for it, not the outer resumed value).
  //
  // Discriminating setup: the OUTER dice_check resumes with a real (truthy)
  // interjectionChoice -- a consumable override item ('item_005'). If that
  // object leaked into the INNER dice_check's context instead of being
  // stripped, the inner call would see context.interjectionChoice already
  // defined, skip its own scan entirely, and treat the outer's
  // override/consumesItem semantics as its own -- trying to remove
  // 'item_005' a second time and throwing ITEM_NOT_FOUND, since the outer
  // resolution already removed it. With the strip in place, the inner
  // dice_check sees a fresh context.interjectionChoice === undefined, finds
  // no eligible items (empty itemCatalog), and just rolls normally instead.
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_005' });
  const diceInterjection = { scope: 'any', override: true, consumesItem: true };
  const rng = jest.fn().mockReturnValue(0.0); // used only by the INNER dice_check's real roll
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 1,
      tiers: [{
        min: 0, max: 8,
        effects: [{
          type: 'dice_check',
          diceCount: 1,
          tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'knowledge', delta: 1 }] }],
        }],
      }],
    },
  ], {
    rng,
    itemCatalog: [], // proves the inner check re-scanned (found nothing) rather than skipping
    interjectionChoice: { itemId: 'item_005', diceInterjection, overrideValue: 5 },
  });
  expect(result.pending).toBe(false);
  expect(player.stats.knowledge.currentIndex).toBe(player.stats.knowledge.baseIndex + 1);
  expect(player.inventory).toEqual([]); // the outer's consumable item was removed exactly once, not twice
});

test('resolveEffects choice creates a pending prompt and returns the full options with nested effects', () => {
  const gameState = makeGameStateWithPlayer();
  const promptState = createPromptState();
  const options = [
    { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
    { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
  ];
  const result = resolveEffects(gameState, promptState, 'p1', [
    { type: 'choice', description: '選擇要下降哪項', options, timeoutMs: 20000, defaultOptionId: 'opt_might' },
  ], { now: 1000 });
  expect(result.pending).toBe(true);
  expect(result.promptId).toEqual(expect.any(String));
  expect(result.options).toEqual(options);
});

test('resolveEffects choice result includes description, deadline, and defaultOptionId for the caller to schedule a real timeout', () => {
  const gameState = makeGameStateWithPlayer();
  const promptState = createPromptState();
  const options = [{ optionId: 'opt_might', effects: [] }];
  const result = resolveEffects(gameState, promptState, 'p1', [
    { type: 'choice', description: '選擇要下降哪項', options, timeoutMs: 20000, defaultOptionId: 'opt_might' },
  ], { now: 1000 });
  expect(result.description).toBe('選擇要下降哪項');
  expect(result.deadline).toBe(21000); // now(1000) + timeoutMs(20000)
  expect(result.defaultOptionId).toBe('opt_might');
});

test('resolveEffects choice stops before any effects listed after it in the same array', () => {
  const gameState = makeGameStateWithPlayer();
  const promptState = createPromptState();
  resolveEffects(gameState, promptState, 'p1', [
    { type: 'choice', description: '選擇', options: [{ optionId: 'a', effects: [] }], timeoutMs: 20000, defaultOptionId: 'a' },
    { type: 'stat_change', stat: 'might', delta: 5 }, // must NOT run
  ], { now: 1000 });
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(2); // unchanged (baseIndex)
});

test('resolveChoiceOption returns the effects for the matching optionId', () => {
  const options = [
    { optionId: 'opt_might', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
    { optionId: 'opt_speed', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
  ];
  expect(resolveChoiceOption(options, 'opt_speed')).toEqual([{ type: 'stat_change', stat: 'speed', delta: -1 }]);
});

test('resolveChoiceOption throws INVALID_CHOICE_OPTION for an id not present in options', () => {
  const options = [{ optionId: 'opt_might', effects: [] }];
  expect(() => resolveChoiceOption(options, 'not_an_option')).toThrow('INVALID_CHOICE_OPTION');
});

test('full round trip: choice pauses, respondToPrompt + resolveChoiceOption + resolveEffects finishes it', () => {
  const gameState = makeGameStateWithPlayer();
  const promptState = createPromptState();
  const options = [
    { optionId: 'opt_might', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
    { optionId: 'opt_speed', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
  ];
  const paused = resolveEffects(gameState, promptState, 'p1', [
    { type: 'choice', description: '選擇要下降哪項', options, timeoutMs: 20000, defaultOptionId: 'opt_might' },
  ], { now: 1000 });

  const response = respondToPrompt(promptState, { promptId: paused.promptId, playerId: 'p1', optionId: 'opt_speed' });
  const chosenEffects = resolveChoiceOption(paused.options, response.chosenOptionId);
  const finalResult = resolveEffects(gameState, promptState, 'p1', chosenEffects);

  expect(finalResult).toEqual({ pending: false, appliedCount: 1 });
  expect(gameState.players.get('p1').stats.speed.currentIndex).toBe(1); // baseIndex 2 - 1
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(2); // untouched
});

test('resolveEffects appliedCount counts each top-level effect processed', () => {
  const gameState = makeGameStateWithPlayer();
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', delta: 1 },
    { type: 'stat_change', stat: 'speed', delta: -1 },
  ]);
  expect(result).toEqual({ pending: false, appliedCount: 2 });
});

test('resolveEffects appliedCount propagates from a dice_check tier that actually applied effects', () => {
  const gameState = makeGameStateWithPlayer();
  const rng = jest.fn().mockReturnValue(0.99); // every die -> face 2, sum with 1 die = 2
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 1,
      tiers: [
        { min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }, { type: 'stat_change', stat: 'speed', delta: 1 }] },
      ],
    },
  ], { rng });
  expect(result).toEqual({ pending: false, appliedCount: 2 });
});

test('resolveEffects appliedCount is 0 when the matched dice_check tier has no effects (e.g. a failed check)', () => {
  const gameState = makeGameStateWithPlayer();
  const rng = jest.fn().mockReturnValue(0); // every die -> face 0, sum = 0
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 1,
      tiers: [{ min: 0, max: 8, effects: [] }],
    },
  ], { rng });
  expect(result).toEqual({ pending: false, appliedCount: 0 });
});

test('computeInterjectedRoll is exported and applies a chosen interjection\'s cost/bonus directly', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_006' });
  const rng = jest.fn().mockReturnValue(0.99); // every die -> face 2
  const diceInterjection = {
    scope: 'any',
    bonusDice: 2,
    cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }],
    consumesItem: false,
  };
  const result = computeInterjectedRoll(
    gameState,
    createPromptState(),
    'p1',
    2,
    [],
    { itemId: 'item_006', diceInterjection, overrideValue: undefined },
    { rng }
  );
  expect(result).toBe(8); // (2 base + 2 bonus) dice, each face 2 -> sum 8
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex - 1); // cost applied
  expect(player.diceInterjectionUsedThisTurn).toEqual(['item_006']); // not consumable -- tracked as used
  expect(player.inventory).toEqual([{ id: 'item_006' }]); // still held
});

test('resolveEffects appliedCount is 0 for an empty effects array', () => {
  const gameState = makeGameStateWithPlayer();
  const result = resolveEffects(gameState, createPromptState(), 'p1', []);
  expect(result).toEqual({ pending: false, appliedCount: 0 });
});

test('resolveEffects preview_and_choose offers the top N deck cards plus a skip option, without touching the deck yet', () => {
  const gameState = makeGameStateWithPlayer('p1', {
    events: [
      { id: 'event_a', name: 'A', effects: [] },
      { id: 'event_b', name: 'B', effects: [] },
      { id: 'event_c', name: 'C', effects: [] },
      { id: 'event_d', name: 'D', effects: [] },
    ],
  });
  const deckBefore = gameState.eventDeck.cards.map((c) => c.id);
  const paused = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'preview_and_choose', deck: 'event', count: 3, description: '選擇一張事件卡', timeoutMs: 20000 },
  ], { now: 1000 });

  expect(paused.pending).toBe(true);
  expect(paused.options).toHaveLength(4); // 3 previewed cards + skip
  expect(paused.options.map((o) => o.optionId)).toEqual([...deckBefore.slice(0, 3), '__skip__']);
  expect(paused.defaultOptionId).toBe('__skip__');
  // Nothing removed from the deck yet -- only resolving an option does that.
  expect(gameState.eventDeck.cards.map((c) => c.id)).toEqual(deckBefore);
});

test('resolveEffects preview_and_choose: choosing a previewed card takes it from the deck into inventory', () => {
  const gameState = makeGameStateWithPlayer('p1', {
    events: [
      { id: 'event_a', name: 'A', effects: [] },
      { id: 'event_b', name: 'B', effects: [] },
    ],
  });
  const promptState = createPromptState();
  const paused = resolveEffects(gameState, promptState, 'p1', [
    { type: 'preview_and_choose', deck: 'event', count: 3, description: '選擇一張事件卡', timeoutMs: 20000 },
  ], { now: 1000 });

  const response = respondToPrompt(promptState, { promptId: paused.promptId, playerId: 'p1', optionId: 'event_b' });
  const chosenEffects = resolveChoiceOption(paused.options, response.chosenOptionId);
  const finalResult = resolveEffects(gameState, promptState, 'p1', chosenEffects);

  expect(finalResult).toEqual({ pending: false, appliedCount: 1, drawnCards: [{ id: 'event_b', name: 'B' }] });
  expect(gameState.players.get('p1').inventory).toEqual([{ id: 'event_b' }]);
  expect(gameState.eventDeck.cards.map((c) => c.id)).toEqual(['event_a']); // only the chosen card left the deck
});

test('resolveEffects preview_and_choose: choosing __skip__ leaves the deck and inventory untouched', () => {
  const gameState = makeGameStateWithPlayer('p1', {
    events: [{ id: 'event_a', name: 'A', effects: [] }],
  });
  const promptState = createPromptState();
  const paused = resolveEffects(gameState, promptState, 'p1', [
    { type: 'preview_and_choose', deck: 'event', count: 3, description: '選擇一張事件卡', timeoutMs: 20000 },
  ], { now: 1000 });

  const response = respondToPrompt(promptState, { promptId: paused.promptId, playerId: 'p1', optionId: '__skip__' });
  const chosenEffects = resolveChoiceOption(paused.options, response.chosenOptionId);
  const finalResult = resolveEffects(gameState, promptState, 'p1', chosenEffects);

  expect(finalResult).toEqual({ pending: false, appliedCount: 0 });
  expect(gameState.players.get('p1').inventory).toEqual([]);
  expect(gameState.eventDeck.cards).toHaveLength(1);
});

test('resolveEffects preview_and_choose is a no-op when the deck is already empty', () => {
  const gameState = makeGameStateWithPlayer('p1', { events: [] });
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'preview_and_choose', deck: 'event', count: 3, description: '選擇一張事件卡', timeoutMs: 20000 },
  ]);
  expect(result).toEqual({ pending: false, appliedCount: 0 });
});

test('resolveEffects take_previewed_card no-ops gracefully if the card already left the deck (race with another draw)', () => {
  const gameState = makeGameStateWithPlayer('p1', {
    events: [{ id: 'event_a', name: 'A', effects: [] }],
  });
  gameState.eventDeck.cards = []; // simulate someone else already drew it
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'take_previewed_card', deck: 'event', cardId: 'event_a' },
  ]);
  expect(result).toEqual({ pending: false, appliedCount: 0 });
  expect(gameState.players.get('p1').inventory).toEqual([]);
});
