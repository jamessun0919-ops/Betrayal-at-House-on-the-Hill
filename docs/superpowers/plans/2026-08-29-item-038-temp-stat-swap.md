# item_038 暫時屬性置換機制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `item_038`（可疑藥丸）能把力量降到「不致死」下限、速度提到最高級別，並在使用者自己的下一輪回合開始時自動恢復。

**Architecture:** `stat_change` 效果新增 `setToLevel`（`"min"`/`"max"`，設到絕對級別而非相對位移）與 `revertAtNextTurnStart`（只在搭配 `setToLevel` 時生效，記錄反向 delta 到新的玩家欄位 `pendingStatReverts`）；`turnFlow.js` 的 `advanceTurn` 換人時（本來就會 `resetActionPoints`）順便套用並清空進來這位玩家的 `pendingStatReverts`。

**Tech Stack:** Node.js（`server/src/game/`），Jest 測試（`server/test/game/`、`server/test/socketHandlers.test.js`）。

## Global Constraints

- `setToLevel` 只接受 `"min"`（目標索引 = `statTrack.skullIndex + 1`）或 `"max"`（目標索引 = `statTrack.track.length - 1`），其他值一律拋 `INVALID_SET_TO_LEVEL`
- `revertAtNextTurnStart: true` 只在效果同時帶 `setToLevel` 時才會生效（不是獨立於 `delta`/`restoreToBase` 的通用開關）
- 還原精度採「反向 delta」簡化法：套用當下實際套用了多少 delta，回復時就套用相反的 delta，不是回到絕對數值快照（跟既有 `remove_imprint` 反向 `stat_change.delta` 的簡化方式一致）
- 「下一輪回合開始」= 這個玩家自己的下一輪（`turnOrder` 輪到他），不是字面上的下一個回合（不論輪到誰）
- 使用時／恢復時都不額外跳提示訊息，恢復時單純靜默更新（走既有的 `game:stateUpdate` 廣播）

---

### Task 1: `stat_change` 新增 `setToLevel`／`revertAtNextTurnStart`，`player.pendingStatReverts` 欄位

**Files:**
- Modify: `server/src/game/playerEntity.js`（`createPlayer` 回傳物件）
- Modify: `server/src/game/effectResolver.js`（`handleStatChange`）
- Test: `server/test/game/playerEntity.test.js`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Produces: `player.pendingStatReverts`（陣列，元素 `{stat: string, delta: number}`），供 Task 2 的 `advanceTurn` 消費
- Produces: `stat_change` 效果的 `setToLevel: "min" | "max"` 與 `revertAtNextTurnStart: boolean` 兩個新欄位，供 Task 3 的 `item_038` 資料使用

- [ ] **Step 1: 寫 `playerEntity.test.js` 的失敗測試——`createPlayer` 初始化 `pendingStatReverts` 為空陣列**

在 `server/test/game/playerEntity.test.js` 第 40-44 行那個 `wornGearIds` 測試後面加：

```javascript
test('createPlayer initializes pendingStatReverts as an empty array', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(player.pendingStatReverts).toEqual([]);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd server && npx jest test/game/playerEntity.test.js -t "pendingStatReverts as an empty array"`
Expected: FAIL（`player.pendingStatReverts` 是 `undefined`）

- [ ] **Step 3: `playerEntity.js` 新增欄位**

在 `server/src/game/playerEntity.js` 的 `createPlayer` 回傳物件裡，`wornGearIds: [],` 這行後面加一行：

```javascript
    pendingStatReverts: [], // {stat, delta} entries applied and cleared by advanceTurn when this player's own next turn starts
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd server && npx jest test/game/playerEntity.test.js -t "pendingStatReverts as an empty array"`
Expected: PASS

- [ ] **Step 5: 寫 `effectResolver.test.js` 的失敗測試——`setToLevel` 套用與 `INVALID_SET_TO_LEVEL`**

在 `server/test/game/effectResolver.test.js` 第 57 行（`restoreToBase only raises` 測試結束）後面加：

```javascript
test('resolveEffects stat_change setToLevel:"min" sets the stat to skullIndex+1 (non-lethal floor)', () => {
  const gameState = makeGameStateWithPlayer();
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', setToLevel: 'min' },
  ]);
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(1); // skullIndex 0 + 1
});

test('resolveEffects stat_change setToLevel:"max" sets the stat to the last track index', () => {
  const gameState = makeGameStateWithPlayer();
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'speed', setToLevel: 'max' },
  ]);
  expect(gameState.players.get('p1').stats.speed.currentIndex).toBe(4); // track.length 5 - 1
});

test('resolveEffects stat_change throws INVALID_SET_TO_LEVEL for an unrecognized setToLevel value', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() => resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', setToLevel: 'bogus' },
  ])).toThrow('INVALID_SET_TO_LEVEL');
});

test('resolveEffects stat_change setToLevel with revertAtNextTurnStart pushes the reverse delta onto player.pendingStatReverts', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', setToLevel: 'min', revertAtNextTurnStart: true },
    { type: 'stat_change', stat: 'speed', setToLevel: 'max', revertAtNextTurnStart: true },
  ]);
  expect(player.stats.might.currentIndex).toBe(1); // baseIndex 2 -> min index 1, delta -1
  expect(player.stats.speed.currentIndex).toBe(4); // baseIndex 2 -> max index 4, delta +2
  expect(player.pendingStatReverts).toEqual([
    { stat: 'might', delta: 1 },  // reverse of the -1 that was applied
    { stat: 'speed', delta: -2 }, // reverse of the +2 that was applied
  ]);
});

test('resolveEffects stat_change setToLevel without revertAtNextTurnStart does not push to pendingStatReverts', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', setToLevel: 'min' },
  ]);
  expect(player.pendingStatReverts).toEqual([]);
});
```

- [ ] **Step 6: 跑測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "setToLevel"`
Expected: FAIL（目前 `handleStatChange` 完全不認得 `setToLevel`，會落到 `else` 分支把 `effect.delta`（`undefined`）丟給 `changeStat`，拋 `INVALID_STAT_DELTA`）

- [ ] **Step 7: `effectResolver.js` 的 `handleStatChange` 加上 `setToLevel` 分支**

把 `server/src/game/effectResolver.js` 第 26-39 行的 `handleStatChange` 整個換成：

```javascript
function handleStatChange(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  if (effect.restoreToBase) {
    const statTrack = player.stats[effect.stat];
    if (!statTrack) {
      throw new Error('UNKNOWN_STAT');
    }
    const delta = Math.max(0, statTrack.baseIndex - statTrack.currentIndex);
    changeStat(player, effect.stat, delta, gameState.hauntStarted);
  } else if (effect.setToLevel) {
    const statTrack = player.stats[effect.stat];
    if (!statTrack) {
      throw new Error('UNKNOWN_STAT');
    }
    let targetIndex;
    if (effect.setToLevel === 'min') {
      targetIndex = statTrack.skullIndex + 1;
    } else if (effect.setToLevel === 'max') {
      targetIndex = statTrack.track.length - 1;
    } else {
      throw new Error('INVALID_SET_TO_LEVEL');
    }
    const delta = targetIndex - statTrack.currentIndex;
    changeStat(player, effect.stat, delta, gameState.hauntStarted);
    if (effect.revertAtNextTurnStart) {
      player.pendingStatReverts.push({ stat: effect.stat, delta: -delta });
    }
  } else {
    changeStat(player, effect.stat, effect.delta, gameState.hauntStarted);
  }
  return { pending: false };
}
```

- [ ] **Step 8: 跑測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "setToLevel"`
Expected: PASS（5 個新測試全過）

- [ ] **Step 9: 跑整個 `server` 測試套件確認沒有破壞既有測試**

Run: `cd server && npm test`
Expected: 全數 PASS（629 既有 + 6 新增 = 635）

- [ ] **Step 10: Commit**

```bash
git add server/src/game/playerEntity.js server/src/game/effectResolver.js server/test/game/playerEntity.test.js server/test/game/effectResolver.test.js
git commit -m "feat: add stat_change setToLevel/revertAtNextTurnStart and player.pendingStatReverts"
```

---

### Task 2: `advanceTurn` 套用並清空進來這位玩家的 `pendingStatReverts`

**Files:**
- Modify: `server/src/game/turnFlow.js`（`advanceTurn`）
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: `player.pendingStatReverts`（Task 1 產出，陣列 `{stat, delta}`）、`changeStat(player, stat, delta, hauntStarted)`（`playerEntity.js` 既有函式，`turnFlow.js` 已經 `require` 進來）

- [ ] **Step 1: 寫 `turnFlow.test.js` 的失敗測試**

在 `server/test/game/turnFlow.test.js` 第 470 行（`advanceTurn resets the next player action points...` 測試結束）後面加：

```javascript
test('advanceTurn applies the next player\'s pending stat reverts and clears them', () => {
  const { gameState } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  player2.stats.might.currentIndex = 1; // was dropped to min (skullIndex 0 + 1)
  player2.stats.speed.currentIndex = 4; // was raised to max (track.length 5 - 1)
  player2.pendingStatReverts = [{ stat: 'might', delta: 1 }, { stat: 'speed', delta: -2 }];
  advanceTurn(gameState);
  expect(player2.stats.might.currentIndex).toBe(2); // 1 + 1 reverted -> back to baseIndex
  expect(player2.stats.speed.currentIndex).toBe(2); // 4 - 2 reverted -> back to baseIndex
  expect(player2.pendingStatReverts).toEqual([]);
});

test('advanceTurn does not touch a player whose pendingStatReverts is empty', () => {
  const { gameState } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  advanceTurn(gameState);
  expect(player2.stats.might.currentIndex).toBe(2); // unchanged (baseIndex)
  expect(player2.pendingStatReverts).toEqual([]);
});

test('advanceTurn does not apply the outgoing player\'s own pendingStatReverts (only the incoming player\'s)', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  player.pendingStatReverts = [{ stat: 'might', delta: 5 }]; // p1 (outgoing) has one queued
  advanceTurn(gameState);
  expect(player.stats.might.currentIndex).toBe(2); // untouched -- not p1's turn yet
  expect(player.pendingStatReverts).toEqual([{ stat: 'might', delta: 5 }]); // still queued, not cleared
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd server && npx jest test/game/turnFlow.test.js -t "pendingStatReverts"`
Expected: FAIL（第一個測試：`player2.stats.might.currentIndex` 還是 1，沒被還原；第三個測試通過是巧合，因為目前本來就沒有任何相關程式碼會動它——先確認前兩個測試確實失敗即可）

- [ ] **Step 3: `turnFlow.js` 的 `advanceTurn` 加上還原邏輯**

在 `server/src/game/turnFlow.js` 的 `advanceTurn`（第 613-633 行）裡，`resetActionPoints(nextPlayer);` 這行後面、`return nextPlayerId;` 前面插入：

```javascript
  for (const revert of nextPlayer.pendingStatReverts) {
    changeStat(nextPlayer, revert.stat, revert.delta, gameState.hauntStarted);
  }
  nextPlayer.pendingStatReverts = [];
```

（`changeStat` 已經在檔案開頭的 `require('./playerEntity')` 解構列表裡，不用新增 import。）

- [ ] **Step 4: 跑測試確認通過**

Run: `cd server && npx jest test/game/turnFlow.test.js -t "pendingStatReverts"`
Expected: PASS（3 個新測試全過）

- [ ] **Step 5: 跑整個 `server` 測試套件確認沒有破壞既有測試**

Run: `cd server && npm test`
Expected: 全數 PASS（635 既有 + 3 新增 = 638）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat: advanceTurn applies and clears the incoming player's pendingStatReverts"
```

---

### Task 3: `item_038` 資料串接與端對端測試

**Files:**
- Modify: `data/cards/item-cards.json`（`item_038`）
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 1 的 `stat_change` `setToLevel`/`revertAtNextTurnStart`、Task 2 的 `advanceTurn` 還原邏輯（純資料串接與整合測試，不寫新的伺服器邏輯）

- [ ] **Step 1: 寫 `socketHandlers.test.js` 的失敗端對端測試**

在 `server/test/socketHandlers.test.js` 第 2636 行（`game:selectAction item: uses a held consumable item on self...` 測試結束）後面加：

```javascript
test('game:selectAction item_038 sets might to the non-lethal floor and speed to max, reverting both at the start of the user\'s next turn', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_038',
        name: '可疑藥丸',
        effects: [
          { type: 'stat_change', stat: 'might', setToLevel: 'min', revertAtNextTurnStart: true },
          { type: 'stat_change', stat: 'speed', setToLevel: 'max', revertAtNextTurnStart: true },
        ],
        category: 'consumable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_038' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_038' }, resolve));
  await effectResolvedPromise;

  let me = getPlayer(gameState, currentPlayerId);
  expect(me.stats.might.currentIndex).toBe(1); // skullIndex 0 + 1
  expect(me.stats.speed.currentIndex).toBe(4); // track.length 5 - 1
  expect(me.inventory).toEqual([]); // consumed

  // The user ends their own turn -- now it's the other player's turn. Not reverted yet.
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  me = getPlayer(gameState, currentPlayerId);
  expect(me.stats.might.currentIndex).toBe(1);
  expect(me.stats.speed.currentIndex).toBe(4);

  // The other player ends their turn -- it cycles back to the item_038 user. Reverted now.
  await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  me = getPlayer(gameState, currentPlayerId);
  expect(me.stats.might.currentIndex).toBe(2); // baseIndex, reverted
  expect(me.stats.speed.currentIndex).toBe(2); // baseIndex, reverted

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "item_038"`
Expected: FAIL（此時 `item_038` 的真實卡片資料 `effects` 還是空陣列 `[]`，使用後兩個屬性完全不會變動）

- [ ] **Step 3: 更新 `data/cards/item-cards.json` 的 `item_038`**

`item_038` 目前內容（第 493-502 行）：

```json
    "id": "item_038",
    "name": "可疑藥丸",
    "description": "藥丸上的編號隱約寫著APTX4869",
    "text": "使用後，力量降到最低級別(不致死的級別１)，速度提升到最高級別，到下一個回合開始時恢復。",
    "feedbacktextOccur": "你感覺身體發出高熱，視線漸漸模糊，身上的衣物變得寬鬆",
    "effects": [],
    "category": "consumable",
    "canTargetOthers": false,
    "needsCustomLogic": false
```

只把 `"effects": [],` 這一行換成：

```json
    "effects": [
      { "type": "stat_change", "stat": "might", "setToLevel": "min", "revertAtNextTurnStart": true },
      { "type": "stat_change", "stat": "speed", "setToLevel": "max", "revertAtNextTurnStart": true }
    ],
```

其他行（`text`／`feedbacktextOccur`／`category`／`canTargetOthers`／`needsCustomLogic`）完全不動。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "item_038"`
Expected: PASS

- [ ] **Step 5: 跑整個 `server` 測試套件確認沒有破壞既有測試**

Run: `cd server && npm test`
Expected: 全數 PASS（638 既有 + 1 新增 = 639）

- [ ] **Step 6: Commit**

```bash
git add data/cards/item-cards.json server/test/socketHandlers.test.js
git commit -m "feat: wire item_038 to the new setToLevel/revertAtNextTurnStart stat_change mechanism"
```
