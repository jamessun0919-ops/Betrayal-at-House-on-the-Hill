# handlePhaseTimeout 擲骰選擇 Cascade 缺口修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正`handlePhaseTimeout`逾時處理擲骰介入選擇時，解析過程中又冒出全新擲骰介入選擇卻不會被同一輪清掉的缺口，讓逾時處理過程中產生的任何新擲骰選擇都自動視同「不介入」繼續往下解析，不再彈出第二個互動彈窗。

**Architecture:** 在`resolveRollChoiceByTimeout`到`handleRollChoicePending`這條既有呼叫鏈（全部在`server/src/socketHandlers.js`同一個檔案）的8個函式，加一個新的選填布林參數`isTimeoutCascade`（預設`false`，不影響任何其他呼叫這些函式的既有路徑）。只有`resolveRollChoiceByTimeout`呼叫時明確帶`true`，一路往下傳。`handleRollChoicePending`收到`isTimeoutCascade:true`時，跳過建立新彈窗的步驟，直接遞迴呼叫`resumeRollChoice`視同玩家選擇不介入，讓解析同步繼續（含遞迴，深度不限，因為介入道具用過一次就會被標記已用/消耗，遊戲機制本身保證不會無限延伸）。

**Tech Stack:** Node.js, Jest（現有測試框架與既有輔助函式`makeContent`/`setUpStartedGameWithContent`）

## Global Constraints

- 只修正目前真的會被觸發的「擲骰選擇→擲骰選擇」cascade路徑，不處理「道具選擇cascade」（已被`handlePhaseTimeout`既有「擲骰→道具→效果」順序自然接住）與「效果選擇（`random`）cascade」（目前無任何卡片資料會觸發，屬推測性情境，不在這次範圍內）
- 判斷「現在是逾時cascade中」一律用明確傳遞的參數，不可用`Date.now()`跟`gameState.phaseDeadline`比較（會誤判伺服器忙碌延遲時玩家自己的真實操作）
- 新參數必須是選填、預設`false`，現有所有其他呼叫這8個函式的路徑（正常玩家操作流程）一個字元都不用改，行為必須完全不變
- 不新增遞迴次數上限（YAGNI——目前遊戲機制已經保證介入道具用過一次就標記已用/消耗，不可能真的無限遞迴，加上限是防禦不存在的情境）

---

### Task 1: 加上 `isTimeoutCascade` 參數並修正 `handleRollChoicePending`

**Files:**
- Modify: `server/src/socketHandlers.js`（8個函式：`resolveRollChoiceByTimeout`、`resumeRollChoice`、`resumeLeaveCheckRollChoice`、`resumeCollapseCheckRollChoice`、`finishMoveResult`、`resolveCardDraw`、`handleEffectResolveResult`、`handleRollChoicePending`）
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- 不新增任何對外可見的介面（沒有新的socket事件、沒有新的匯出函式）——這次改動完全是這8個既有內部函式之間新增一個內部傳遞的旗標參數
- 8個函式簽名新增的參數一律叫`isTimeoutCascade`，全部放在各自現有參數列表的**最後一位**，預設值`false`

- [ ] **Step 1: 寫失敗測試**

在`server/test/socketHandlers.test.js`找到`test('phase timeout resolves a player\'s pending inventory choice via the default (drop newest item) before locking them', ...)`這個測試（用來找位置，新測試加在它後面即可，不用緊鄰），加入以下新測試：

```javascript
test('phase timeout resolves a cascading roll choice (a timed-out leaveCheck interjection that draws a card triggering a second interjection) without leaving it pending', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground', drawType: 'event' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', leaveCheck: { stat: 'might', min: 3 } },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
    cards: {
      events: [{
        id: 'event_cascade_test',
        name: 'cascade test',
        effects: [{ type: 'dice_check', stat: 'knowledge', tiers: [{ min: 0, max: 99, pass: true, effects: [] }] }],
      }],
      omens: [],
      items: [{
        id: 'item_005',
        name: '天使羽毛',
        diceInterjection: { scope: 'any', override: true, consumesItem: true },
      }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, effectResolverManager, roomCode } =
    await setUpStartedGameWithContent(content, { phaseTimeoutMs: 150 });
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_005' });

  let diceChoicePendingCount = 0;
  currentClient.on('game:diceChoicePending', () => { diceChoicePendingCount += 1; });

  const firstPendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await firstPendingPromise; // leaveCheck's own interjection prompt is open; item_005 not yet consumed

  // Guarantee every roll passes (custom dice faces are 0/0/1/1/2/2 -- 0.99
  // lands on the max face) so the leaveCheck passes, the player actually
  // enters room_lobby_b, event_cascade_test gets drawn there, and its own
  // dice_check also passes. The mock stays active across the real
  // setTimeout below since it patches the global Math.random reference,
  // not anything scoped to this synchronous block.
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  await new Promise((resolve) => setTimeout(resolve, 250)); // past the 150ms phase deadline
  rngSpy.mockRestore();

  // The fix: event_cascade_test's own dice_check found item_005 still
  // available (declined, never consumed, for the leaveCheck) and would
  // have opened a SECOND interjection prompt -- it must not, since this
  // whole resolution is happening because the phase already timed out.
  expect(diceChoicePendingCount).toBe(1); // only the original leaveCheck prompt, never a second one
  expect(getResolver(effectResolverManager, roomCode).pendingRollChoice.has(currentPlayerId)).toBe(false);
  expect(gameState.currentPhase).toBe('player_interact'); // both players got force-locked, npc_move cascades through (0 NPCs)

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "cascading roll choice" -v`
Expected: **FAIL**——`diceChoicePendingCount`會是`2`（第二個interjection彈窗真的跳出來了），或是`pendingRollChoice.has(currentPlayerId)`是`true`（殘留待定選擇沒被清掉）。兩者其中之一失敗即可證明目前確實有這個bug，不需要兩個斷言都失敗。

- [ ] **Step 3: 修改 `handleRollChoicePending`**

在`server/src/socketHandlers.js`找到這個函式（目前完整內容）：

```javascript
function handleRollChoicePending(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, consumeItemIfApplied, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, content) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const optionIds = effectResult.options.map((o) => o.itemId).concat('__skip__');
  const prompt = createPrompt(resolverEntry.promptState, {
    type: 'dice_interjection',
    targetPlayerId: playerId,
    description: '要不要使用道具介入這次擲骰？',
    options: optionIds,
    timeoutMs: rollChoiceTimeoutMs,
    now: Date.now(),
  });
  resolverEntry.pendingRollChoice.set(playerId, {
    playerId,
    promptId: prompt.promptId,
    deadline: prompt.deadline,
    options: effectResult.options,
    resumeKind: 'diceCheck',
    resumeContext: { effect: effectResult.effect, sourceId, consumeItemIfApplied, sourceDeckType: effectResult.sourceDeckType },
  });
  resolverEntry.pendingChoice.delete(playerId); // a roll choice and a plain choice can never be simultaneously pending -- opening this one invalidates any other
  io.to(roomCode).emit('game:diceChoicePending', {
    playerId,
    promptId: prompt.promptId,
    options: effectResult.options,
    deadline: prompt.deadline,
  });
  return { pending: true };
}
```

改成：

```javascript
function handleRollChoicePending(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, consumeItemIfApplied, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, content, isTimeoutCascade = false) {
  if (isTimeoutCascade) {
    // This new roll choice only exists because we're already resolving an
    // earlier choice that timed out (see resolveRollChoiceByTimeout) --
    // don't open a second interactive prompt for it. Treat it the same way
    // a real timeout treats the original: decline the interjection and keep
    // resolving synchronously. isTimeoutCascade threads through so any
    // further choice this produces is caught the same way, at any depth --
    // no cap needed, since an interjection item is marked used/consumed the
    // moment it's actually chosen, never when declined like this.
    return resumeRollChoice(
      io, effectResolverManager, gameState, roomCode, playerId, 'diceCheck',
      { effect: effectResult.effect, sourceId, consumeItemIfApplied, sourceDeckType: effectResult.sourceDeckType },
      null, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, null, isTimeoutCascade
    );
  }
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const optionIds = effectResult.options.map((o) => o.itemId).concat('__skip__');
  const prompt = createPrompt(resolverEntry.promptState, {
    type: 'dice_interjection',
    targetPlayerId: playerId,
    description: '要不要使用道具介入這次擲骰？',
    options: optionIds,
    timeoutMs: rollChoiceTimeoutMs,
    now: Date.now(),
  });
  resolverEntry.pendingRollChoice.set(playerId, {
    playerId,
    promptId: prompt.promptId,
    deadline: prompt.deadline,
    options: effectResult.options,
    resumeKind: 'diceCheck',
    resumeContext: { effect: effectResult.effect, sourceId, consumeItemIfApplied, sourceDeckType: effectResult.sourceDeckType },
  });
  resolverEntry.pendingChoice.delete(playerId); // a roll choice and a plain choice can never be simultaneously pending -- opening this one invalidates any other
  io.to(roomCode).emit('game:diceChoicePending', {
    playerId,
    promptId: prompt.promptId,
    options: effectResult.options,
    deadline: prompt.deadline,
  });
  return { pending: true };
}
```

- [ ] **Step 4: 修改 `handleEffectResolveResult` 的簽名與呼叫 `handleRollChoicePending` 那一行**

找到（目前完整簽名這一行）：

```javascript
function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, consumeItemIfApplied = false, content = null, rollChoiceTimeoutMs = 20000, inventoryChoiceTimeoutMs = 20000, actingPlayerId = null) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending && effectResult.rollChoice) {
    return handleRollChoicePending(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, consumeItemIfApplied, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, content);
  }
```

改成：

```javascript
function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, consumeItemIfApplied = false, content = null, rollChoiceTimeoutMs = 20000, inventoryChoiceTimeoutMs = 20000, actingPlayerId = null, isTimeoutCascade = false) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending && effectResult.rollChoice) {
    return handleRollChoicePending(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, consumeItemIfApplied, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, content, isTimeoutCascade);
  }
```

其餘函式主體（`if (effectResult.pending) {...}`以下到函式結尾）完全不動——`isTimeoutCascade`只在上面這個分支用到。

**這個函式其他3個呼叫點不用改**（維持不傳，預設`false`，行為不變）：第387行、第548行、第1372行（`resolveEffectChoiceByTimeout`的`'random'`分支——這是效果選擇cascade，明確不在這次範圍內）。

- [ ] **Step 5: 修改 `resolveCardDraw`**

找到：

```javascript
function resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, deckType, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs) {
```

改成：

```javascript
function resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, deckType, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, isTimeoutCascade = false) {
```

在同一個函式內找到最後一行（結尾的`return handleEffectResolveResult(...)`）：

```javascript
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, card.id, effectResult, false, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
```

改成：

```javascript
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, card.id, effectResult, false, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, null, isTimeoutCascade);
```

（這個函式裡另一個提早`return { pending: false }`的分支——`card.activatedOnUse`那個——不用改，那條路徑本來就不會冒出新選擇）

- [ ] **Step 6: 修改 `finishMoveResult`**

找到函式簽名：

```javascript
function finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs) {
```

改成：

```javascript
function finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, isTimeoutCascade = false) {
```

在同一個函式內找到：

```javascript
      const drawOutcome = resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
```

改成：

```javascript
      const drawOutcome = resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, isTimeoutCascade);
```

**這個函式在第214行的呼叫點不用改**（`game:move`正常流程，維持不傳，預設`false`）。

- [ ] **Step 7: 修改 `resumeLeaveCheckRollChoice` 與 `resumeCollapseCheckRollChoice`**

找到：

```javascript
function resumeLeaveCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs) {
```

改成：

```javascript
function resumeLeaveCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, isTimeoutCascade = false) {
```

在同一個函式內找到：

```javascript
  finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
  return { pending: false };
}
```

（這是`resumeLeaveCheckRollChoice`裡的那一個，不是`resumeCollapseCheckRollChoice`裡的）改成：

```javascript
  finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, isTimeoutCascade);
  return { pending: false };
}
```

接著找到：

```javascript
function resumeCollapseCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs) {
```

改成：

```javascript
function resumeCollapseCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, isTimeoutCascade = false) {
```

在同一個函式內找到（`resumeCollapseCheckRollChoice`裡的那一個）：

```javascript
  finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
  return { pending: false };
}
```

改成：

```javascript
  finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, isTimeoutCascade);
  return { pending: false };
}
```

- [ ] **Step 8: 修改 `resumeRollChoice`**

找到完整函式：

```javascript
function resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, resumeKind, resumeContext, interjectionChoice, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, socket = null) {
  if (resumeKind === 'leaveCheck') {
    return resumeLeaveCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
  }
  if (resumeKind === 'collapseCheck') {
    return resumeCollapseCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
  }
  if (resumeKind !== 'diceCheck') {
    throw new Error('UNSUPPORTED_ROLL_CHOICE_RESUME_KIND');
  }
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const { effect, sourceId, consumeItemIfApplied, sourceDeckType } = resumeContext;
  const context = { now: Date.now(), interjectionChoice, itemCatalog: content.cards.items, omenCatalog: content.cards.omens, npcCatalog: content.npcs, sourceDeckType };
  const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, [effect], context);
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, consumeItemIfApplied, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
}
```

改成：

```javascript
function resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, resumeKind, resumeContext, interjectionChoice, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, socket = null, isTimeoutCascade = false) {
  if (resumeKind === 'leaveCheck') {
    return resumeLeaveCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, isTimeoutCascade);
  }
  if (resumeKind === 'collapseCheck') {
    return resumeCollapseCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, isTimeoutCascade);
  }
  if (resumeKind !== 'diceCheck') {
    throw new Error('UNSUPPORTED_ROLL_CHOICE_RESUME_KIND');
  }
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const { effect, sourceId, consumeItemIfApplied, sourceDeckType } = resumeContext;
  const context = { now: Date.now(), interjectionChoice, itemCatalog: content.cards.items, omenCatalog: content.cards.omens, npcCatalog: content.npcs, sourceDeckType };
  const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, [effect], context);
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, consumeItemIfApplied, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, null, isTimeoutCascade);
}
```

**這個函式在第588行的呼叫點不用改**（`game:diceChoiceRespond`正常流程，玩家自己回應，維持不傳，預設`false`）。

- [ ] **Step 9: 修改 `resolveRollChoiceByTimeout`（唯一真正指定 `true` 的地方）**

找到：

```javascript
    resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, resumeKind, resumeContext, null, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
```

改成：

```javascript
    resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, resumeKind, resumeContext, null, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, null, true);
```

（這個函式本身`function resolveRollChoiceByTimeout(...)`的簽名不用改，它自己不需要接收`isTimeoutCascade`參數——它永遠都是逾時觸發，所以直接寫死`true`）

- [ ] **Step 10: 執行新測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "cascading roll choice" -v`
Expected: PASS

- [ ] **Step 11: 執行完整測試套件確認沒有破壞既有功能**

Run: `cd server && npm test`
Expected: 755/755 全綠（754既有＋1新增）

- [ ] **Step 12: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "fix: suppress interactive prompt for a roll choice that cascades during phase-timeout resolution"
```

---

## 自我審查記錄（writing-plans 流程要求）

- **spec 涵蓋**：設計文件的「判斷方式（明確標記）」對應Step 1-9新增`isTimeoutCascade`參數；「需要修改的呼叫鏈」8個函式全部對應到Step 3-9；「核心行為變更」對應Step 3；「測試」對應Step 1驗證的三項斷言（無殘留pendingRollChoice、正確鎖定進下一階段、沒有廣播第二筆`game:diceChoicePending`）；「不做的部分」（道具選擇/效果選擇cascade）明確在Step 4/6標註不用改的呼叫點，避免執行者誤以為漏改
- **型別一致性**：`isTimeoutCascade`這個參數名稱與預設值`false`在全部8個函式與所有呼叫點都一致；`resumeRollChoice`呼叫`handleEffectResolveResult`時傳的`null`對應`actingPlayerId`參數（維持原本這個路徑不指定acting player的既有行為，不是這次新增的邏輯）
- **佔位掃描**：全部12個步驟都是可直接複製貼上執行的完整程式碼與指令，沒有「新增適當的錯誤處理」這類空泛描述
