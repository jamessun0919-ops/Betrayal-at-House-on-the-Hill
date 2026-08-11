# 可被道具介入的擲骰 Part B（`leaveCheck` 路徑）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `leaveCheck`（房間「離開前考驗」，塔橋/雜亂的房間/藤蔓糾纏的溫室）的擲骰前也能跳出道具介入詢問視窗，行為跟 Part A 的 `dice_check` 路徑完全一致（天使羽毛可覆蓋結果、詭異人偶可加骰並付出意志代價）。

**Architecture:** 擴充既有的 `pendingRollChoice` 機制，新增 `resumeKind:'leaveCheck'` 分支，不另建新的暫停機制。`turnFlow.js` 的 `moveToRoom` 改成跟 `dice_check` 對稱的兩階段模式（有介入選項先暫停不擲骰，恢復時接受已算好的骰值直接判定）。介入邏輯（代價/消耗追蹤/覆蓋值/加骰/modifiers）完全重用 Part A 寫好、現在 export 出來的 `computeInterjectedRoll`（`effectResolver.js`），不重新實作一份。

**Tech Stack:** Node.js + Express + Socket.IO，CommonJS，無 TypeScript；測試用 Jest。

## Global Constraints

- 沿用既有輸入驗證慣例：不合法輸入一律拋出 UPPER_SNAKE_CASE 訊息的 `Error`（本計畫沒有新增任何直接接受客戶端輸入的欄位，`resolvedRoll`/`itemCatalog` 都是伺服器內部計算/準備好的值，不需要新增驗證）
- `turnFlow.js`（`moveToRoom` 所在檔案）維持零 `promptState`/`effectResolver.js` 依賴的既有模組邊界——所有需要 `resolveEffects`/`promptState` 的邏輯（套用道具代價）留在 `socketHandlers.js`/`effectResolver.js`，不下放進 `turnFlow.js`
- `server/src/game/diceInterjection.js` 本次不修改，維持零外部依賴
- `pendingRollChoice` 的資料結構、逾時計時器（`rollChoiceTimeouts`）、`game:diceChoiceRespond` 事件、`hasPendingRollChoice` 防呆全部原樣沿用，不另建平行機制
- 前端 `client/src/DebugGameScreen.jsx` **不需要任何修改**——已確認 `handleMove` 的 ack callback 只檢查 `res.error`，`game:diceChoicePending`/`game:diceChoiceRespond` 的監聽/回應邏輯是 Part A 就做好的通用機制
- `server/test/socketHandlers.test.js` 執行後 Jest 進程不會自然結束（已知環境問題，跟本次改動無關），在 `server/` 目錄下用 `npx jest --forceExit` 執行測試；`turnFlow.test.js`/`effectResolver.test.js` 沒有這個問題，可以用一般的 `npx jest <path>`

---

### Task 1: Export `computeInterjectedRoll` from `effectResolver.js`

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Produces: `computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice, context)` — 已存在的內部函式，本任務只把它加進 `module.exports`，函式本體不變。之後的任務（Task 4）會從 `socketHandlers.js` 匯入使用。

- [ ] **Step 1: 寫一個會失敗的測試，直接呼叫剛 export 出來的函式**

在 `server/test/game/effectResolver.test.js` 頂部的 import 加入 `computeInterjectedRoll`：

```js
const { resolveEffects, resolveChoiceOption, computeInterjectedRoll } = require('../../src/game/effectResolver');
```

在檔案任意 `test(...)` 區塊之間（例如緊接在既有的 `dice_check` 相關測試之後）新增：

```js
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
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npx jest test/game/effectResolver.test.js -t "computeInterjectedRoll is exported"`（在 `server/` 目錄下）
Expected: FAIL，訊息是 `computeInterjectedRoll is not a function`（因為還沒 export）

- [ ] **Step 3: export `computeInterjectedRoll`**

修改 `server/src/game/effectResolver.js` 最後一行：

```js
module.exports = { resolveEffects, resolveChoiceOption, computeInterjectedRoll };
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npx jest test/game/effectResolver.test.js -t "computeInterjectedRoll is exported"`
Expected: PASS

- [ ] **Step 5: 執行整個檔案的測試，確認沒有破壞既有測試**

Run: `npx jest test/game/effectResolver.test.js`
Expected: 全數 PASS（不影響既有 `dice_check`/`resolveEffects` 測試）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat(dice-interjection): export computeInterjectedRoll for reuse by the leaveCheck path"
```

---

### Task 2: `moveToRoom` 兩階段擲骰（`turnFlow.js`）

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Modify: `server/test/game/turnFlow.test.js`（更新 5 個既有的 leaveCheck 測試，因為第 5 個參數的型別改變）

**Interfaces:**
- Consumes: `findInterjectionOptions(player, itemCatalog, sourceDeckType)` from `./diceInterjection`（Part A 已完成，簽章不變）
- Produces：`moveToRoom(gameState, playerId, direction, leaveCheck = null, rollOptions = {})`，`rollOptions = { itemCatalog, resolvedRoll, rng }`。`resolvedRoll === undefined` 時才會檢查介入選項；找到選項時回傳 `{ kind: 'leaveCheckPending', rollChoice: true, options, leaveCheck, direction }`（不擲骰、不扣行動力、不改變任何玩家/房間狀態）。`resolvedRoll` 是數字時直接拿來跟 `leaveCheck.min` 比較，不再擲骰。這是**破壞性簽章變更**（原本第 5 參數是 `rng` 函式），下面的任務（Task 3/4）與本任務的測試更新都要用新形式呼叫。

- [ ] **Step 1: 更新 5 個既有的 leaveCheck 測試為新的呼叫形式**

在 `server/test/game/turnFlow.test.js` 裡，把第 5 個參數從裸函式改成 `{ rng }` 物件（其餘斷言完全不變）：

第 147 行：
```js
  const result = moveToRoom(gameState, 'p1', 'north', { stat: 'might', min: 3 }, { rng });
```

第 159 行：
```js
  const failResult = moveToRoom(gameState, 'p1', 'north', { stat: 'might', min: 3 }, { rng: failRng });
```

第 166 行：
```js
  const retryResult = moveToRoom(gameState, 'p1', 'north', { stat: 'might', min: 3 }, { rng: passRng });
```

第 175 行：
```js
  const failResult = moveToRoom(gameState, 'p1', 'east', { stat: 'might', min: 3 }, { rng: failRng });
```

第 182 行：
```js
  const passResult = moveToRoom(gameState, 'p1', 'east', { stat: 'might', min: 3 }, { rng: passRng });
```

- [ ] **Step 2: 新增兩個測試，涵蓋介入選項偵測與 `resolvedRoll` 略過偵測的行為**

緊接在既有的第 5 個 leaveCheck 測試（`moveToRoom with a leaveCheck also gates opening a new door...`，第 186 行結尾）之後插入：

```js
test('moveToRoom with a leaveCheck: an eligible interjection item pauses without rolling, moving, or spending action points', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  player.inventory.push({ id: 'item_006' });
  const itemCatalog = [
    { id: 'item_006', name: '詭異人偶', diceInterjection: { scope: 'any', bonusDice: 2, consumesItem: false } },
  ];
  const startingAP = player.actionPoints;
  const result = moveToRoom(gameState, 'p1', 'north', { stat: 'might', min: 3 }, { itemCatalog });
  expect(result).toEqual({
    kind: 'leaveCheckPending',
    rollChoice: true,
    options: [{ itemId: 'item_006', name: '詭異人偶', diceInterjection: itemCatalog[0].diceInterjection }],
    leaveCheck: { stat: 'might', min: 3 },
    direction: 'north',
  });
  expect(player.x).toBe(0); // unmoved
  expect(player.y).toBe(0);
  expect(player.actionPoints).toBe(startingAP); // nothing spent yet
});

test('moveToRoom with a leaveCheck: a resolvedRoll skips eligibility scanning and internal rolling, even with an eligible item held', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  player.inventory.push({ id: 'item_006' });
  const itemCatalog = [
    { id: 'item_006', name: '詭異人偶', diceInterjection: { scope: 'any', bonusDice: 2, consumesItem: false } },
  ];
  const startingAP = player.actionPoints;
  const result = moveToRoom(gameState, 'p1', 'north', { stat: 'might', min: 3 }, { resolvedRoll: 6, itemCatalog });
  expect(result).toEqual({ kind: 'move', x: 0, y: -1 });
  expect(player.actionPoints).toBe(startingAP - 1);
});
```

- [ ] **Step 3: 執行測試，確認新的兩個測試失敗、5 個既有測試因為呼叫形式改變也失敗**

Run: `npx jest test/game/turnFlow.test.js`（在 `server/` 目錄下）
Expected: 7 個 leaveCheck 相關測試 FAIL（新兩個因為行為還沒實作；既有 5 個因為 `rng` 物件被當函式呼叫會拋 `TypeError`）

- [ ] **Step 4: 實作兩階段邏輯**

修改 `server/src/game/turnFlow.js`：

在檔案頂部的 import 加入 `findInterjectionOptions`：

```js
const { rollDice } = require('./effectPipeline');
const { findInterjectionOptions } = require('./diceInterjection');
```

把 `moveToRoom` 函式的簽章與 `leaveCheck` 區塊改成：

```js
function moveToRoom(gameState, playerId, direction, leaveCheck = null, rollOptions = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const available = getAvailableDirections(gameState, playerId);
  const choice = available.find((a) => a.direction === direction);
  if (!choice) {
    throw new Error('INVALID_MOVE_DIRECTION');
  }

  if (leaveCheck) {
    // e.g. 塔橋/雜亂的房間/藤蔓糾纏的溫室 -- leaving this room (either to an
    // already-placed neighbor or by opening a new door) requires a stat
    // check first. A failed check costs the same 1 AP a normal move
    // attempt would, and never draws/places a new room -- the player never
    // actually left, so nothing about the door they tried is revealed.
    const { itemCatalog, resolvedRoll, rng } = rollOptions;
    let rolled;
    if (resolvedRoll !== undefined) {
      rolled = resolvedRoll;
    } else {
      const options = findInterjectionOptions(player, itemCatalog || [], null);
      if (options.length > 0) {
        // Mirrors handleDiceCheck's pending shape -- caller opens a
        // pendingRollChoice and resumes with a resolvedRoll instead.
        return { kind: 'leaveCheckPending', rollChoice: true, options, leaveCheck, direction };
      }
      const diceCount = getStatValue(player, leaveCheck.stat);
      rolled = rollDice(diceCount, rng || Math.random);
    }
    if (rolled < leaveCheck.min) {
      player.actionPoints -= 1;
      return { kind: 'leaveCheckFailed', rolled, required: leaveCheck.min };
    }
  }

  const delta = DIRECTION_DELTA[direction];
  const targetCoord = { x: player.x + delta.dx, y: player.y + delta.dy };

  if (choice.kind === 'move') {
    movePlayerTo(player, player.floor, targetCoord.x, targetCoord.y);
    player.actionPoints -= 1;
    return { kind: 'move', x: targetCoord.x, y: targetCoord.y };
  }

  const roomDefinition = drawRoom(gameState.roomDeck, player.floor);
  const placedRoom = placeNewRoom(
    gameState.board,
    player.floor,
    { x: player.x, y: player.y },
    direction,
    roomDefinition
  );
  movePlayerTo(player, player.floor, placedRoom.x, placedRoom.y);
  player.actionPoints = 0;
  const pendingCardDraw =
    roomDefinition.drawType && roomDefinition.drawType !== 'none'
      ? { deck: roomDefinition.drawType }
      : null;
  return {
    kind: 'open_door',
    x: placedRoom.x,
    y: placedRoom.y,
    roomId: placedRoom.roomId,
    pendingCardDraw,
  };
}
```

（其餘 `moveToRoom` 之外的函式不動）

- [ ] **Step 5: 執行測試，確認全部通過**

Run: `npx jest test/game/turnFlow.test.js`
Expected: 全數 PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat(dice-interjection): moveToRoom supports a two-phase leaveCheck roll for item interjection"
```

---

### Task 3: `game:move` 開啟 leaveCheck 的 `pendingRollChoice`（`socketHandlers.js`）

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 2 的 `moveToRoom(..., { itemCatalog })`
- Produces：新函式 `finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs)`（把「同房間玩家 modifier 檢查＋`pendingCardDraw` 抽卡處理」抽成共用函式，`socket` 可為 `null`——為 `null` 時只跳過私人 `game:cardsDrawn` 通知，其餘照常執行；下一個任務會在逾時路徑傳 `null`）；新函式 `handleLeaveCheckRollPending(io, effectResolverManager, gameState, roomCode, playerId, moveResult, rollChoiceTimeouts, rollChoiceTimeoutMs, effectChoiceTimeouts, content)`（建立 `resumeKind:'leaveCheck'` 的 `pendingRollChoice`，簽章與呼叫順序比照既有的 `handleRollChoicePending`）。`game:move` 的 `ack` 在觸發介入詢問時回傳 `{ kind: 'leaveCheckPending' }`。

- [ ] **Step 1: 寫一個會失敗的整合測試**

在 `server/test/socketHandlers.test.js` 裡，緊接在既有的 `test('game:move applies a room\'s leaveCheck ...')`（第 588-614 行）之後插入：

```js
test('game:move with an eligible interjection item held on a leaveCheck room pauses for a roll choice instead of resolving immediately', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_entrance_hall', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_foyer', name: '廊廳', floor: 'ground' },
      { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
    ],
    cards: {
      events: [],
      omens: [],
      items: [
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }], consumesItem: false },
        },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_006' });
  const startingAP = player.actionPoints;

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(result.error).toBeUndefined();
  expect(result).toEqual({ kind: 'leaveCheckPending' });

  const pending = await pendingPromise;
  expect(pending.playerId).toBe(currentPlayerId);
  expect(pending.options).toEqual([
    { itemId: 'item_006', name: '詭異人偶', diceInterjection: content.cards.items[0].diceInterjection },
  ]);
  expect(typeof pending.promptId).toBe('string');
  expect(player.x).toBe(0); // nothing moved yet
  expect(player.actionPoints).toBe(startingAP); // nothing spent yet

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run（在 `server/` 目錄下）: `npx jest --forceExit -t "pauses for a roll choice instead of resolving immediately"`
Expected: FAIL（目前 `game:move` 不認得 `leaveCheckPending`，會直接把它當一般 `ack(result)` 回傳，`game:diceChoicePending` 永遠不會發出）

- [ ] **Step 3: 實作**

修改 `server/src/socketHandlers.js`：

在頂部的 `playerEntity` import 加入 `getStatValue`（下一個任務會用到，這裡先一起加，避免 Task 4 還要再改一次 import 行）：

```js
const { addItem, removeItem, getStatValue } = require('./game/playerEntity');
```

把 `game:move` handler（第 140-203 行）改成：

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
        if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingRollChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
        const { direction } = payload || {};
        const player = getPlayer(gameState, playerId);
        if (player.summons) {
          const result = moveSummon(gameState, playerId, direction);
          ack(result);
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
          return;
        }
        const currentRoom = gameState.board[player.floor].get(coordKey(player.x, player.y));
        const currentRoomDefinition = findRoomDefinition(content, currentRoom.roomId);
        const leaveCheck = currentRoomDefinition ? currentRoomDefinition.leaveCheck : null;
        const result = moveToRoom(gameState, playerId, direction, leaveCheck, { itemCatalog: content.cards.items });

        if (result.kind === 'leaveCheckPending') {
          handleLeaveCheckRollPending(io, effectResolverManager, gameState, roomCode, playerId, result, rollChoiceTimeouts, rollChoiceTimeoutMs, effectChoiceTimeouts, content);
          ack({ kind: 'leaveCheckPending' });
          return;
        }

        ack(result);
        finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:move error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

在 `findRoomDefinition` 函式定義之後（第 500 行一帶，`hasPendingRollChoice` 函式之後即可）新增這兩個函式：

```js
function finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
  // Any modifier gated on "meets another player" (e.g. 電池耗盡) clears
  // once the mover shares a room with someone -- check everyone now
  // standing there, not just the mover, since it could be the other
  // player's modifier that clears.
  const mover = getPlayer(gameState, playerId);
  const roommates = [...gameState.players.values()].filter(
    (p) => p.floor === mover.floor && p.x === mover.x && p.y === mover.y
  );
  if (roommates.length > 1) {
    for (const roommate of roommates) {
      checkRemoveConditions(roommate, { type: 'meetsAnotherPlayer' });
    }
  }

  if (result.pendingCardDraw) {
    try {
      const drawOutcome = resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
      if (socket && drawOutcome.drawnCards) {
        socket.emit('game:cardsDrawn', { cards: drawOutcome.drawnCards });
      }
    } catch (drawErr) {
      // A card-effect resolution failure (e.g. malformed content) must not
      // prevent the turn from advancing and the room from staying in sync --
      // see M2c-2 final review, Critical C1.
      console.error('resolveCardDraw error', drawErr);
    }
  }
}

function handleLeaveCheckRollPending(io, effectResolverManager, gameState, roomCode, playerId, moveResult, rollChoiceTimeouts, rollChoiceTimeoutMs, effectChoiceTimeouts, content) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const optionIds = moveResult.options.map((o) => o.itemId).concat('__skip__');
  const prompt = createPrompt(resolverEntry.promptState, {
    type: 'dice_interjection',
    targetPlayerId: playerId,
    description: '要不要使用道具介入這次擲骰？',
    options: optionIds,
    timeoutMs: rollChoiceTimeoutMs,
    now: Date.now(),
  });
  resolverEntry.pendingRollChoice = {
    playerId,
    promptId: prompt.promptId,
    deadline: prompt.deadline,
    options: moveResult.options,
    resumeKind: 'leaveCheck',
    resumeContext: { direction: moveResult.direction, leaveCheck: moveResult.leaveCheck },
  };
  resolverEntry.pendingChoice = null; // a roll choice and a plain choice can never be simultaneously pending -- opening this one invalidates any other
  io.to(roomCode).emit('game:diceChoicePending', {
    playerId,
    promptId: prompt.promptId,
    options: moveResult.options,
    deadline: prompt.deadline,
  });
  const delayMs = Math.max(prompt.deadline - Date.now(), 0);
  const handle = setTimeout(() => {
    handleRollChoiceTimeout(io, effectResolverManager, gameState, roomCode, prompt.promptId, rollChoiceTimeouts, effectChoiceTimeouts, content, rollChoiceTimeoutMs);
  }, delayMs);
  rollChoiceTimeouts.set(roomCode, handle);
}
```

`handleRollChoiceTimeout` 已經在檔案中定義在後面（函式宣告會被提升，呼叫順序不影響執行）；本步驟不需要修改它。

- [ ] **Step 4: 執行測試，確認新測試與既有測試都通過**

Run: `npx jest --forceExit`（在 `server/` 目錄下，跑整個 `server/test/` 套件，確認這次的 `game:move` 重構沒有影響任何既有測試——尤其是既有的 `leaveCheckFailed`/一般移動/道具給予撿取等所有經過 `game:move` 的測試）
Expected: 全數 PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(dice-interjection): game:move opens a pendingRollChoice when a leaveCheck has an eligible interjection item"
```

---

### Task 4: 恢復 leaveCheck 的擲骰選擇（`resumeRollChoice` 新分支）

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 1 的 `computeInterjectedRoll`（從 `effectResolver.js`）、Task 2 的 `moveToRoom(..., { resolvedRoll })`、Task 3 的 `finishMoveResult`
- Produces：`resumeRollChoice` 新增第 13 個參數 `socket = null`（既有呼叫點 `handleRollChoiceTimeout` 不用改，維持預設值 `null`）；新分支 `resumeKind === 'leaveCheck'` 呼叫新函式 `resumeLeaveCheckRollChoice`，完成「套用代價/消耗追蹤→算出最終骰值→完成移動判定→收尾」全流程

- [ ] **Step 1: 寫兩個會失敗的整合測試**

在 `server/test/socketHandlers.test.js` 裡，緊接在 Task 3 新增的測試之後插入：

```js
function makeLeaveCheckInterjectionContent() {
  return makeContent({
    startingRooms: [
      { id: 'room_entrance_hall', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_foyer', name: '廊廳', floor: 'ground' },
      { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
    ],
    cards: {
      events: [],
      omens: [],
      items: [
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }], consumesItem: false },
        },
      ],
    },
  });
}

test('game:diceChoiceRespond with an item optionId resolves a pending leaveCheck: applies cost and completes the move on a pass', async () => {
  const content = makeLeaveCheckInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await pendingPromise;

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // every die -> face 2
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_006' }, resolve)
  );
  rngSpy.mockRestore();
  expect(respondResult.error).toBeUndefined();
  await updatePromise;

  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex - 1); // cost applied
  expect(player.diceInterjectionUsedThisTurn).toEqual(['item_006']);
  // might(3) + bonusDice(2) = 4 dice, each face 2 -> sum 8, passes min 3 -> opens the door east
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(0); // open_door zeroes AP, same as a normal door-open

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond with optionId:"__skip__" resolves a pending leaveCheck with no bonus applied', async () => {
  const content = makeLeaveCheckInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await pendingPromise;

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // 3 dice (no bonus), each face 2 -> sum 6, passes min 3
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: '__skip__' }, resolve)
  );
  rngSpy.mockRestore();
  await updatePromise;

  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex); // no cost -- item never used
  expect(player.diceInterjectionUsedThisTurn || []).toEqual([]);
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond resolves a pending leaveCheck that still fails after the bonus roll: cost is still paid, move is blocked, and exactly 1 action point is spent', async () => {
  const content = makeLeaveCheckInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_006' });
  const startingAP = player.actionPoints;

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await pendingPromise;

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // every die -> face 0, sum 0, fails min 3 even with the bonus dice
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_006' }, resolve)
  );
  rngSpy.mockRestore();
  expect(respondResult.error).toBeUndefined();
  await updatePromise;

  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex - 1); // cost paid even though the roll failed
  expect(player.x).toBe(0); // unmoved -- no room was drawn or placed
  expect(player.actionPoints).toBe(startingAP - 1); // exactly 1 AP, not double-charged

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run（在 `server/` 目錄下）: `npx jest --forceExit -t "resolves a pending leaveCheck"`
Expected: FAIL（`resumeRollChoice` 目前遇到 `resumeKind:'leaveCheck'` 會直接拋 `UNSUPPORTED_ROLL_CHOICE_RESUME_KIND`，`game:diceChoiceRespond` 的 ack 會回傳這個錯誤）

- [ ] **Step 3: 實作**

修改 `server/src/socketHandlers.js`：

在頂部的 `effectResolver` import 加入 `computeInterjectedRoll`：

```js
const { resolveEffects, resolveChoiceOption, computeInterjectedRoll } = require('./game/effectResolver');
```

把 `resumeRollChoice` 函式（現有內容）改成：

```js
function resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, resumeKind, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs, socket = null) {
  if (resumeKind === 'leaveCheck') {
    return resumeLeaveCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
  }
  if (resumeKind !== 'diceCheck') {
    throw new Error('UNSUPPORTED_ROLL_CHOICE_RESUME_KIND');
  }
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const { effect, sourceId, consumeItemIfApplied, sourceDeckType } = resumeContext;
  const context = { now: Date.now(), interjectionChoice, itemCatalog: content.cards.items, sourceDeckType };
  const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, [effect], context);
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
}

function resumeLeaveCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const { direction, leaveCheck } = resumeContext;
  const player = getPlayer(gameState, playerId);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];
  const diceCount = getStatValue(player, leaveCheck.stat);
  const finalRoll = computeInterjectedRoll(
    gameState,
    resolverEntry.promptState,
    playerId,
    diceCount,
    modifiers,
    interjectionChoice,
    { now: Date.now(), itemCatalog: content.cards.items, rng: Math.random }
  );
  const result = moveToRoom(gameState, playerId, direction, leaveCheck, { resolvedRoll: finalRoll });
  finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
  return { pending: false };
}
```

在 `game:diceChoiceRespond` handler 裡，把呼叫 `resumeRollChoice` 那一行（原本沒有帶 `socket`）改成帶上 `socket`：

```js
        const outcome = resumeRollChoice(io, effectResolverManager, gameState, roomCode, choicePlayerId, resumeKind, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs, socket);
```

`handleRollChoiceTimeout` 裡呼叫 `resumeRollChoice` 那一行**不用修改**——新的 `socket` 參數有預設值 `null`，逾時路徑本來就沒有對應的 socket，維持現狀即可（跟既有 `dice_check` 逾時路徑「不私訊 `game:cardsDrawn`，只靠廣播同步」的既有限制一致，不是新問題）。

- [ ] **Step 4: 執行測試，確認新測試與既有測試都通過**

Run: `npx jest --forceExit`（在 `server/` 目錄下，跑整個 `server/test/` 套件）
Expected: 全數 PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(dice-interjection): resolve a pending leaveCheck roll choice via computeInterjectedRoll"
```
