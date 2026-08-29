# item_044 隨機效果機制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `item_044`（有限手套）能「不擲骰、直接隨機挑一項效果執行」，涵蓋卡面 1-6 項（第7項留給 M3）。

**Architecture:** 新增 `random_effect` 效果類型（均等機率隨機挑一個選項的 `effects` 執行，結構比照既有 `choice` 的 `options` 陣列）；新增 `move_to_random_neighbor_room` 效果類型（重用 `event_029` 建立的 `canMoveBetween` 門連接判斷，從已生成且門連接的鄰房中隨機挑一個移動過去）。

**Tech Stack:** Node.js（`server/src/game/`），Jest 測試（`server/test/game/`、`server/test/socketHandlers.test.js`）。

## Global Constraints

- `random_effect` 的 `options` 陣列每個選項均等機率（`Math.floor(Math.random() * options.length)`），不支援加權
- `random_effect` 的 `options` 為空陣列或缺少時拋 `INVALID_RANDOM_EFFECT_OPTIONS`
- `move_to_random_neighbor_room` 只在「已生成且門連接」的鄰房中隨機挑（重用 `canMoveBetween`，不含單純格子相鄰或未生成的鄰房）；沒有任何合格鄰房時無效果（`appliedCount:0`），不拋錯
- `move_to_random_neighbor_room` 的 `enteredFromSide` 要設成移動方向的對側（比照一般開門移動的既有寫法），不是 `null`——這跟上一個分支的 `move_to_previous_room`（給 `null`）不同，因為這是真的「走過一扇門」的移動
- `item_044` 這次只放 1-6 項（各 1/6 機率），第7項（消滅房間內其他所有角色）留給 M3，屆時直接在 `options` 陣列補上第7個元素即可

---

### Task 1: 新效果類型 `move_to_random_neighbor_room`

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: `canMoveBetween(board, floor, {x,y}, direction)`（`boardGenerator.js` 已匯出）、`SIDES`（`doorLayout.js` 已匯出）、`DIRECTION_DELTA`（`boardGenerator.js` 已匯出）、`OPPOSITE_SIDE`（`doorLayout.js` 已匯出）、`movePlayerTo`（`playerEntity.js` 已匯出）——這些在 `effectResolver.js` 檔案開頭都已經 `require` 進來，不用新增 import
- Produces: 效果類型 `move_to_random_neighbor_room`（無額外欄位），供 Task 3 的 `item_044` 資料使用

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolver.test.js` 找到這個測試（搜尋 `'resolveEffects move_to_previous_room does nothing when there is no previous position'`），在它結束的 `});` 後面加：

```javascript
test('resolveEffects move_to_random_neighbor_room moves to the only door-connected neighbor and sets enteredFromSide to the opposite side', () => {
  const gameState = makeGameStateWithPlayer();
  // room_lobby_a (player's start, 0,1) has doors north/east/west (see boardGenerator.js
  // createBoard). Only north (0,0, room_lobby_b) is an already-placed, door-connected
  // neighbor -- east/west lead to unplaced grid positions. With a single candidate, the
  // outcome is deterministic regardless of rng.
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'move_to_random_neighbor_room' },
  ]);
  const player = gameState.players.get('p1');
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(0);
  expect(player.y).toBe(0);
  expect(player.enteredFromSide).toBe('south'); // opposite of the north direction traveled
});

test('resolveEffects move_to_random_neighbor_room does nothing when there is no door-connected, already-placed neighbor', () => {
  const gameState = makeGameStateWithPlayer();
  gameState.board.ground.get('0,1').doorSides = []; // strip all doors so no direction can ever qualify
  const player = gameState.players.get('p1');
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'move_to_random_neighbor_room' },
  ]);
  expect(result).toEqual({ pending: false, appliedCount: 0 });
  expect(player.x).toBe(0);
  expect(player.y).toBe(1);
});

test('resolveEffects move_to_random_neighbor_room picks different door-connected neighbors depending on rng', () => {
  function setupWithDecoy() {
    const gameState = makeGameStateWithPlayer();
    // Manually place a SECOND door-connected neighbor to the east, so there are two
    // genuine candidates (north: room_lobby_b, east: this decoy) to prove the choice
    // actually varies with rng rather than there only ever being one option.
    gameState.board.ground.set('1,1', { roomId: 'room_x', x: 1, y: 1, doorSides: ['west'], droppedItems: [], item: null });
    return gameState;
  }

  const gameStateLow = setupWithDecoy();
  const rngLow = jest.spyOn(Math, 'random').mockReturnValue(0);
  resolveEffects(gameStateLow, createPromptState(), 'p1', [{ type: 'move_to_random_neighbor_room' }]);
  rngLow.mockRestore();
  const playerLow = gameStateLow.players.get('p1');

  const gameStateHigh = setupWithDecoy();
  const rngHigh = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  resolveEffects(gameStateHigh, createPromptState(), 'p1', [{ type: 'move_to_random_neighbor_room' }]);
  rngHigh.mockRestore();
  const playerHigh = gameStateHigh.players.get('p1');

  const lowDestination = [playerLow.x, playerLow.y];
  const highDestination = [playerHigh.x, playerHigh.y];
  expect(lowDestination).not.toEqual(highDestination);
  expect([lowDestination, highDestination]).toEqual(expect.arrayContaining([[0, 0], [1, 1]]));
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "move_to_random_neighbor_room"`
Expected: FAIL（`UNSUPPORTED_EFFECT_TYPE`，`move_to_random_neighbor_room` 還沒註冊）

- [ ] **Step 3: 修改 `effectResolver.js`**

在 `handleMoveToPreviousRoom` 函式（搜尋 `function handleMoveToPreviousRoom`）後面加一個新函式：

```javascript
function handleMoveToRandomNeighborRoom(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const candidates = [];
  for (const side of SIDES) {
    if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, side)) {
      candidates.push(side);
    }
  }
  if (candidates.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const chosenSide = candidates[Math.floor(Math.random() * candidates.length)];
  const delta = DIRECTION_DELTA[chosenSide];
  const enteredNewRoom = movePlayerTo(player, player.floor, player.x + delta.dx, player.y + delta.dy, OPPOSITE_SIDE[chosenSide]);
  return { pending: false, enteredNewRoom };
}
```

在 `HANDLERS` 物件裡，`move_to_previous_room:` 那一行後面加一行：

```javascript
  move_to_random_neighbor_room: (gameState, promptState, playerId) => handleMoveToRandomNeighborRoom(gameState, playerId),
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "move_to_random_neighbor_room"`
Expected: PASS（3 個新測試全過）

- [ ] **Step 5: 跑整個 `server` 測試套件確認沒有破壞既有測試**

Run: `cd server && npm test`
Expected: 全數 PASS（652 既有 + 3 新增 = 655）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat: add move_to_random_neighbor_room effect type"
```

---

### Task 2: 新效果類型 `random_effect`

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: `resolveEffects(gameState, promptState, playerId, effects, context)`（同檔案既有函式，透過 hoisting 可以在檔案較前段呼叫）
- Produces: 效果類型 `random_effect`（`options: [{effects: [...]}]`），供 Task 3 的 `item_044` 資料使用。與 Task 1 相互獨立，不依賴 Task 1 的產出（測試各自用簡單的 `stat_change` 驗證，不需要 `move_to_random_neighbor_room`）

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolver.test.js` 找到這個測試（搜尋 `'resolveEffects move_to_random_neighbor_room picks different door-connected neighbors depending on rng'`），在它結束的 `});` 後面加：

```javascript
test('resolveEffects random_effect executes the effects of the option rng lands on', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // 0.99 * 3 options -> index 2 (the last option)
  resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'random_effect',
      options: [
        { effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
        { effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
        { effects: [{ type: 'stat_change', stat: 'knowledge', delta: -1 }] },
      ],
    },
  ]);
  rngSpy.mockRestore();
  expect(player.stats.might.currentIndex).toBe(2); // unchanged (baseIndex)
  expect(player.stats.speed.currentIndex).toBe(2); // unchanged (baseIndex)
  expect(player.stats.knowledge.currentIndex).toBe(0); // baseIndex 1 - 1, this option fired
});

test('resolveEffects random_effect picks a different option with a different rng value', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // 0 * 2 options -> index 0 (the first option)
  resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'random_effect',
      options: [
        { effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
        { effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
      ],
    },
  ]);
  rngSpy.mockRestore();
  expect(player.stats.might.currentIndex).toBe(1); // baseIndex 2 - 1, this option fired
  expect(player.stats.speed.currentIndex).toBe(2); // unchanged
});

test('resolveEffects random_effect throws INVALID_RANDOM_EFFECT_OPTIONS for an empty options array', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'random_effect', options: [] }])
  ).toThrow('INVALID_RANDOM_EFFECT_OPTIONS');
});

test('resolveEffects random_effect throws INVALID_RANDOM_EFFECT_OPTIONS when options is missing', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'random_effect' }])
  ).toThrow('INVALID_RANDOM_EFFECT_OPTIONS');
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "random_effect"`
Expected: FAIL（`UNSUPPORTED_EFFECT_TYPE`，`random_effect` 還沒註冊）

- [ ] **Step 3: 修改 `effectResolver.js`**

在 `handleMoveToRandomNeighborRoom` 函式（Task 1 剛加的，搜尋 `function handleMoveToRandomNeighborRoom`）後面加一個新函式：

```javascript
function handleRandomEffect(gameState, promptState, playerId, effect, context) {
  if (!Array.isArray(effect.options) || effect.options.length === 0) {
    throw new Error('INVALID_RANDOM_EFFECT_OPTIONS');
  }
  const index = Math.floor(Math.random() * effect.options.length);
  return resolveEffects(gameState, promptState, playerId, effect.options[index].effects, context);
}
```

在 `HANDLERS` 物件裡，Task 1 剛加的 `move_to_random_neighbor_room:` 那一行後面加一行：

```javascript
  random_effect: (gameState, promptState, playerId, effect, context) => handleRandomEffect(gameState, promptState, playerId, effect, context),
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "random_effect"`
Expected: PASS（4 個新測試全過）

- [ ] **Step 5: 跑整個 `server` 測試套件確認沒有破壞既有測試**

Run: `cd server && npm test`
Expected: 全數 PASS（655 既有 + 4 新增 = 659）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat: add random_effect effect type"
```

---

### Task 3: `item_044` 資料串接與端對端測試

**Files:**
- Modify: `data/cards/item-cards.json`（`item_044`）
- Test: `server/test/game/effectResolver.test.js`（資料層完整性測試）
- Test: `server/test/socketHandlers.test.js`（端對端測試）

**Interfaces:**
- Consumes: Task 1 的 `move_to_random_neighbor_room`、Task 2 的 `random_effect`（純資料串接與整合測試，不寫新的伺服器邏輯）

- [ ] **Step 1: 寫失敗的資料層完整性測試**

在 `server/test/game/effectResolver.test.js` 找到這個測試（搜尋 `'item_038 in data/cards/item-cards.json has the expected setToLevel/revertAtNextTurnStart effects'`），在它結束的 `});` 後面加：

```javascript
test('item_044 in data/cards/item-cards.json has the expected random_effect options for items 1-6', () => {
  const itemCards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/cards/item-cards.json'), 'utf8'));
  const item044 = itemCards.find((c) => c.id === 'item_044');
  expect(item044).toBeDefined();
  expect(item044.effects).toEqual([
    {
      type: 'random_effect',
      options: [
        { effects: [{ type: 'move_to_random_neighbor_room' }] },
        { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] },
        { effects: [{ type: 'stat_change', stat: 'knowledge', delta: -1 }] },
        { effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
        { effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
        { effects: [{ type: 'action_points', setTo: 0 }] },
      ],
    },
  ]);
});
```

- [ ] **Step 2: 寫失敗的端對端測試**

在 `server/test/socketHandlers.test.js` 找到這個測試（搜尋 `'game:selectAction item: uses a held consumable item on self and removes it from inventory after it applies'`），在它結束的 `});` 後面加：

```javascript
test('game:selectAction item_044 with rng landing on option 6 (行動力歸零): resets action points to 0', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_044',
        name: '有限手套',
        effects: [{
          type: 'random_effect',
          options: [
            { effects: [{ type: 'move_to_random_neighbor_room' }] },
            { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'knowledge', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
            { effects: [{ type: 'action_points', setTo: 0 }] },
          ],
        }],
        category: 'reusable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_044' });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // 0.99 * 6 options -> index 5 (action_points setTo 0)
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_044' }, resolve));
  await effectResolvedPromise;
  rngSpy.mockRestore();

  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_044 with rng landing on option 1 (移動到隨機一個鄰房): moves the player', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_044',
        name: '有限手套',
        effects: [{
          type: 'random_effect',
          options: [
            { effects: [{ type: 'move_to_random_neighbor_room' }] },
            { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'knowledge', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
            { effects: [{ type: 'action_points', setTo: 0 }] },
          ],
        }],
        category: 'reusable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_044' });
  const before = getPlayer(gameState, currentPlayerId);
  const startFloor = before.floor;
  const startX = before.x;
  const startY = before.y;

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // 0 * 6 options -> index 0 (move_to_random_neighbor_room), then its own rng call picks the first door-connected candidate
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_044' }, resolve));
  await effectResolvedPromise;
  rngSpy.mockRestore();

  const after = getPlayer(gameState, currentPlayerId);
  const moved = after.floor !== startFloor || after.x !== startX || after.y !== startY;
  expect(moved).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd server && npx jest -t "item_044"`
Expected: FAIL（此時真實卡片資料 `item_044` 的 `effects` 還是空陣列 `[]`，使用後不會有任何效果，`actionPoints` 不會歸零、玩家不會移動）

- [ ] **Step 4: 更新 `data/cards/item-cards.json`**

`item_044` 目前的 `"effects": [],` 這一行（搜尋 `"id": "item_044"` 找到該卡片區塊）改成：

```json
    "effects": [
      {
        "type": "random_effect",
        "options": [
          { "effects": [{ "type": "move_to_random_neighbor_room" }] },
          { "effects": [{ "type": "stat_change", "stat": "sanity", "delta": -1 }] },
          { "effects": [{ "type": "stat_change", "stat": "knowledge", "delta": -1 }] },
          { "effects": [{ "type": "stat_change", "stat": "might", "delta": -1 }] },
          { "effects": [{ "type": "stat_change", "stat": "speed", "delta": -1 }] },
          { "effects": [{ "type": "action_points", "setTo": 0 }] }
        ]
      }
    ],
```

其他欄位（`text`／`feedbacktextDice`／`category`／`canTargetOthers`／`needsCustomLogic`）完全不動。

- [ ] **Step 5: 跑測試確認通過**

Run: `cd server && npx jest -t "item_044"`
Expected: PASS（3 個新測試全過——1 個資料層完整性測試＋2 個端對端測試）

- [ ] **Step 6: 跑整個 `server` 測試套件確認沒有破壞既有測試**

Run: `cd server && npm test`
Expected: 全數 PASS（659 既有 + 3 新增 = 662）

- [ ] **Step 7: Commit**

```bash
git add data/cards/item-cards.json server/test/game/effectResolver.test.js server/test/socketHandlers.test.js
git commit -m "feat: wire item_044 to random_effect/move_to_random_neighbor_room (items 1-6)"
```
