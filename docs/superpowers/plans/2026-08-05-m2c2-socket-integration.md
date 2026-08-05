# M2c-2：卡牌抽取＋效果解析 Socket 整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 M2c-1 的純邏輯模組（`cardDeck.js`/`effectPipeline.js`/`modifiers.js`/`effectResolver.js`）接上 Socket.IO 事件層：玩家開門進入需要抽卡的房間時，伺服器在同一個 `game:move` 處理流程內自動抽卡並解析效果；效果需要玩家選擇時建立提問、逾時仍自動代選，遊戲不會卡住。

**Architecture:** 新建 `effectResolverManager.js`（仿 `characterSelectionManager.js` 的結構，`{resolvers: Map()}`），生命週期跟 `gameState` 一致，在 `finishCharacterSelection` 呼叫 `startGame`成功後同時建立。`gameState` 新增三個牌庫欄位（`eventDeck`/`itemDeck`/`omenDeck`），用 M2c-1 的 `cardDeck.js` 建立。`socketHandlers.js` 的 `game:move` 處理內偵測到 `pendingCardDraw` 後直接抽卡＋呼叫 `effectResolver.resolveEffects`；卡在 `choice` 時，比照既有選角色逾時提問的模式，在 `socketHandlers.js` 排真實 `setTimeout`。

**Tech Stack:** Node.js（CommonJS）、Socket.IO、Jest、React（除錯頁面）。

## Global Constraints

- 所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串
- **`game:pendingCardDraw`（M2b-2 的舊廣播事件）本計畫移除**，改用 `game:cardDrawn`（真的抽到卡時才發）——已確認沒有任何測試依賴它，設計文件的流程圖也沒有把它畫進去
- `game:pendingAction`／`selectAction` 的 stub 行為維持 M2b-2 現狀，本計畫不觸碰
- 每個任務完成後執行 `cd server && npx jest` 確認全部既有測試仍然全綠

---

## Task 1: gameState.js — 新增事件/道具/預兆牌庫

**Files:**
- Modify: `server/src/game/gameState.js`
- Test: `server/test/game/gameState.test.js`

**Interfaces:**
- Consumes: `createCardDeck(cards)`、`hasCards(deck)`、`getRemainingCount(deck)` from `./cardDeck`（M2c-1 已完成）
- Produces: `createGameState(startingRooms, rooms, cards = {})` 簽名變更——`cards = {events, items, omens}`，三者都可省略（各自預設 `[]`，`createCardDeck([])` 合法不拋錯，見 M2c-1 的設計）；`gameState.eventDeck`/`itemDeck`/`omenDeck` 三個新欄位；`serializeGameState` 新增對應的 `eventDeck`/`itemDeck`/`omenDeck: {remainingCount, isEmpty}`（跟 `roomDeck` 現有序列化方式一致）

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/gameState.test.js` 的 `require` 加入 `hasCards`（從 `cardDeck` 匯入，供測試組裝 fixture 用）：

```js
const { createGameState, addPlayer, getPlayer, serializeGameState } = require('../../src/game/gameState');
```

在檔案最後新增：

```js
test('createGameState builds empty event/item/omen decks when no cards argument is given', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  expect(gameState.eventDeck.cards).toEqual([]);
  expect(gameState.itemDeck.cards).toEqual([]);
  expect(gameState.omenDeck.cards).toEqual([]);
});

test('createGameState builds event/item/omen decks from the given cards', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms(), {
    events: [{ id: 'event_001' }],
    items: [{ id: 'item_001' }, { id: 'item_002' }],
    omens: [{ id: 'omen_001' }],
  });
  expect(gameState.eventDeck.cards).toHaveLength(1);
  expect(gameState.itemDeck.cards).toHaveLength(2);
  expect(gameState.omenDeck.cards).toHaveLength(1);
});

test('serializeGameState exposes remainingCount/isEmpty for the event/item/omen decks, not their contents', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms(), {
    events: [{ id: 'event_001' }],
    items: [],
    omens: [{ id: 'omen_001' }, { id: 'omen_002' }],
  });
  const serialized = serializeGameState(gameState);
  expect(serialized.eventDeck).toEqual({ remainingCount: 1, isEmpty: false });
  expect(serialized.itemDeck).toEqual({ remainingCount: 0, isEmpty: true });
  expect(serialized.omenDeck).toEqual({ remainingCount: 2, isEmpty: false });
  expect(serialized.eventDeck.cards).toBeUndefined();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/gameState.test.js`
Expected: FAIL，`gameState.eventDeck` is undefined

- [ ] **Step 3: 實作**

修改 `server/src/game/gameState.js`：

```js
const { createBoard } = require('./boardGenerator');
const { createPlayer, resetActionPoints } = require('./playerEntity');
const { createRoomDeck, isRoomDeckEmpty, getRemainingCount } = require('./roomDeck');
const { createCardDeck, hasCards, getRemainingCount: getCardRemainingCount } = require('./cardDeck');

function createGameState(startingRooms, rooms, cards = {}) {
  return {
    board: createBoard(startingRooms),
    players: new Map(),
    hauntStarted: false,
    omenCount: 0,
    roomDeck: createRoomDeck(rooms),
    eventDeck: createCardDeck(cards.events || []),
    itemDeck: createCardDeck(cards.items || []),
    omenDeck: createCardDeck(cards.omens || []),
  };
}
```

把 `serializeGameState` 裡 `roomDeck` 那行之後加入三個新欄位：

```js
function serializeGameState(gameState) {
  return {
    board: {
      ground: Array.from(gameState.board.ground.values()),
      upper: Array.from(gameState.board.upper.values()),
      stairsLink: gameState.board.stairsLink,
    },
    players: Array.from(gameState.players.values()),
    hauntStarted: gameState.hauntStarted,
    omenCount: gameState.omenCount,
    roomDeck: {
      remainingCount: getRemainingCount(gameState.roomDeck),
      isEmpty: isRoomDeckEmpty(gameState.roomDeck),
    },
    eventDeck: {
      remainingCount: getCardRemainingCount(gameState.eventDeck),
      isEmpty: !hasCards(gameState.eventDeck),
    },
    itemDeck: {
      remainingCount: getCardRemainingCount(gameState.itemDeck),
      isEmpty: !hasCards(gameState.itemDeck),
    },
    omenDeck: {
      remainingCount: getCardRemainingCount(gameState.omenDeck),
      isEmpty: !hasCards(gameState.omenDeck),
    },
    turnOrder: gameState.turnOrder || null,
    currentPlayerIndex: gameState.currentPlayerIndex ?? null,
  };
}

module.exports = { createGameState, addPlayer, getPlayer, serializeGameState };
```

（`addPlayer`/`getPlayer` 函式本身不變，只有頂部 `require` 跟 `createGameState`/`serializeGameState` 兩個函式內容變動。）

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/gameState.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/gameState.js server/test/game/gameState.test.js
git commit -m "feat(m2c2): add event/item/omen card decks to gameState"
```

---

## Task 2: gameManager.js — 傳遞 cards 參數

**Files:**
- Modify: `server/src/game/gameManager.js`
- Test: `server/test/game/gameManager.test.js`

**Interfaces:**
- Consumes: `createGameState(startingRooms, rooms, cards)`（Task 1 已完成）
- Produces: `startGame(manager, roomCode, {startingRooms, rooms, cards, characters, players})`——`cards` 可省略（沿用 `createGameState` 的預設空牌庫行為）

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/gameManager.test.js` 最後新增：

```js
test('startGame passes cards through to createGameState so the decks are populated', () => {
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', baseStartArgs({
    cards: { events: [{ id: 'event_001' }], items: [], omens: [] },
  }));
  expect(gameState.eventDeck.cards).toHaveLength(1);
});

test('startGame builds empty card decks when cards is omitted', () => {
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', baseStartArgs());
  expect(gameState.eventDeck.cards).toEqual([]);
  expect(gameState.itemDeck.cards).toEqual([]);
  expect(gameState.omenDeck.cards).toEqual([]);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/gameManager.test.js`
Expected: FAIL，`gameState.eventDeck.cards` 長度為 0（因為 `cards` 目前沒有被傳進 `createGameState`，第一個新測試會失敗；第二個新測試其實已經通過，因為 `createGameState` 的預設值本來就是空陣列）

- [ ] **Step 3: 實作**

修改 `server/src/game/gameManager.js` 的 `startGame` 函式簽名與內部呼叫：

```js
function startGame(manager, roomCode, { startingRooms, rooms, cards, characters, players }) {
  if (manager.games.has(roomCode)) {
    throw new Error('GAME_ALREADY_STARTED');
  }
  const gameState = createGameState(startingRooms, rooms, cards);
  for (const player of players) {
    const character = characters.find((c) => c.id === player.characterId);
    if (!character) {
      throw new Error('UNKNOWN_CHARACTER');
    }
    addPlayer(gameState, {
      playerId: player.playerId,
      name: player.name,
      stats: character.stats,
    });
  }
  gameState.turnOrder = shuffle(players.map((p) => p.playerId));
  gameState.currentPlayerIndex = 0;
  manager.games.set(roomCode, gameState);
  return gameState;
}
```

（只有函式簽名的解構參數多了 `cards`、以及 `createGameState` 呼叫多帶一個參數，其餘不變。）

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/gameManager.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/gameManager.js server/test/game/gameManager.test.js
git commit -m "feat(m2c2): thread cards through gameManager.startGame"
```

---

## Task 3: effectResolverManager.js — 效果解析器狀態容器

**Files:**
- Create: `server/src/game/effectResolverManager.js`
- Test: `server/test/game/effectResolverManager.test.js`

**Interfaces:**
- Consumes: `createPromptState()` from `./promptState`
- Produces: `createEffectResolverManager()` → `{resolvers: Map()}`；`startResolver(manager, roomCode)` → `{promptState, pendingChoice: null}`（拋 `RESOLVER_ALREADY_STARTED`）；`getResolver(manager, roomCode)`；`endResolver(manager, roomCode)`（no-op if missing）

**設計說明**：`pendingChoice` 欄位是 `socketHandlers.js`（Task 6）用來記住「目前這個 room 卡在哪個 `choice` 效果、選項內容是什麼」的地方——因為 `promptState.js` 的 `respondToPrompt` 只驗證 `promptId`/`playerId`/`optionId` 是否合法，不記得「這個 `optionId` 對應哪些要繼續執行的 `effects`」，這份資料只有 `effectResolver.resolveEffects` 當初回傳的 `options`（含巢狀 `effects`）才有，所以由呼叫端（`effectResolverManager` 的 entry）暫存。跟 `promptState` 本身「同一時間只能有一個待處理提問」的限制一致，`pendingChoice` 也是單一欄位，不是陣列。

- [ ] **Step 1: 寫失敗測試**

建立 `server/test/game/effectResolverManager.test.js`：

```js
const {
  createEffectResolverManager,
  startResolver,
  getResolver,
  endResolver,
} = require('../../src/game/effectResolverManager');

test('startResolver creates an entry with a promptState and no pending choice', () => {
  const manager = createEffectResolverManager();
  const entry = startResolver(manager, 'ROOM1');
  expect(entry.promptState).toEqual({ pending: null });
  expect(entry.pendingChoice).toBeNull();
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolverManager.test.js`
Expected: FAIL，`Cannot find module '../../src/game/effectResolverManager'`

- [ ] **Step 3: 實作**

建立 `server/src/game/effectResolverManager.js`：

```js
const { createPromptState } = require('./promptState');

function createEffectResolverManager() {
  return { resolvers: new Map() };
}

function startResolver(manager, roomCode) {
  if (manager.resolvers.has(roomCode)) {
    throw new Error('RESOLVER_ALREADY_STARTED');
  }
  const entry = { promptState: createPromptState(), pendingChoice: null };
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
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolverManager.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/effectResolverManager.js server/test/game/effectResolverManager.test.js
git commit -m "feat(m2c2): add effectResolverManager for per-room effect prompt state"
```

---

## Task 4: effectResolver.js — 擴充 choice 的回傳內容

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Modify: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: 無新依賴
- Produces：`resolveEffects` 遇到 `choice` 時的回傳值擴充為 `{pending: true, promptId, description, deadline, defaultOptionId, options}`（M2c-1 版本只有 `{pending, promptId, options}`）——`description`/`deadline` 來自 `createPrompt` 建立的 prompt 物件，`defaultOptionId` 來自原始 `choice` 效果定義的 `effect.defaultOptionId`。這是延伸 M2c-1 就已經明確標註為「之後會擴充」的 stub 回傳值，不影響既有欄位。

**為什麼需要這個擴充**：`socketHandlers.js`（Task 6）要廣播 `game:effectPendingChoice` 並排真實的逾時 `setTimeout`，需要 `description`（給玩家看的提問文字）跟 `deadline`（算逾時還剩多久）；`defaultOptionId` 則是逾時時 `resolvePromptTimeout` 要用的預設選項。若不擴充，`socketHandlers.js` 就得另外呼叫 `promptState.getPendingPrompt` 才拿得到 `description`/`deadline`，而 `defaultOptionId` 完全沒地方拿——直接讓 `resolveEffects` 一次回傳齊全比較乾淨。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolver.test.js` 找到這個既有測試：

```js
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
```

在它後面新增一個測試，斷言新欄位：

```js
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js`
Expected: FAIL，`result.description`/`result.deadline`/`result.defaultOptionId` 都是 `undefined`

- [ ] **Step 3: 實作**

修改 `server/src/game/effectResolver.js` 的 `handleChoice` 函式：

```js
function handleChoice(gameState, promptState, playerId, effect, context) {
  const prompt = createPrompt(promptState, {
    type: 'effect_choice',
    targetPlayerId: playerId,
    description: effect.description,
    options: effect.options.map((o) => o.optionId),
    timeoutMs: effect.timeoutMs,
    now: context.now,
  });
  return {
    pending: true,
    promptId: prompt.promptId,
    description: prompt.description,
    deadline: prompt.deadline,
    defaultOptionId: effect.defaultOptionId,
    options: effect.options,
  };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js`
Expected: PASS，全部測試（含既有的）通過

- [ ] **Step 5: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat(m2c2): include description/deadline/defaultOptionId in choice pending result"
```

---

## Task 5: socketHandlers.js — 接線 effectResolverManager，game:move 自動抽卡解析

**Files:**
- Modify: `server/src/index.js`
- Modify: `server/src/socketHandlers.js`
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes:
  - `createEffectResolverManager`、`getResolver`（`startResolver` 用在 `finishCharacterSelection`）from `./game/effectResolverManager`
  - `resolveEffects` from `./game/effectResolver`
  - `hasCards`、`drawCard` from `./game/cardDeck`
  - `loadEventCards`、`loadItemCards`、`loadOmenCards` from `./game/contentLoader`（`index.js` 用）
- Produces:
  - `registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, options = {})`——簽名新增 `effectResolverManager` 參數（插入在 `characterSelectionManager` 之後）
  - `content.cards = {events, items, omens}`——新增欄位，`finishCharacterSelection` 呼叫 `startGame` 時一併傳入
  - `game:cardDrawn`（廣播）：`{playerId, deckType, cardId, cardName}`
  - `game:effectResolved`（廣播）：`{playerId, cardId}`
  - `game:effectPendingChoice`（廣播）：`{playerId, promptId, description, options}`——`options` 是含 `effects` 的完整陣列（本遊戲不需要對玩家隱藏效果內容，跟卡片文字本身是公開資訊一致）
  - **移除** `game:pendingCardDraw` 廣播（見 Global Constraints）

- [ ] **Step 1: 寫失敗測試**

修改 `server/test/socketHandlers.test.js` 開頭，加入 `createEffectResolverManager` 的 import：

```js
const ioClient = require('socket.io-client');
const { createServer } = require('../src/createServer');
const { LobbyManager } = require('../src/lobbyManager');
const { registerSocketHandlers } = require('../src/socketHandlers');
const { createGameManager } = require('../src/game/gameManager');
const { createCharacterSelectionManager } = require('../src/game/characterSelectionManager');
const { createEffectResolverManager } = require('../src/game/effectResolverManager');
```

把 `makeContent` 改成新增 `cards` 欄位：

```js
function makeContent(overrides = {}) {
  return {
    characters: [
      { id: 'char_001', codename: 'Alice-character', stats: makeStats() },
      { id: 'char_002', codename: 'Bob-character', stats: makeStats() },
    ],
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    startingRooms: [
      { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
      { id: 'room_foyer', name: '廊廳', floor: 'ground' },
      { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
    ],
    cards: { events: [], items: [], omens: [] },
    ...overrides,
  };
}
```

把 `startTestServer` 改成建立並傳入 `effectResolverManager`：

```js
function startTestServer(content, options) {
  const { httpServer, io } = createServer();
  const lobbyManager = new LobbyManager();
  const gameManager = createGameManager();
  const characterSelectionManager = createCharacterSelectionManager();
  const effectResolverManager = createEffectResolverManager();
  registerSocketHandlers(
    io,
    lobbyManager,
    gameManager,
    characterSelectionManager,
    effectResolverManager,
    content || makeContent(),
    options
  );
  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      resolve({ httpServer, port: httpServer.address().port, lobbyManager, gameManager, characterSelectionManager, effectResolverManager });
    });
  });
}
```

在檔案最後（`setUpStartedGame` 之後、既有測試之後）新增：

```js
test('game:move into a room with a populated item deck draws a card and resolves its non-choice effects', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{ id: 'item_001', name: '測試道具', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.deckType).toBe('item');
  expect(cardDrawn.cardId).toBe('item_001');

  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.cardId).toBe('item_001');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into a room whose deck is empty draws nothing and does not crash', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: { events: [], items: [], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  let cardDrawnFired = false;
  currentClient.on('game:cardDrawn', () => {
    cardDrawnFired = true;
  });
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(result.error).toBeUndefined();
  await updatePromise;
  expect(cardDrawnFired).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into a room whose card effects include a choice broadcasts game:effectPendingChoice instead of resolving immediately', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  expect(pendingChoice.description).toBe('選擇要下降哪項');
  expect(pendingChoice.options).toHaveLength(2);

  clientA.close();
  clientB.close();
  httpServer.close();
});

async function setUpStartedGameWithContent(content) {
  const { httpServer, port } = await startTestServer(content);
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const roomCode = created.roomCode;
  const aliceId = created.playerId;

  const clientB = ioClient(url);
  const joined = await new Promise((resolve) =>
    clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve)
  );
  const bobId = joined.playerId;

  const started = new Promise((resolve) => clientA.once('game:started', resolve));
  const firstPromptA = new Promise((resolve) => clientA.once('game:prompt', resolve));
  const firstPromptB = new Promise((resolve) => clientB.once('game:prompt', resolve));
  await new Promise((resolve) => clientA.emit('game:startCharacterSelect', {}, resolve));
  const [prompt1] = await Promise.all([firstPromptA, firstPromptB]);
  const firstPickerClient = prompt1.targetPlayerId === aliceId ? clientA : clientB;
  const secondPickerClient = prompt1.targetPlayerId === aliceId ? clientB : clientA;

  const secondPrompt = new Promise((resolve) => secondPickerClient.once('game:prompt', resolve));
  await new Promise((resolve) =>
    firstPickerClient.emit('game:promptRespond', { promptId: prompt1.promptId, optionId: prompt1.options[0] }, resolve)
  );
  const prompt2 = await secondPrompt;
  await new Promise((resolve) =>
    secondPickerClient.emit('game:promptRespond', { promptId: prompt2.promptId, optionId: prompt2.options[0] }, resolve)
  );

  const startedPayload = await started;
  const currentPlayerId = startedPayload.turnOrder[startedPayload.currentPlayerIndex];
  const currentClient = currentPlayerId === aliceId ? clientA : clientB;
  const otherClient = currentPlayerId === aliceId ? clientB : clientA;

  return { httpServer, clientA, clientB, roomCode, aliceId, bobId, currentClient, otherClient, currentPlayerId, startedPayload };
}
```

**注意**：`setUpStartedGameWithContent` 是把既有的 `setUpStartedGame()`（無參數版本，內部固定呼叫 `startTestServer()`）改寫成接受自訂 `content` 的版本，兩者流程完全一樣。既有的 `setUpStartedGame()` 定義維持不動（後面既有測試還在用它）。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js`
Expected: FAIL——新的三個測試會失敗（`game:cardDrawn`/`game:effectResolved`/`game:effectPendingChoice` 從未被觸發，因為 `registerSocketHandlers` 還不接受 `effectResolverManager` 參數，`content.cards` 也還沒被讀取）；本階段其餘既有測試應該仍然通過（`registerSocketHandlers` 多一個參數但呼叫端已經在 Step 1 一併改好）

- [ ] **Step 3: 實作**

修改 `server/src/index.js`：

```js
const { createServer } = require('./createServer');
const { LobbyManager } = require('./lobbyManager');
const { registerSocketHandlers } = require('./socketHandlers');
const { createGameManager } = require('./game/gameManager');
const { createCharacterSelectionManager } = require('./game/characterSelectionManager');
const { createEffectResolverManager } = require('./game/effectResolverManager');
const {
  loadCharacters,
  loadRooms,
  loadStartingRooms,
  loadEventCards,
  loadItemCards,
  loadOmenCards,
} = require('./game/contentLoader');

const PORT = process.env.PORT || 3001;
const { httpServer, io } = createServer();
const lobbyManager = new LobbyManager();
const gameManager = createGameManager();
const characterSelectionManager = createCharacterSelectionManager();
const effectResolverManager = createEffectResolverManager();
const content = {
  characters: loadCharacters(),
  rooms: loadRooms(),
  startingRooms: loadStartingRooms(),
  cards: {
    events: loadEventCards(),
    items: loadItemCards(),
    omens: loadOmenCards(),
  },
};
registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`伺服器已啟動：http://0.0.0.0:${PORT}`);
});
```

修改 `server/src/socketHandlers.js`：頂部 `require` 區塊改成：

```js
const {
  startSelection,
  getSelection: getCharacterSelection,
  endSelection,
} = require('./game/characterSelectionManager');
const {
  getCurrentPicker,
  getAvailableCharacterIds,
  confirmCharacterChoice,
  assignRandomCharacter,
  isCharacterSelectionComplete,
  getAssignments,
} = require('./game/characterSelection');
const { createPrompt, respondToPrompt, resolvePromptTimeout } = require('./game/promptState');
const { startGame, getGameState } = require('./game/gameManager');
const { serializeGameState, getPlayer } = require('./game/gameState');
const { moveToRoom, selectAction, useStairs, isTurnOver, advanceTurn } = require('./game/turnFlow');
const { startResolver, getResolver } = require('./game/effectResolverManager');
const { resolveEffects } = require('./game/effectResolver');
const { hasCards, drawCard } = require('./game/cardDeck');

const DEFAULT_CHARACTER_SELECT_TIMEOUT_MS = 30000;

const DECK_FIELD_BY_TYPE = { item: 'itemDeck', event: 'eventDeck', omen: 'omenDeck' };
```

把 `registerSocketHandlers` 的函式簽名改成新增 `effectResolverManager` 參數：

```js
function registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, options = {}) {
```

（函式內其餘既有的 `characterSelectTimeoutMs`/`characterSelectTimeouts` 那兩行不變。）

把 `game:move` 的 handler 改成：

```js
    socket.on('game:move', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        const { direction } = payload || {};
        const result = moveToRoom(gameState, playerId, direction);
        ack(result);
        if (result.pendingCardDraw) {
          resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck);
        }
        advanceTurnIfOver(gameState, playerId);
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:move error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

在 `finishCharacterSelection` 裡，`startGame` 呼叫加入 `cards`，並在成功後建立 resolver：

```js
function finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode) {
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
  const lobbyPlayersById = new Map(lobbyManager.getPlayers(roomCode).map((p) => [p.playerId, p]));
  const assignments = getAssignments(entry.characterSelectionState);
  const players = entry.characterSelectionState.order.map((playerId) => ({
    playerId,
    name: lobbyPlayersById.has(playerId) ? lobbyPlayersById.get(playerId).name : playerId,
    characterId: assignments.get(playerId),
  }));
  const gameState = startGame(gameManager, roomCode, {
    startingRooms: content.startingRooms,
    rooms: content.rooms,
    cards: content.cards,
    characters: content.characters,
    players,
  });
  startResolver(effectResolverManager, roomCode);
  endSelection(characterSelectionManager, roomCode);
  io.to(roomCode).emit('game:started', serializeGameState(gameState));
}
```

`finishCharacterSelection` 現在多一個參數，`effectResolverManager` 要從 `game:startCharacterSelect`／`game:promptRespond` 這兩個 handler，一路穿過 `advanceCharacterSelection`、`handleCharacterSelectTimeout`，傳到 `finishCharacterSelection`。把下面幾個函式整個換成這樣（純參數穿遞，邏輯不變）：

`advanceCharacterSelection` 函式整個換成：

```js
function advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts) {
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
  if (isCharacterSelectionComplete(entry.characterSelectionState)) {
    finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode);
    return;
  }
  const picker = getCurrentPicker(entry.characterSelectionState);
  const available = getAvailableCharacterIds(entry.characterSelectionState);
  const prompt = createPrompt(entry.promptState, {
    type: 'character_select',
    targetPlayerId: picker,
    description: '請選擇角色',
    options: available,
    timeoutMs: characterSelectTimeoutMs,
    now: Date.now(),
  });
  io.to(roomCode).emit('game:prompt', prompt);
  io.to(roomCode).emit('game:characterSelectUpdate', serializeCharacterSelection(entry.characterSelectionState));
  const handle = setTimeout(() => {
    handleCharacterSelectTimeout(
      io,
      lobbyManager,
      gameManager,
      characterSelectionManager,
      effectResolverManager,
      content,
      roomCode,
      prompt.promptId,
      picker,
      characterSelectTimeoutMs,
      characterSelectTimeouts
    );
  }, characterSelectTimeoutMs);
  characterSelectTimeouts.set(roomCode, handle);
}
```

`handleCharacterSelectTimeout` 函式整個換成：

```js
function handleCharacterSelectTimeout(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, promptId, playerId, characterSelectTimeoutMs, characterSelectTimeouts) {
  try {
    const entry = getCharacterSelection(characterSelectionManager, roomCode);
    if (!entry) return;
    characterSelectTimeouts.delete(roomCode);
    const characterId = assignRandomCharacter(entry.characterSelectionState, playerId);
    const result = resolvePromptTimeout(entry.promptState, { promptId, defaultOptionId: characterId });
    if (!result) {
      return;
    }
    io.to(roomCode).emit('game:promptResolved', result);
    advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts);
  } catch (err) {
    console.error('character select timeout error', err);
  }
}
```

在 `game:startCharacterSelect` handler 內，把呼叫 `advanceCharacterSelection` 的那一行換成：

```js
        advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts);
```

在 `game:promptRespond` handler 內，把呼叫 `advanceCharacterSelection` 的那一行換成：

```js
        advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts);
```

（這兩個 handler 其餘程式碼不變，只有這一行呼叫多帶一個參數。）

新增 `resolveCardDraw` 私有函式（放在 `advanceTurnIfOver` 函式定義之後）：

```js
function resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, deckType) {
  const deck = gameState[DECK_FIELD_BY_TYPE[deckType]];
  if (!hasCards(deck)) {
    return;
  }
  const card = drawCard(deck);
  io.to(roomCode).emit('game:cardDrawn', { playerId, deckType, cardId: card.id, cardName: card.name });
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, { now: Date.now() });
  if (effectResult.pending) {
    resolverEntry.pendingChoice = {
      promptId: effectResult.promptId,
      options: effectResult.options,
      defaultOptionId: effectResult.defaultOptionId,
      playerId,
      cardId: card.id,
    };
    io.to(roomCode).emit('game:effectPendingChoice', {
      playerId,
      promptId: effectResult.promptId,
      description: effectResult.description,
      options: effectResult.options,
    });
  } else {
    io.to(roomCode).emit('game:effectResolved', { playerId, cardId: card.id });
  }
}
```

**注意**：這個任務先不排逾時 `setTimeout`、也還沒有 `game:effectPromptRespond` handler——那是 Task 6 的範圍。這個任務跑完後，`game:effectPendingChoice` 廣播得出去，但玩家還沒有回應的管道，這是刻意分階段（先讓「觸發」路徑可測，Task 6 再補「回應」路徑），Task 6 完成前不要合併到 main。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js`
Expected: PASS，全部測試通過

Run: `cd server && npx jest`
Expected: PASS，全部既有測試（M1/M2a/M2b/M2c-1）加上本任務新增的測試全綠

- [ ] **Step 5: Commit**

```bash
git add server/src/index.js server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(m2c2): wire effectResolverManager and auto-resolve card draws in game:move"
```

---

## Task 6: socketHandlers.js — game:effectPromptRespond 與逾時處理

**Files:**
- Modify: `server/src/socketHandlers.js`
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `resolveChoiceOption` from `./game/effectResolver`（M2c-1 已完成）；`respondToPrompt`、`resolvePromptTimeout` from `./game/promptState`（既有）
- Produces:
  - `game:effectPromptRespond`（client→server）：`{promptId, optionId}`
  - `game:promptResolved`（廣播，沿用既有的通用事件名稱，跟選角色共用同一個事件名）
  - `options.effectChoiceTimeoutMs`（新增，比照 `characterSelectTimeoutMs` 的測試注入模式，預設值見下方實作）

- [ ] **Step 1: 寫失敗測試**

在 `server/test/socketHandlers.test.js` 最後（Task 5 新增的三個測試之後）新增：

```js
test('game:effectPromptRespond resolves the pending choice and applies the chosen effects', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const respondResult = await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });
  expect(respondResult.error).toBeUndefined();

  await effectResolvedPromise;
  const update = await updatePromise;
  const me = update.players.find((p) => p.playerId === currentPlayerId);
  expect(me.stats.speed.currentIndex).toBe(me.stats.speed.baseIndex - 1);
  expect(me.stats.might.currentIndex).toBe(me.stats.might.baseIndex); // untouched

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:effectPromptRespond rejects when there is no pending effect choice for the room', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: 'not_real', optionId: 'anything' }, resolve);
  });
  expect(result.error).toBe('NO_ACTIVE_EFFECT_CHOICE');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('an effect choice that times out auto-resolves with the default option', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 50,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const promptResolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  const stateUpdatePromise = new Promise((resolve) => {
    currentClient.on('game:stateUpdate', (data) => {
      const me = data.players.find((p) => p.playerId === currentPlayerId);
      if (me.stats.might.currentIndex < me.stats.might.baseIndex) resolve(data);
    });
  });
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const resolved = await promptResolvedPromise;
  expect(resolved.wasTimeout).toBe(true);
  expect(resolved.chosenOptionId).toBe('opt_might');
  await stateUpdatePromise; // proves the default option's effects were actually applied

  clientA.close();
  clientB.close();
  httpServer.close();
}, 2000);
```

（這個測試用卡片本身的 `timeoutMs: 50` 就會很快逾時，不需要額外的 server 層級選項。）

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js`
Expected: FAIL——`game:effectPromptRespond` 還沒有 handler，逾時也還沒被排程

- [ ] **Step 3: 實作**

在 `socketHandlers.js` 裡，`registerSocketHandlers` 函式內、`characterSelectTimeouts` 那行旁邊，新增一個 effect-choice 專用的逾時 Map：

```js
  const characterSelectTimeoutMs = options.characterSelectTimeoutMs || DEFAULT_CHARACTER_SELECT_TIMEOUT_MS;
  const characterSelectTimeouts = new Map(); // roomCode -> Timeout handle
  const effectChoiceTimeouts = new Map(); // roomCode -> Timeout handle
```

修改 `resolveCardDraw`（Task 5 寫的），讓 pending 分支也排真實計時器；把它拆成兩個函式，`resolveCardDraw` 負責抽卡，`handleResolveResult` 負責處理任何一次 `resolveEffects` 呼叫的結果（不管是抽卡觸發的還是選擇回應後繼續觸發的），因為兩條路徑的「卡在 choice 就廣播+排計時器，否則廣播 effectResolved」邏輯完全一樣：

```js
function resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, deckType, effectChoiceTimeouts) {
  const deck = gameState[DECK_FIELD_BY_TYPE[deckType]];
  if (!hasCards(deck)) {
    return;
  }
  const card = drawCard(deck);
  io.to(roomCode).emit('game:cardDrawn', { playerId, deckType, cardId: card.id, cardName: card.name });
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, { now: Date.now() });
  handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, card.id, effectResult, effectChoiceTimeouts);
}

function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, cardId, effectResult, effectChoiceTimeouts) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending) {
    resolverEntry.pendingChoice = {
      promptId: effectResult.promptId,
      options: effectResult.options,
      defaultOptionId: effectResult.defaultOptionId,
      playerId,
      cardId,
    };
    io.to(roomCode).emit('game:effectPendingChoice', {
      playerId,
      promptId: effectResult.promptId,
      description: effectResult.description,
      options: effectResult.options,
    });
    const delayMs = Math.max(effectResult.deadline - Date.now(), 0);
    const handle = setTimeout(() => {
      handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, effectResult.promptId, effectChoiceTimeouts);
    }, delayMs);
    effectChoiceTimeouts.set(roomCode, handle);
  } else {
    resolverEntry.pendingChoice = null;
    io.to(roomCode).emit('game:effectResolved', { playerId, cardId });
  }
}

function clearEffectChoiceTimeout(roomCode, effectChoiceTimeouts) {
  const handle = effectChoiceTimeouts.get(roomCode);
  if (handle) {
    clearTimeout(handle);
    effectChoiceTimeouts.delete(roomCode);
  }
}

function handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, promptId, effectChoiceTimeouts) {
  try {
    const resolverEntry = getResolver(effectResolverManager, roomCode);
    if (!resolverEntry || !resolverEntry.pendingChoice) return;
    effectChoiceTimeouts.delete(roomCode);
    const { playerId, cardId, options, defaultOptionId } = resolverEntry.pendingChoice;
    const result = resolvePromptTimeout(resolverEntry.promptState, { promptId, defaultOptionId });
    if (!result) {
      return;
    }
    io.to(roomCode).emit('game:promptResolved', result);
    const chosenEffects = resolveChoiceOption(options, result.chosenOptionId);
    const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, chosenEffects, { now: Date.now() });
    handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, cardId, nextResult, effectChoiceTimeouts);
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('effect choice timeout error', err);
  }
}
```

把 `resolveCardDraw` 的呼叫端（`game:move` handler）多傳 `effectChoiceTimeouts`：

```js
        if (result.pendingCardDraw) {
          resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck, effectChoiceTimeouts);
        }
```

新增 `game:effectPromptRespond` handler（放在 `game:useStairs` handler 之後、`disconnect` handler 之前）：

```js
    socket.on('game:effectPromptRespond', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        const resolverEntry = getResolver(effectResolverManager, roomCode);
        if (!resolverEntry || !resolverEntry.pendingChoice) {
          return ack({ error: 'NO_ACTIVE_EFFECT_CHOICE' });
        }
        const { promptId, optionId } = payload || {};
        const { playerId: choicePlayerId, cardId, options } = resolverEntry.pendingChoice;
        const result = respondToPrompt(resolverEntry.promptState, { promptId, playerId, optionId });
        clearEffectChoiceTimeout(roomCode, effectChoiceTimeouts);
        io.to(roomCode).emit('game:promptResolved', result);
        const chosenEffects = resolveChoiceOption(options, result.chosenOptionId);
        const nextResult = resolveEffects(gameState, resolverEntry.promptState, choicePlayerId, chosenEffects, { now: Date.now() });
        handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, choicePlayerId, cardId, nextResult, effectChoiceTimeouts);
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
        ack({});
      } catch (err) {
        console.error('game:effectPromptRespond error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js`
Expected: PASS

Run: `cd server && npx jest`
Expected: PASS，全部測試通過

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(m2c2): add game:effectPromptRespond and real-timer timeout for effect choices"
```

---

## Task 7: DebugGameScreen.jsx — 顯示抽卡與效果解析結果

**Files:**
- Modify: `client/src/DebugGameScreen.jsx`

**Interfaces:**
- Consumes: `game:cardDrawn`、`game:effectPendingChoice`、`game:effectResolved`（新事件，本任務新增監聽）；`game:effectPromptRespond`（本任務新增發送）
- Produces: 無新匯出（React 元件本身）

**這個任務沒有自動化測試**——延續 M2b-2 除錯頁面「純顯示、手動點擊驗證」的定位，不是正式美術。完成後請你手動啟動前後端跑一次「開門 → 抽到卡 → （若有選擇）點選項 → 看到效果套用在數值上」的流程確認。

- [ ] **Step 1: 修改**

在 `client/src/DebugGameScreen.jsx` 的 state 區塊（`actionError` 那行之後）新增：

```jsx
  const [lastCardDrawn, setLastCardDrawn] = useState(null);
  const [pendingEffectChoice, setPendingEffectChoice] = useState(null);
  const [lastEffectResolved, setLastEffectResolved] = useState(null);
```

在 `useEffect` 內，`onPendingAction` 定義之後新增對應的 handler：

```jsx
    function onCardDrawn(data) {
      setLastCardDrawn(data);
    }
    function onEffectPendingChoice(data) {
      setPendingEffectChoice(data);
    }
    function onEffectResolved(data) {
      setLastEffectResolved(data);
      setPendingEffectChoice(null);
    }
```

把這三個事件加進 `socket.on(...)` 跟 `socket.off(...)` 兩處：

```jsx
    socket.on('game:cardDrawn', onCardDrawn);
    socket.on('game:effectPendingChoice', onEffectPendingChoice);
    socket.on('game:effectResolved', onEffectResolved);
```

```jsx
      socket.off('game:cardDrawn', onCardDrawn);
      socket.off('game:effectPendingChoice', onEffectPendingChoice);
      socket.off('game:effectResolved', onEffectResolved);
```

在 `handleUseStairs` 函式之後新增：

```jsx
  function handleEffectChoiceRespond(optionId) {
    if (!pendingEffectChoice) return;
    socket.emit('game:effectPromptRespond', { promptId: pendingEffectChoice.promptId, optionId }, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }
```

在 `phase === 'playing'` 區塊裡，`{lastPendingAction && ...}` 那行之後新增顯示區塊：

```jsx
          {lastCardDrawn && <p>抽到的卡：{JSON.stringify(lastCardDrawn)}</p>}
          {lastEffectResolved && <p>效果已解析完成：{JSON.stringify(lastEffectResolved)}</p>}
          {pendingEffectChoice && (
            <div>
              <p>效果選擇中：{pendingEffectChoice.description}</p>
              <ul>
                {pendingEffectChoice.options.map((o) => (
                  <li key={o.optionId}>
                    {o.label || o.optionId}
                    <button onClick={() => handleEffectChoiceRespond(o.optionId)}>選這個</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
```

- [ ] **Step 2: 手動驗證**

啟動伺服器與前端（`cd server && npm start` 另開一個終端 `cd client && npm run dev`），走一次大廳建房 → 選角色 → 開門移動 → 觸發抽卡的流程，確認畫面上看得到抽到的卡、效果解析結果、有選擇時能點按鈕送出並看到 `game:stateUpdate` 反映結果。

- [ ] **Step 3: Commit**

```bash
git add client/src/DebugGameScreen.jsx
git commit -m "feat(m2c2): display card draw and effect resolution in debug screen"
```
