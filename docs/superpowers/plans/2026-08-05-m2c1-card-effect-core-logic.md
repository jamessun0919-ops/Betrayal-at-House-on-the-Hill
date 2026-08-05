# M2c-1：卡牌牌庫＋效果解析器（純邏輯模組）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 M2c 效果解析系統的純邏輯核心：卡牌牌庫、擲骰修改器管線、持續性標記（buff/debuff）、宣告式效果解析器，以及 `playerEntity.js` 的道具增減函式——全部不涉及 Socket.IO，可獨立 Jest 單元測試。

**Architecture:** 沿用 `server/src/game/` 既有的純邏輯分層慣例（`roomDeck.js`/`promptState.js`/`playerEntity.js` 風格）：`cardDeck.js` 比照 `roomDeck.js` 的牌庫模式；`effectPipeline.js` 是純函式的擲骰＋修改器套用＋多階梯比對；`modifiers.js` 管理掛載在玩家或房間物件上的持續性標記；`effectResolver.js` 是核心，讀入一張卡的 `effects` 宣告式陣列依序執行，遇到 `choice` 型別就用既有的 `promptState.js` 建立暫停點。`onAttack`/`onDamageTaken`、`peek_and_reorder` 型別本次不實作（見下方 Global Constraints 與 Task 7 的說明）。

**Tech Stack:** Node.js（CommonJS）、Jest。不使用 TypeScript。

## Global Constraints

- 所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串，不可靜默失敗或回傳 `undefined`（專案既有慣例，見 [Handover.md](../../../Handover.md) 「輸入驗證慣例」）
- 自訂骰子面值固定為 **0/0/1/1/2/2**（不是常見的 1-6 面骰）
- 本計畫**不**實作 `onAttack`/`onDamageTaken` hook（留給 M3），也**不**實作 `peek_and_reorder` 效果型別（留給之後有實際卡片需求時再補，遇到時 `resolveEffects` 會拋 `UNSUPPORTED_EFFECT_TYPE`，不是靜默忽略）
- 本計畫**不**修改 `gameState.js`、`socketHandlers.js`、`index.js`——三個事件/道具/預兆牌庫要在遊戲狀態上掛哪個欄位，是 M2c-2（Socket 整合）的範圍，這裡的 `cardDeck.js`/`effectResolver.js` 都用測試 fixture 獨立驗證，不依賴 `gameState` 的實際牌庫欄位
- 每個任務完成後執行 `cd server && npx jest` 確認全部既有測試（M1/M2a/M2b）仍然全綠，不只跑新增的測試檔

---

## Task 1: contentLoader.js — 新增卡片載入函式

**Files:**
- Modify: `server/src/game/contentLoader.js`
- Test: `server/test/game/contentLoader.test.js`

**Interfaces:**
- Consumes: 既有的 `loadJsonFile(filePath)`、`DEFAULT_DATA_DIR`（模組內部，不變）
- Produces: `loadEventCards(dataDir = DEFAULT_DATA_DIR): Array<object>`、`loadItemCards(dataDir = DEFAULT_DATA_DIR): Array<object>`、`loadOmenCards(dataDir = DEFAULT_DATA_DIR): Array<object>`——三者都讀取對應的 `data/cards/*.json`，失敗時拋 `CONTENT_DATA_LOAD_FAILED`（沿用 `loadJsonFile` 既有行為）

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/contentLoader.test.js` 現有內容的最後加入（`require` 那行改成把三個新函式一起解構出來）：

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadRooms,
  loadStartingRooms,
  loadCharacters,
  loadEventCards,
  loadItemCards,
  loadOmenCards,
} = require('../../src/game/contentLoader');
```

在檔案最後新增：

```js
function makeCardsFixtureDataDir(eventCards, itemCards, omenCards) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-cards-test-'));
  fs.mkdirSync(path.join(dir, 'cards'));
  if (eventCards !== undefined) {
    fs.writeFileSync(path.join(dir, 'cards', 'event-cards.json'), JSON.stringify(eventCards));
  }
  if (itemCards !== undefined) {
    fs.writeFileSync(path.join(dir, 'cards', 'item-cards.json'), JSON.stringify(itemCards));
  }
  if (omenCards !== undefined) {
    fs.writeFileSync(path.join(dir, 'cards', 'omen-cards.json'), JSON.stringify(omenCards));
  }
  return dir;
}

test('loadEventCards reads and parses event-cards.json from the given data directory', () => {
  const dataDir = makeCardsFixtureDataDir(
    [{ id: 'event_001', name: '測試事件', text: '', effects: [], needsCustomLogic: true }],
    [],
    []
  );
  expect(loadEventCards(dataDir)).toEqual([
    { id: 'event_001', name: '測試事件', text: '', effects: [], needsCustomLogic: true },
  ]);
});

test('loadItemCards reads and parses item-cards.json from the given data directory', () => {
  const dataDir = makeCardsFixtureDataDir(
    [],
    [{ id: 'item_001', name: '測試道具', text: '', effects: [], needsCustomLogic: true }],
    []
  );
  expect(loadItemCards(dataDir)).toEqual([
    { id: 'item_001', name: '測試道具', text: '', effects: [], needsCustomLogic: true },
  ]);
});

test('loadOmenCards reads and parses omen-cards.json from the given data directory', () => {
  const dataDir = makeCardsFixtureDataDir(
    [],
    [],
    [{ id: 'omen_001', name: '測試預兆', text: '', effects: [] }]
  );
  expect(loadOmenCards(dataDir)).toEqual([
    { id: 'omen_001', name: '測試預兆', text: '', effects: [] },
  ]);
});

test('loadEventCards throws CONTENT_DATA_LOAD_FAILED when the file does not exist', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-no-cards-'));
  expect(() => loadEventCards(dataDir)).toThrow('CONTENT_DATA_LOAD_FAILED');
});

test('loadItemCards throws CONTENT_DATA_LOAD_FAILED when the file does not exist', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-no-items-'));
  expect(() => loadItemCards(dataDir)).toThrow('CONTENT_DATA_LOAD_FAILED');
});

test('loadOmenCards throws CONTENT_DATA_LOAD_FAILED when the file does not exist', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-no-omens-'));
  expect(() => loadOmenCards(dataDir)).toThrow('CONTENT_DATA_LOAD_FAILED');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/contentLoader.test.js`
Expected: FAIL，`loadEventCards is not a function`（或等同的 undefined 呼叫錯誤）

- [ ] **Step 3: 實作**

把 `server/src/game/contentLoader.js` 改成：

```js
const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(__dirname, '../../../data');

function loadJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('CONTENT_DATA_LOAD_FAILED');
  }
}

function loadRooms(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'rooms', 'rooms.json'));
}

function loadStartingRooms(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'rooms', 'starting-rooms.json'));
}

function loadCharacters(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'characters', 'characters.json'));
}

function loadEventCards(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'cards', 'event-cards.json'));
}

function loadItemCards(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'cards', 'item-cards.json'));
}

function loadOmenCards(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'cards', 'omen-cards.json'));
}

module.exports = {
  loadRooms,
  loadStartingRooms,
  loadCharacters,
  loadEventCards,
  loadItemCards,
  loadOmenCards,
  DEFAULT_DATA_DIR,
};
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/contentLoader.test.js`
Expected: PASS，全部測試（既有＋新增）通過

- [ ] **Step 5: Commit**

```bash
git add server/src/game/contentLoader.js server/test/game/contentLoader.test.js
git commit -m "feat(m2c1): add event/item/omen card loaders to contentLoader"
```

---

## Task 2: cardDeck.js — 卡牌牌庫

**Files:**
- Create: `server/src/game/cardDeck.js`
- Test: `server/test/game/cardDeck.test.js`

**Interfaces:**
- Consumes: 無（不依賴其他 M2c 模組）
- Produces: `createCardDeck(cards: Array<object>): {cards: Array<object>}`（**允許空陣列**，只有非陣列輸入才拋錯——這點跟 `roomDeck.js` 的 `INVALID_ROOM_LIST` 不同，因為 M2c 設計已確認「牌庫抽空＝正常狀態，跳過即可」，空牌庫從一開始就是合法狀態）、`hasCards(deck): boolean`、`drawCard(deck): object`（拋 `CARD_DECK_EMPTY`）、`getRemainingCount(deck): number`

- [ ] **Step 1: 寫失敗測試**

建立 `server/test/game/cardDeck.test.js`：

```js
const { createCardDeck, hasCards, drawCard, getRemainingCount } = require('../../src/game/cardDeck');

function makeCards(count) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    cards.push({ id: `card_${i}`, name: `卡片${i}` });
  }
  return cards;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('createCardDeck builds a deck containing every card', () => {
  const deck = createCardDeck(makeCards(3));
  expect(deck.cards).toHaveLength(3);
  expect(hasCards(deck)).toBe(true);
  expect(getRemainingCount(deck)).toBe(3);
});

test('createCardDeck shuffles the cards (does not just copy the input order every time)', () => {
  const cards = makeCards(20);
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const deckA = createCardDeck(cards);
  jest.spyOn(Math, 'random').mockReturnValue(0.999);
  const deckB = createCardDeck(cards);
  expect(deckA.cards.map((c) => c.id)).not.toEqual(deckB.cards.map((c) => c.id));
});

test('createCardDeck accepts an empty array without throwing (empty deck is a valid state)', () => {
  const deck = createCardDeck([]);
  expect(hasCards(deck)).toBe(false);
  expect(getRemainingCount(deck)).toBe(0);
});

test('createCardDeck throws INVALID_CARD_LIST for a non-array input', () => {
  expect(() => createCardDeck(null)).toThrow('INVALID_CARD_LIST');
  expect(() => createCardDeck('not an array')).toThrow('INVALID_CARD_LIST');
  expect(() => createCardDeck(undefined)).toThrow('INVALID_CARD_LIST');
});

test('drawCard returns cards one at a time and shrinks the deck', () => {
  const deck = createCardDeck(makeCards(2));
  const first = drawCard(deck);
  expect(getRemainingCount(deck)).toBe(1);
  const second = drawCard(deck);
  expect(getRemainingCount(deck)).toBe(0);
  expect(first.id).not.toBe(second.id);
  expect(hasCards(deck)).toBe(false);
});

test('drawCard never draws the same card twice', () => {
  const deck = createCardDeck(makeCards(5));
  const drawnIds = new Set();
  for (let i = 0; i < 5; i++) {
    const card = drawCard(deck);
    expect(drawnIds.has(card.id)).toBe(false);
    drawnIds.add(card.id);
  }
});

test('drawCard throws CARD_DECK_EMPTY once every card has been drawn', () => {
  const deck = createCardDeck(makeCards(1));
  drawCard(deck);
  expect(() => drawCard(deck)).toThrow('CARD_DECK_EMPTY');
});

test('drawCard throws CARD_DECK_EMPTY immediately for a deck created empty', () => {
  const deck = createCardDeck([]);
  expect(() => drawCard(deck)).toThrow('CARD_DECK_EMPTY');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/cardDeck.test.js`
Expected: FAIL，`Cannot find module '../../src/game/cardDeck'`

- [ ] **Step 3: 實作**

建立 `server/src/game/cardDeck.js`：

```js
function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

function createCardDeck(cards) {
  if (!Array.isArray(cards)) {
    throw new Error('INVALID_CARD_LIST');
  }
  return { cards: shuffle(cards) };
}

function hasCards(deck) {
  return deck.cards.length > 0;
}

function drawCard(deck) {
  if (!hasCards(deck)) {
    throw new Error('CARD_DECK_EMPTY');
  }
  return deck.cards.shift();
}

function getRemainingCount(deck) {
  return deck.cards.length;
}

module.exports = { createCardDeck, hasCards, drawCard, getRemainingCount };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/cardDeck.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/cardDeck.js server/test/game/cardDeck.test.js
git commit -m "feat(m2c1): add cardDeck.js for event/item/omen card decks"
```

---

## Task 3: playerEntity.js — inventory 增減函式

**Files:**
- Modify: `server/src/game/playerEntity.js`
- Test: `server/test/game/playerEntity.test.js`

**Interfaces:**
- Consumes: 無新依賴
- Produces: `addItem(player, item: {id, ...}): void`（拋 `INVALID_ITEM`）、`removeItem(player, itemId): object`（回傳被移除的 item，拋 `ITEM_NOT_FOUND`）

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/playerEntity.test.js` 開頭的 `require` 加入 `addItem`、`removeItem`：

```js
const { STATS, createPlayer, changeStat, resetActionPoints, movePlayerTo, getStatValue, isBelowBase, addItem, removeItem } = require('../../src/game/playerEntity');
```

在檔案最後新增：

```js
test('addItem pushes the item onto the player inventory', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  addItem(player, { id: 'item_001', name: '左輪手槍' });
  expect(player.inventory).toEqual([{ id: 'item_001', name: '左輪手槍' }]);
});

test('addItem appends without disturbing existing items', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  addItem(player, { id: 'item_001' });
  addItem(player, { id: 'item_002' });
  expect(player.inventory.map((i) => i.id)).toEqual(['item_001', 'item_002']);
});

test('addItem throws INVALID_ITEM for an item missing an id', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(() => addItem(player, { name: '沒有id' })).toThrow('INVALID_ITEM');
  expect(() => addItem(player, null)).toThrow('INVALID_ITEM');
});

test('removeItem removes and returns the matching item', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  addItem(player, { id: 'item_001', name: '左輪手槍' });
  addItem(player, { id: 'item_002', name: '斧頭' });
  const removed = removeItem(player, 'item_001');
  expect(removed).toEqual({ id: 'item_001', name: '左輪手槍' });
  expect(player.inventory.map((i) => i.id)).toEqual(['item_002']);
});

test('removeItem throws ITEM_NOT_FOUND when no inventory item matches', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(() => removeItem(player, 'not_held')).toThrow('ITEM_NOT_FOUND');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/playerEntity.test.js`
Expected: FAIL，`addItem is not a function`

- [ ] **Step 3: 實作**

在 `server/src/game/playerEntity.js` 的 `module.exports` 之前加入：

```js
function addItem(player, item) {
  if (!item || typeof item.id !== 'string' || item.id.length === 0) {
    throw new Error('INVALID_ITEM');
  }
  player.inventory.push(item);
}

function removeItem(player, itemId) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_FOUND');
  }
  return player.inventory.splice(index, 1)[0];
}
```

把最後一行 `module.exports` 改成：

```js
module.exports = {
  STATS,
  createPlayer,
  changeStat,
  resetActionPoints,
  movePlayerTo,
  getStatValue,
  isBelowBase,
  addItem,
  removeItem,
};
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/playerEntity.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/playerEntity.js server/test/game/playerEntity.test.js
git commit -m "feat(m2c1): add inventory addItem/removeItem to playerEntity"
```

---

## Task 4: effectPipeline.js — 擲骰＋修改器＋多階梯

**Files:**
- Create: `server/src/game/effectPipeline.js`
- Test: `server/test/game/effectPipeline.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `rollDice(count: number, rng: () => number = Math.random): number`——自訂骰面 **[0,0,1,1,2,2]**，`rng()` 每顆骰子呼叫一次，回傳總和；`count` 必須是非負整數，否則拋 `INVALID_DICE_COUNT`
  - `applyModifiers(value: number, modifiers: Array<{effects: Array<{hookType, delta, checkContext?}>}>, hookType: string, context: {checkContext?: string} = {}): number`——加總所有比對成功的 `delta`；`modifiers` 必須是陣列，否則拋 `INVALID_MODIFIER_LIST`
  - `evaluateTiers(rollResult: number, tiers: Array<{min, max, effects}>): {min, max, effects}`——由上到下找第一個 `min <= rollResult <= max` 的 tier；`tiers` 必須是非空陣列（拋 `INVALID_TIERS`），找不到符合的拋 `NO_MATCHING_TIER`

- [ ] **Step 1: 寫失敗測試**

建立 `server/test/game/effectPipeline.test.js`：

```js
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectPipeline.test.js`
Expected: FAIL，`Cannot find module '../../src/game/effectPipeline'`

- [ ] **Step 3: 實作**

建立 `server/src/game/effectPipeline.js`：

```js
const DIE_FACES = [0, 0, 1, 1, 2, 2];

function rollDice(count, rng = Math.random) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('INVALID_DICE_COUNT');
  }
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * DIE_FACES.length);
    sum += DIE_FACES[index];
  }
  return sum;
}

function applyModifiers(value, modifiers, hookType, context = {}) {
  if (!Array.isArray(modifiers)) {
    throw new Error('INVALID_MODIFIER_LIST');
  }
  let result = value;
  for (const modifier of modifiers) {
    for (const effect of modifier.effects) {
      if (effect.hookType !== hookType) continue;
      if (effect.checkContext && effect.checkContext !== context.checkContext) continue;
      result += effect.delta;
    }
  }
  return result;
}

function evaluateTiers(rollResult, tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new Error('INVALID_TIERS');
  }
  const tier = tiers.find((t) => rollResult >= t.min && rollResult <= t.max);
  if (!tier) {
    throw new Error('NO_MATCHING_TIER');
  }
  return tier;
}

module.exports = { rollDice, applyModifiers, evaluateTiers };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectPipeline.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/effectPipeline.js server/test/game/effectPipeline.test.js
git commit -m "feat(m2c1): add effectPipeline dice/modifier/tier pure functions"
```

---

## Task 5: modifiers.js — 持續性標記

**Files:**
- Create: `server/src/game/modifiers.js`
- Test: `server/test/game/modifiers.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `attachModifier(entity: object, input: {effects: Array, removeWhen: {type: string, ...}}): {id, effects, removeWhen}`——`entity` 是任意物件（玩家或房間），lazy init `entity.modifiers`；自動產生 `id`；`effects` 須為非空陣列（拋 `INVALID_MODIFIER_EFFECTS`）；`removeWhen` 須至少有 `type` 字串欄位（拋 `INVALID_REMOVE_WHEN`）
  - `removeModifier(entity, modifierId): void`——拋 `MODIFIER_NOT_FOUND`
  - `checkRemoveConditions(entity, context: {type: string, ...}): Array<object>`——回傳被移除的 modifier 物件陣列（可能是空陣列）；`entity.modifiers` 不存在時視為 `[]`，不拋錯

- [ ] **Step 1: 寫失敗測試**

建立 `server/test/game/modifiers.test.js`：

```js
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

test('attachModifier throws INVALID_REMOVE_WHEN for a missing or malformed removeWhen', () => {
  const effects = [{ hookType: 'onBeforeRoll', delta: 1 }];
  expect(() => attachModifier({}, { effects })).toThrow('INVALID_REMOVE_WHEN');
  expect(() => attachModifier({}, { effects, removeWhen: {} })).toThrow('INVALID_REMOVE_WHEN');
  expect(() => attachModifier({}, { effects, removeWhen: null })).toThrow('INVALID_REMOVE_WHEN');
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/modifiers.test.js`
Expected: FAIL，`Cannot find module '../../src/game/modifiers'`

- [ ] **Step 3: 實作**

建立 `server/src/game/modifiers.js`：

```js
let modifierCounter = 0;

function generateModifierId() {
  modifierCounter += 1;
  return `modifier_${modifierCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function attachModifier(entity, { effects, removeWhen }) {
  if (!Array.isArray(effects) || effects.length === 0) {
    throw new Error('INVALID_MODIFIER_EFFECTS');
  }
  if (!removeWhen || typeof removeWhen.type !== 'string' || removeWhen.type.length === 0) {
    throw new Error('INVALID_REMOVE_WHEN');
  }
  const modifier = { id: generateModifierId(), effects, removeWhen };
  entity.modifiers = entity.modifiers || [];
  entity.modifiers.push(modifier);
  return modifier;
}

function removeModifier(entity, modifierId) {
  const modifiers = entity.modifiers || [];
  const index = modifiers.findIndex((m) => m.id === modifierId);
  if (index === -1) {
    throw new Error('MODIFIER_NOT_FOUND');
  }
  modifiers.splice(index, 1);
}

function matchesRemoveWhen(removeWhen, context) {
  if (removeWhen.type !== context.type) return false;
  if (removeWhen.type === 'holdsItem') {
    return removeWhen.itemId === context.itemId;
  }
  return true;
}

function checkRemoveConditions(entity, context) {
  const modifiers = entity.modifiers || [];
  const toRemove = modifiers.filter((m) => matchesRemoveWhen(m.removeWhen, context));
  for (const modifier of toRemove) {
    removeModifier(entity, modifier.id);
  }
  return toRemove;
}

module.exports = { attachModifier, removeModifier, checkRemoveConditions };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/modifiers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/modifiers.js server/test/game/modifiers.test.js
git commit -m "feat(m2c1): add modifiers.js for persistent player/room buffs"
```

---

## Task 6: effectResolver.js（一）— stat_change／grant_item／lose_item／persistent_modifier

**Files:**
- Create: `server/src/game/effectResolver.js`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes:
  - `getPlayer(gameState, playerId)` from `./gameState`
  - `changeStat(player, stat, delta, hauntStarted)`、`addItem(player, item)`、`removeItem(player, itemId)` from `./playerEntity`
  - `attachModifier(entity, input)` from `./modifiers`
  - `coordKey(x, y)` from `./boardGenerator`
- Produces: `resolveEffects(gameState, promptState, playerId, effects: Array<object>, context: object = {}): {pending: boolean, promptId?: string, options?: Array}`——依序執行 `effects`，型別不明或未實作（含 `peek_and_reorder`）拋 `UNSUPPORTED_EFFECT_TYPE`；`effects` 非陣列拋 `INVALID_EFFECTS_LIST`；`playerId` 找不到玩家拋 `PLAYER_NOT_FOUND`。本任務先實作 `stat_change`／`grant_item`／`lose_item`／`persistent_modifier` 四種型別；`dice_check`／`choice` 由 Task 7 加進同一個 dispatch table

**重要說明（給下一個任務的實作者）**：本任務先把 `resolveEffects` 的骨架、dispatch table、`requirePlayer`/`getRoomForPlayer` 私有輔助函式建好。Task 7 會在同一個檔案的 `HANDLERS` 物件裡再加兩個 key（`dice_check`、`choice`），並新增 `resolveChoiceOption` 這個新的匯出函式——不要重新設計 dispatch 機制。

- [ ] **Step 1: 寫失敗測試**

建立 `server/test/game/effectResolver.test.js`：

```js
const { resolveEffects } = require('../../src/game/effectResolver');
const { createGameState, addPlayer } = require('../../src/game/gameState');
const { createPromptState } = require('../../src/game/promptState');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
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

function makeGameStateWithPlayer(playerId = 'p1') {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_x', doors: 2 }]);
  addPlayer(gameState, { playerId, name: 'Alice', stats: makeStats() });
  return gameState;
}

test('resolveEffects applies a stat_change delta', () => {
  const gameState = makeGameStateWithPlayer();
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', delta: 1 },
  ]);
  expect(result).toEqual({ pending: false });
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js`
Expected: FAIL，`Cannot find module '../../src/game/effectResolver'`

- [ ] **Step 3: 實作**

建立 `server/src/game/effectResolver.js`：

```js
const { getPlayer } = require('./gameState');
const { changeStat, addItem, removeItem } = require('./playerEntity');
const { attachModifier } = require('./modifiers');
const { coordKey } = require('./boardGenerator');

function requirePlayer(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (!player) {
    throw new Error('PLAYER_NOT_FOUND');
  }
  return player;
}

function getRoomForPlayer(gameState, player) {
  return gameState.board[player.floor].get(coordKey(player.x, player.y));
}

function handleStatChange(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  if (effect.restoreToBase) {
    const statTrack = player.stats[effect.stat];
    if (!statTrack) {
      throw new Error('UNKNOWN_STAT');
    }
    const delta = statTrack.baseIndex - statTrack.currentIndex;
    changeStat(player, effect.stat, delta, gameState.hauntStarted);
  } else {
    changeStat(player, effect.stat, effect.delta, gameState.hauntStarted);
  }
  return { pending: false };
}

function handleGrantItem(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  addItem(player, { id: effect.itemId });
  return { pending: false };
}

function handleLoseItem(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  removeItem(player, effect.itemId);
  return { pending: false };
}

function handlePersistentModifier(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  if (effect.appliesTo !== 'player' && effect.appliesTo !== 'room') {
    throw new Error('INVALID_MODIFIER_APPLIES_TO');
  }
  const entity = effect.appliesTo === 'room' ? getRoomForPlayer(gameState, player) : player;
  attachModifier(entity, { effects: effect.effects, removeWhen: effect.removeWhen });
  return { pending: false };
}

const HANDLERS = {
  stat_change: (gameState, promptState, playerId, effect) => handleStatChange(gameState, playerId, effect),
  grant_item: (gameState, promptState, playerId, effect) => handleGrantItem(gameState, playerId, effect),
  lose_item: (gameState, promptState, playerId, effect) => handleLoseItem(gameState, playerId, effect),
  persistent_modifier: (gameState, promptState, playerId, effect) => handlePersistentModifier(gameState, playerId, effect),
};

function resolveEffects(gameState, promptState, playerId, effects, context = {}) {
  if (!Array.isArray(effects)) {
    throw new Error('INVALID_EFFECTS_LIST');
  }
  requirePlayer(gameState, playerId);
  for (const effect of effects) {
    const handler = HANDLERS[effect.type];
    if (!handler) {
      throw new Error('UNSUPPORTED_EFFECT_TYPE');
    }
    const result = handler(gameState, promptState, playerId, effect, context);
    if (result && result.pending) {
      return result;
    }
  }
  return { pending: false };
}

module.exports = { resolveEffects };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat(m2c1): add effectResolver core dispatch with stat/item/modifier effects"
```

---

## Task 7: effectResolver.js（二）— dice_check／choice／resolveChoiceOption

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Modify: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: `rollDice(count, rng)`、`applyModifiers(value, modifiers, hookType, context)`、`evaluateTiers(rollResult, tiers)` from `./effectPipeline`；`getStatValue(player, stat)` from `./playerEntity`；`createPrompt(promptState, {type, targetPlayerId, description, options, timeoutMs, now})` from `./promptState`
- Produces（追加到既有匯出）：
  - `resolveEffects`（Task 6 已存在，行為擴充：`HANDLERS` 新增 `dice_check`、`choice` 兩個 key，不改動函式簽名）
  - `resolveChoiceOption(options: Array<{optionId, effects}>, optionId: string): Array<object>`——回傳被選中選項的 `effects`；找不到拋 `INVALID_CHOICE_OPTION`

**`choice` 型別的暫停行為**：`resolveEffects` 遇到 `{type:'choice', options, description, timeoutMs, defaultOptionId}` 時，用 `promptState.createPrompt` 建立一個 `type:'effect_choice'` 的提問（`options` 只放 `optionId` 清單給 `createPrompt` 做合法性驗證），回傳 `{pending:true, promptId, options}`（`options` 是完整的原始陣列，含每個選項的 `effects`，讓呼叫端之後能查到要繼續執行哪些效果）——**呼叫端**（M2c-2 的 `effectResolverManager`／`socketHandlers.js`）負責保存 `promptId -> options` 的對應關係，本任務不處理儲存，只回傳。**`choice` 必須是它所在 `effects` 陣列的最後一個元素**——`resolveEffects` 遇到 `choice` 會立刻 `return`，陣列裡排在 `choice` 後面的效果不會被執行（跟 Section 6 設計文件的「暫停後只靠被選中選項的 `effects` 繼續」一致）。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolver.test.js` 開頭的 `require` 改成：

```js
const { resolveEffects, resolveChoiceOption } = require('../../src/game/effectResolver');
const { createGameState, addPlayer } = require('../../src/game/gameState');
const { createPromptState, respondToPrompt } = require('../../src/game/promptState');
```

在檔案最後新增：

```js
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

test('resolveEffects dice_check throws INVALID_DICE_CHECK_COUNT when neither stat nor diceCount is usable', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'dice_check', tiers: [{ min: 0, max: 8, effects: [] }] }])
  ).toThrow('INVALID_DICE_CHECK_COUNT');
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

  expect(finalResult).toEqual({ pending: false });
  expect(gameState.players.get('p1').stats.speed.currentIndex).toBe(1); // baseIndex 2 - 1
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(2); // untouched
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js`
Expected: FAIL（`dice_check`／`choice` 相關測試會因為 `UNSUPPORTED_EFFECT_TYPE` 而失敗；`resolveChoiceOption` 是 undefined）

- [ ] **Step 3: 實作**

修改 `server/src/game/effectResolver.js`：把最上面的 `require` 區塊改成：

```js
const { getPlayer } = require('./gameState');
const { changeStat, addItem, removeItem, getStatValue } = require('./playerEntity');
const { attachModifier } = require('./modifiers');
const { coordKey } = require('./boardGenerator');
const { rollDice, applyModifiers, evaluateTiers } = require('./effectPipeline');
const { createPrompt } = require('./promptState');
```

在 `handlePersistentModifier` 函式之後、`const HANDLERS = {` 之前，新增：

```js
function handleDiceCheck(gameState, promptState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];

  const baseCount = effect.stat !== undefined ? getStatValue(player, effect.stat) : effect.diceCount;
  if (!Number.isInteger(baseCount) || baseCount < 0) {
    throw new Error('INVALID_DICE_CHECK_COUNT');
  }

  const adjustedCount = applyModifiers(baseCount, modifiers, 'onBeforeRoll', context);
  const rolled = rollDice(adjustedCount, context.rng);
  const finalSum = applyModifiers(rolled, modifiers, 'onAfterRoll', context);
  const tier = evaluateTiers(finalSum, effect.tiers);
  return resolveEffects(gameState, promptState, playerId, tier.effects, context);
}

function handleChoice(gameState, promptState, playerId, effect, context) {
  const prompt = createPrompt(promptState, {
    type: 'effect_choice',
    targetPlayerId: playerId,
    description: effect.description,
    options: effect.options.map((o) => o.optionId),
    timeoutMs: effect.timeoutMs,
    now: context.now,
  });
  return { pending: true, promptId: prompt.promptId, options: effect.options };
}

function resolveChoiceOption(options, optionId) {
  const option = options.find((o) => o.optionId === optionId);
  if (!option) {
    throw new Error('INVALID_CHOICE_OPTION');
  }
  return option.effects;
}
```

把 `HANDLERS` 物件改成：

```js
const HANDLERS = {
  stat_change: (gameState, promptState, playerId, effect) => handleStatChange(gameState, playerId, effect),
  grant_item: (gameState, promptState, playerId, effect) => handleGrantItem(gameState, playerId, effect),
  lose_item: (gameState, promptState, playerId, effect) => handleLoseItem(gameState, playerId, effect),
  persistent_modifier: (gameState, promptState, playerId, effect) => handlePersistentModifier(gameState, playerId, effect),
  dice_check: (gameState, promptState, playerId, effect, context) => handleDiceCheck(gameState, promptState, playerId, effect, context),
  choice: (gameState, promptState, playerId, effect, context) => handleChoice(gameState, promptState, playerId, effect, context),
};
```

把最後的 `module.exports` 改成：

```js
module.exports = { resolveEffects, resolveChoiceOption };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js`
Expected: PASS，全部測試（Task 6＋Task 7）通過

Run: `cd server && npx jest`
Expected: PASS，全部既有測試（M1/M2a/M2b）加上 M2c-1 新增的測試全綠

- [ ] **Step 5: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat(m2c1): add dice_check and choice handling to effectResolver"
```
