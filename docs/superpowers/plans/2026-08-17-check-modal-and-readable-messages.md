# 統一考驗彈窗機制與可讀訊息欄 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `leaveCheck`／崩塌房間速度考驗／卡片內建 `dice_check` 三個各自獨立的考驗觸發點，統一改發一個新的 broadcast 事件 `game:checkResolved`；前端建立考驗佇列，依序播放「考驗前彈窗（描述＋擲骰按鈕）→ 動畫佔位 → 結果彈窗」；同時把訊息欄從 `JSON.stringify` 傾印改成人類可讀句子（含玩家署名），字體放大到 24px。

**Architecture:** 伺服器端三個考驗觸發點本來就會「一次算完」（含既有的道具介入擲骰機制，不動），這次只新增「把已經算出的結果，用統一結構化格式廣播給整個房間」這一層，不改判定邏輯本身。前端收到廣播後**刻意延後揭曉**：推進一個佇列，依序彈出「考驗前」畫面（用已知的描述/屬性/門檻），玩家按下擲骰後才用已經拿到的結果播放動畫再顯示「結果」畫面。房間進入的人類可讀訊息，改由前端用既有的 `roomContent`/`cardContent`（一次性靜態資料）查名稱組句子，不新增伺服器端的文字生成邏輯。

**Tech Stack:** Node.js + Express + Socket.IO（伺服器持有權威狀態）＋ React (Vite)；CommonJS，不用 TypeScript；沿用專案既有的 inline-style overlay 彈窗慣例（不新增 CSS 檔案）。

## Global Constraints

- 不新增任何 npm 套件（前後端皆是）
- 伺服器程式碼一律 CommonJS（`require`/`module.exports`），前端 React 元件用 ES module import/export，跟現有檔案一致
- `game:checkResolved`／`game:roomEntered` 是**新增**的 broadcast 事件，不可移除或改變任何既有事件的 payload 形狀（`game:cardDrawn` 只能**新增**欄位 `hasCheck`，不可改動既有欄位；`leaveCheckFailed`/`leaveCheckPending`/`collapseCheckPending` 的既有欄位不可移除，只能新增 `leaveCheckResult`）
- 每個涉及 `moveToRoom` 回傳值的伺服器改動，都必須用「只在有值時才加上該欄位」（例如物件展開 `...(x ? { key: x } : {})`）的寫法，**不可以**在沒有 `leaveCheck` 參數時也塞一個 `leaveCheckResult: null`，否則會讓現有大量 `.toEqual({kind:'move', x, y})` 這類精確比對的測試全部炸掉
- 骰子動畫本身（真正的視覺效果）不在這次範圍內，`CheckModal.jsx` 只需要一個 2.5 秒的固定延遲佔位（`setTimeout`），畫面上顯示簡單的「擲骰中...」文字即可，之後開發者會自己換掉這段
- 前端目前沒有自動化測試框架，任何前端改動的驗證方式是啟動 dev server 用瀏覽器（雙分頁模擬雙人）手動走一次流程，不新增測試框架
- 伺服器改完一定要重啟才會生效（純 `node src/index.js`，沒有監看機制）——這是專案既有規則，Debug 階段前面已經吃過一次虧
- 卡片考驗的 `passed`（成功/失敗）判定，用「命中那一層 `tiers[].effects` 裡有任何 `stat_change` 的 `delta < 0` 就算失敗，否則算成功」這個啟發式規則（設計文件已明確記錄這不是資料裡定義的，是這次實作採用的簡化規則）

---

## File Structure

**伺服器（Modify only，無新檔案）：**
- `server/src/game/turnFlow.js`：`moveToRoom` 的 leaveCheck 成功/失敗分支都要附上 `leaveCheckResult`；`applyCollapseCheck` 附上 `stat`/`required`
- `server/src/game/effectResolver.js`：`handleDiceCheck` 附上 `diceCheckResult`；`resolveEffects` 要把子效果 handler 回傳的 `diceCheckResult` 往上傳遞（跟現有 `drawnCards` 的傳遞方式一樣）
- `server/src/socketHandlers.js`：`finishMoveResult` 新增 `game:checkResolved`（leaveCheck/collapseCheck）＋`game:roomEntered` 廣播；`handleCollapseCheckRollPending`/`resumeCollapseCheckRollChoice` 要把 `leaveCheckResult` 透過 `resumeContext` 帶過去；`resolveCardDraw` 的 `game:cardDrawn` 新增 `hasCheck` 欄位；`handleEffectResolveResult` 新增卡片考驗的 `game:checkResolved` 廣播＋新增一個小型 helper `findSourceKind`

**前端：**
- `client/src/gameplay/mapUtils.js`（Modify）：新增 `findCardInfo(cardId, cardContent)` helper，跟既有 `findRoomInfo` 平行
- `client/src/gameplay/CheckModal.jsx`（**Create**）：兩階段考驗彈窗元件
- `client/src/DebugGameScreen.jsx`（Modify）：新增 `pendingCheckQueue` 狀態＋監聽 `game:checkResolved`/`game:roomEntered`；`onCardDrawn` 擴充成同時處理「無考驗卡片」佇列項目＋訊息欄文字；渲染 `CheckModal`／無考驗簡化彈窗
- `client/src/gameplay/CharacterPanel.jsx`（Modify）：訊息列字體 `'0.8em'` → `24px`（含無訊息佔位文字）

**測試：**
- `server/test/game/turnFlow.test.js`（Modify）：更新 6 處既有的 leaveCheck 精確 `.toEqual` 斷言（新增 `leaveCheckResult`），新增 2-3 個新測試
- `server/test/game/effectResolver.test.js`（Modify）：新增 `diceCheckResult` 傳遞的測試
- `server/test/socketHandlers.test.js`（Modify）：新增 `game:checkResolved`（三種 `checkKind`）／`game:roomEntered`／`game:cardDrawn.hasCheck` 的測試

---

## Task 1: `turnFlow.js` — 讓 leaveCheck 與崩塌房間檢定的結果可以被外部讀到

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: 無新依賴，沿用既有 `changeStat`/`getStatValue`/`rollDice`/`applyModifiers`/`findInterjectionOptions`
- Produces：`moveToRoom` 回傳值視情況多一個欄位 `leaveCheckResult: { stat, roomId, rolled, required, passed } | undefined`（只有 `leaveCheck` 參數非 null 時才會出現，不會是 `null` 值，是完全不存在這個 key）；`applyCollapseCheck` 回傳值多兩個欄位 `stat`/`required`（一定存在，因為崩塌房間檢定的常數是固定的）。這兩個欄位是 Task 3 廣播 `game:checkResolved` 時要讀的資料來源。

- [ ] **Step 1: 寫失敗的測試 —— leaveCheck 成功時回傳值要帶 `leaveCheckResult`**

在 `server/test/game/turnFlow.test.js` 第 147-157 行那個既有測試（`'moveToRoom with a leaveCheck: passing the roll moves the player and costs exactly the normal 1 action point'`），把第 153 行

```js
  expect(result).toEqual({ kind: 'move', x: -1, y: 1 });
```

改成

```js
  expect(result).toEqual({
    kind: 'move',
    x: -1,
    y: 1,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 6, required: 3, passed: true },
  });
```

（`room_lobby_a` 是 `makeGameStateWithPlayer` 建立的玩家起始房間 id，`rolled: 6` 是因為這個測試的 `rng = () => 0.99` 讓每顆骰子都是面值 2，might 屬性值 3 顆骰 → 總和 6）

- [ ] **Step 2: 執行測試確認會失敗**

執行：`cd server && npx jest test/game/turnFlow.test.js -t "passing the roll moves the player"`
預期：FAIL，因為 `result` 目前沒有 `leaveCheckResult` 這個 key

- [ ] **Step 3: 在 `moveToRoom` 加入 `leaveCheckResult`**

打開 `server/src/game/turnFlow.js`，把第 63-121 行的 `moveToRoom` 開頭（`if (leaveCheck) { ... }` 區塊，含後面的 `if (choice.kind === 'move') { ... }` 分支）改成：

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

  let leaveCheckResult;
  if (leaveCheck) {
    // Captured unconditionally (not just in the direct-roll sub-branch below)
    // so it's available whether this call rolls synchronously or receives an
    // already-resolved roll via resolvedRoll (the dice-interjection resume path).
    const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
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
      const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];
      const diceCount = getStatValue(player, leaveCheck.stat);
      const adjustedCount = Math.max(1, Math.min(8, applyModifiers(diceCount, modifiers, 'onBeforeRoll', {})));
      rolled = applyModifiers(rollDice(adjustedCount, rng || Math.random), modifiers, 'onAfterRoll', {});
    }
    leaveCheckResult = {
      stat: leaveCheck.stat,
      roomId: room.roomId,
      rolled,
      required: leaveCheck.min,
      passed: rolled >= leaveCheck.min,
    };
    if (rolled < leaveCheck.min) {
      player.actionPoints -= 1;
      if (leaveCheck.failPenalty) {
        // e.g. 天花閣樓/五芒星室/墓園/髒亂的房間 -- some leaveCheck rooms'
        // official text also costs a stat level on a failed check, distinct
        // from the stat being checked (see room text). 塔橋/雜亂的房間/藤蔓
        // 糾纏的溫室 have no such clause -- their data has no failPenalty,
        // so this is skipped for them, matching their sourced text exactly.
        changeStat(player, leaveCheck.failPenalty.stat, leaveCheck.failPenalty.delta, gameState.hauntStarted);
      }
      return { kind: 'leaveCheckFailed', rolled, required: leaveCheck.min, leaveCheckResult };
    }
  }

  const delta = DIRECTION_DELTA[direction];
  const targetCoord = { x: player.x + delta.dx, y: player.y + delta.dy };

  if (choice.kind === 'move') {
    movePlayerTo(player, player.floor, targetCoord.x, targetCoord.y, OPPOSITE_SIDE[direction]);
    player.actionPoints -= 1;
    return { kind: 'move', x: targetCoord.x, y: targetCoord.y, ...(leaveCheckResult ? { leaveCheckResult } : {}) };
  }
```

**不要**改動這之後的舞廳/包廂房抽卡邏輯（`let roomDefinition = drawRoom(...)` 那一段完全不動）。

- [ ] **Step 4: 把 `leaveCheckResult` 接到後面 2 個 `open_door`／`collapseCheckPending` 的 return**

同一個函式，繼續往下（原本第 158-194 行，`if (roomDefinition.id === COLLAPSED_ROOM_ID) { ... }` 那段跟最後的 `return { kind: 'open_door', ... }`），改成：

```js
  if (roomDefinition.id === COLLAPSED_ROOM_ID) {
    // 崩塌的房間 -- speed check (5+) to dodge the hole in the floor. Reuses
    // the same dice-interjection pattern as leaveCheck (see the leaveCheck
    // branch above) rather than rolling in isolation.
    const { itemCatalog, rng } = rollOptions;
    const options = findInterjectionOptions(player, itemCatalog || [], null);
    if (options.length > 0) {
      return {
        kind: 'collapseCheckPending',
        rollChoice: true,
        options,
        x: placedRoom.x,
        y: placedRoom.y,
        roomId: placedRoom.roomId,
        pendingCardDraw,
        ...(leaveCheckResult ? { leaveCheckResult } : {}),
      };
    }
    const diceCount = getStatValue(player, COLLAPSE_CHECK_STAT);
    const rolled = applyModifiers(rollDice(diceCount, rng || Math.random), player.modifiers || [], 'onAfterRoll', {});
    const collapseResult = applyCollapseCheck(gameState, player, placedRoom, rolled);
    return {
      kind: 'open_door',
      x: placedRoom.x,
      y: placedRoom.y,
      roomId: placedRoom.roomId,
      pendingCardDraw,
      collapseResult,
      ...(leaveCheckResult ? { leaveCheckResult } : {}),
    };
  }

  return {
    kind: 'open_door',
    x: placedRoom.x,
    y: placedRoom.y,
    roomId: placedRoom.roomId,
    pendingCardDraw,
    ...(leaveCheckResult ? { leaveCheckResult } : {}),
  };
}
```

- [ ] **Step 5: 在 `applyCollapseCheck` 附上 `stat`/`required`**

同一個檔案裡的 `applyCollapseCheck`（原本約第 228-248 行）：

```js
function applyCollapseCheck(gameState, player, placedRoom, rolled) {
  if (rolled >= COLLAPSE_CHECK_MIN) {
    return { fell: false, rolled, stat: COLLAPSE_CHECK_STAT, required: COLLAPSE_CHECK_MIN };
  }
  const guaranteedSide = SIDES[Math.floor(Math.random() * SIDES.length)];
  const basementRoomDefinition = drawRoom(gameState.roomDeck, 'basement');
  const basementRoom = placeRoomAt(
    gameState.board,
    'basement',
    placedRoom.x,
    placedRoom.y,
    basementRoomDefinition,
    guaranteedSide
  );
  placedRoom.collapseLink = { x: basementRoom.x, y: basementRoom.y };
  movePlayerTo(player, 'basement', basementRoom.x, basementRoom.y, null);
  return {
    fell: true,
    rolled,
    stat: COLLAPSE_CHECK_STAT,
    required: COLLAPSE_CHECK_MIN,
    basementRoomId: basementRoom.roomId,
    x: basementRoom.x,
    y: basementRoom.y,
  };
}
```

（只加 `stat`/`required` 兩個欄位，其餘不動）

- [ ] **Step 6: 執行 Step 1 的測試，確認通過**

執行：`cd server && npx jest test/game/turnFlow.test.js -t "passing the roll moves the player"`
預期：PASS

- [ ] **Step 7: 更新其餘 5 處會被新欄位影響的既有精確斷言**

同一個測試檔案裡還有 5 處 `.toEqual` 會因為新增的 `leaveCheckResult` 欄位而斷言失敗，逐一修正：

**(a) 第 159-174 行的測試**（`'moveToRoom with a leaveCheck: failing the roll blocks the move...'`），原本：
```js
  const failResult = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 3 }, { rng: failRng });
  expect(failResult).toEqual({ kind: 'leaveCheckFailed', rolled: 0, required: 3 });
```
改成：
```js
  const failResult = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 3 }, { rng: failRng });
  expect(failResult).toEqual({
    kind: 'leaveCheckFailed',
    rolled: 0,
    required: 3,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 0, required: 3, passed: false },
  });
```
同一個測試再往下幾行：
```js
  const retryResult = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 3 }, { rng: passRng });
  expect(retryResult).toEqual({ kind: 'move', x: -1, y: 1 });
```
改成：
```js
  const retryResult = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 3 }, { rng: passRng });
  expect(retryResult).toEqual({
    kind: 'move',
    x: -1,
    y: 1,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 6, required: 3, passed: true },
  });
```

**(b) 第 206-221 行的測試**（`'moveToRoom with a leaveCheck also gates opening a new door...'`），原本：
```js
  const failResult = moveToRoom(gameState, 'p1', 'east', { stat: 'might', min: 3 }, { rng: failRng });
  expect(failResult).toEqual({ kind: 'leaveCheckFailed', rolled: 0, required: 3 });
```
改成：
```js
  const failResult = moveToRoom(gameState, 'p1', 'east', { stat: 'might', min: 3 }, { rng: failRng });
  expect(failResult).toEqual({
    kind: 'leaveCheckFailed',
    rolled: 0,
    required: 3,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 0, required: 3, passed: false },
  });
```

**(c) 第 244-256 行的測試**（`'moveToRoom with a leaveCheck: a room-level onBeforeRoll modifier...'`），原本：
```js
  const result = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 5 }, { rng });
  expect(result).toEqual({ kind: 'leaveCheckFailed', rolled: 4, required: 5 });
```
改成：
```js
  const result = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 5 }, { rng });
  expect(result).toEqual({
    kind: 'leaveCheckFailed',
    rolled: 4,
    required: 5,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 4, required: 5, passed: false },
  });
```

**(d) 第 258-269 行的測試**（`'moveToRoom with a leaveCheck: a resolvedRoll skips eligibility scanning...'`），原本：
```js
  const result = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 3 }, { resolvedRoll: 6, itemCatalog });
  expect(result).toEqual({ kind: 'move', x: -1, y: 1 });
```
改成：
```js
  const result = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 3 }, { resolvedRoll: 6, itemCatalog });
  expect(result).toEqual({
    kind: 'move',
    x: -1,
    y: 1,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 6, required: 3, passed: true },
  });
```

- [ ] **Step 8: 新增一個崩塌房間 `applyCollapseCheck` 的測試**

在檔案裡找到既有崩塌房間相關測試（搜尋 `COLLAPSED_ROOM_ID` 或 `collapseResult`），在附近新增：

```js
test('moveToRoom into the collapsed room: a passing speed check now also reports stat/required for display', () => {
  const { gameState, player } = makeGameStateWithPlayer([
    { id: 'room_collapsed_room', doors: 4, floor: 'ground' },
  ]);
  gameState.board.ground.set('-1,1', { roomId: 'room_manual', x: -1, y: 1, doorSides: ['north', 'east', 'south', 'west'] });
  const rng = () => 0.99; // every die -> face 2; speed value should clear COLLAPSE_CHECK_MIN (5)
  const result = moveToRoom(gameState, 'p1', 'east', null, { rng });
  expect(result.kind).toBe('open_door');
  expect(result.collapseResult.fell).toBe(false);
  expect(result.collapseResult.stat).toBe('speed');
  expect(result.collapseResult.required).toBe(5);
});
```

（如果既有測試用的房間資料寫法跟這裡不同，以檔案裡實際能跑通的既有 `makeGameStateWithPlayer`/房間放置寫法為準，這段是示意，实作時比照鄰近既有崩塌房間測試的 setup 方式調整）

- [ ] **Step 9: 執行整個檔案的測試，全數通過**

執行：`cd server && npx jest test/game/turnFlow.test.js`
預期：PASS，全部測試綠燈

- [ ] **Step 10: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat(engine): expose leaveCheck/collapse-check result data for the check-resolved broadcast"
```

---

## Task 2: `effectResolver.js` — 讓卡片內建考驗的骰值結果可以被外部讀到

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: 無新依賴
- Produces：`resolveEffects` 的回傳值視情況多一個欄位 `diceCheckResult: { stat, diceCount, rolled, tierEffects } | undefined`（只有 effects 陣列裡真的包含一個已經解析完成的 `dice_check` 時才會出現）——Task 4 會用這個欄位判斷要不要廣播 `game:checkResolved`

- [ ] **Step 1: 寫失敗的測試**

在 `server/test/game/effectResolver.test.js`，找到第 300 行附近既有的 dice_check 測試區塊，新增一個新測試：

```js
test('resolveEffects dice_check attaches diceCheckResult (stat/diceCount/rolled/tierEffects) so callers can broadcast the outcome', () => {
  const gameState = makeGameStateWithPlayer();
  const rng = jest.fn().mockReturnValue(0.99); // every die -> face 2
  const tierEffects = [{ type: 'stat_change', stat: 'might', delta: 1 }];
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 2,
      tiers: [{ min: 4, max: 4, effects: tierEffects }],
    },
  ], { rng });
  expect(result.diceCheckResult).toEqual({
    stat: undefined,
    diceCount: 2,
    rolled: 4,
    tierEffects,
  });
});
```

- [ ] **Step 2: 執行測試確認會失敗**

執行：`cd server && npx jest test/game/effectResolver.test.js -t "attaches diceCheckResult"`
預期：FAIL，`result.diceCheckResult` 是 `undefined`

- [ ] **Step 3: `handleDiceCheck` 附上 `diceCheckResult`**

打開 `server/src/game/effectResolver.js`，找到 `handleDiceCheck`（約第 145-170 行），把最後兩行：

```js
  const finalSum = computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice || null, restContext);
  const tier = evaluateTiers(finalSum, effect.tiers);
  return resolveEffects(gameState, promptState, playerId, tier.effects, restContext);
```

改成：

```js
  const finalSum = computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice || null, restContext);
  const tier = evaluateTiers(finalSum, effect.tiers);
  const nestedResult = resolveEffects(gameState, promptState, playerId, tier.effects, restContext);
  return {
    ...nestedResult,
    diceCheckResult: { stat: effect.stat, diceCount: baseCount, rolled: finalSum, tierEffects: tier.effects },
  };
```

- [ ] **Step 4: 讓 `resolveEffects` 把子效果的 `diceCheckResult` 往上傳遞**

找到 `resolveEffects`（約第 278-304 行），現有邏輯已經會傳遞 `drawnCards`，比照同樣的模式加上 `diceCheckResult`：

```js
function resolveEffects(gameState, promptState, playerId, effects, context = {}) {
  if (!Array.isArray(effects)) {
    throw new Error('INVALID_EFFECTS_LIST');
  }
  requirePlayer(gameState, playerId);
  let appliedCount = 0;
  let drawnCards = [];
  let diceCheckResult = null;
  for (const effect of effects) {
    const handler = HANDLERS[effect.type];
    if (!handler) {
      throw new Error('UNSUPPORTED_EFFECT_TYPE');
    }
    const result = handler(gameState, promptState, playerId, effect, context);
    if (result && result.pending) {
      return result;
    }
    appliedCount += (result && typeof result.appliedCount === 'number') ? result.appliedCount : 1;
    if (result && Array.isArray(result.drawnCards)) {
      drawnCards = drawnCards.concat(result.drawnCards);
    }
    if (result && result.diceCheckResult) {
      diceCheckResult = result.diceCheckResult;
    }
  }
  const output = { pending: false, appliedCount };
  if (drawnCards.length > 0) {
    output.drawnCards = drawnCards;
  }
  if (diceCheckResult) {
    output.diceCheckResult = diceCheckResult;
  }
  return output;
}
```

- [ ] **Step 5: 執行 Step 1 的測試，確認通過**

執行：`cd server && npx jest test/game/effectResolver.test.js -t "attaches diceCheckResult"`
預期：PASS

- [ ] **Step 6: 執行整個檔案的測試，全數通過**

執行：`cd server && npx jest test/game/effectResolver.test.js`
預期：PASS，全部測試綠燈（既有 dice_check 測試都是用 `.pending`/個別屬性斷言，不是整個回傳值精確比對，這次新增的欄位不會讓它們壞掉）

- [ ] **Step 7: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat(engine): propagate dice_check result data (stat/diceCount/rolled/tierEffects) up through resolveEffects"
```

---

## Task 3: `socketHandlers.js` — 廣播 `game:checkResolved`（leaveCheck／崩塌房間）＋ `game:roomEntered`

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 1 的 `result.leaveCheckResult`/`result.collapseResult.stat`/`result.collapseResult.required`
- Produces：新的 broadcast 事件 `game:checkResolved`（`{ playerId, checkKind: 'leaveCheck'|'collapseCheck', sourceKind: 'room', sourceId, stat, rolled, threshold, tierEffects: null, passed }`）跟 `game:roomEntered`（`{ playerId, roomId }`），供前端 Task 6 使用

- [ ] **Step 1: 寫失敗的測試 —— leaveCheck 失敗要廣播 `game:checkResolved` 給整個房間**

在 `server/test/socketHandlers.test.js`，找一個現成的 leaveCheck 相關測試附近（搜尋 `leaveCheckFailed` 或 `leaveCheck`），新增：

```js
test('game:move with a failing leaveCheck broadcasts game:checkResolved to the whole room, not just the mover', async () => {
  const { io, port, roomCode, playerIds } = await startTestServer({
    rooms: makeDrawableRooms(),
    startingRooms: makeStartingRoomsWithLeaveCheck(), // room_lobby_a has a leaveCheck that always fails with rng:()=>0
  });
  const [client1, client2] = await connectPlayers(io, port, roomCode, playerIds);
  const checkResolvedPromise = new Promise((resolve) => client2.once('game:checkResolved', resolve));
  client1.emit('game:move', { direction: 'south' }, () => {});
  const checkResolved = await checkResolvedPromise;
  expect(checkResolved.checkKind).toBe('leaveCheck');
  expect(checkResolved.sourceKind).toBe('room');
  expect(checkResolved.passed).toBe(false);
});
```

（實際的房間/測試資料 helper 名稱要跟這個檔案既有的 fixture 慣例一致——這個檔案已經有大量 `startTestServer`/建房/雙玩家連線的既有 helper，抄一個現成的 leaveCheck 相關或 `game:move` 測試的 setup 方式改寫，不要發明新的 fixture 機制）

- [ ] **Step 2: 執行測試確認會失敗**

執行：`cd server && npx jest test/socketHandlers.test.js -t "broadcasts game:checkResolved to the whole room"`
預期：FAIL（目前完全沒有 `game:checkResolved` 事件）

- [ ] **Step 3: 在 `finishMoveResult` 廣播 leaveCheck/collapseCheck 的 `game:checkResolved` ＋ `game:roomEntered`**

打開 `server/src/socketHandlers.js`，找到 `finishMoveResult`（約第 532-560 行），改成：

```js
function finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
  const mover = getPlayer(gameState, playerId);
  const roommates = [...gameState.players.values()].filter(
    (p) => p.floor === mover.floor && p.x === mover.x && p.y === mover.y
  );
  if (roommates.length > 1) {
    for (const roommate of roommates) {
      checkRemoveConditions(roommate, { type: 'meetsAnotherPlayer' });
    }
  }

  if (result.leaveCheckResult) {
    io.to(roomCode).emit('game:checkResolved', {
      playerId,
      checkKind: 'leaveCheck',
      sourceKind: 'room',
      sourceId: result.leaveCheckResult.roomId,
      stat: result.leaveCheckResult.stat,
      rolled: result.leaveCheckResult.rolled,
      threshold: result.leaveCheckResult.required,
      tierEffects: null,
      passed: result.leaveCheckResult.passed,
    });
  }

  if (result.collapseResult) {
    io.to(roomCode).emit('game:checkResolved', {
      playerId,
      checkKind: 'collapseCheck',
      sourceKind: 'room',
      sourceId: result.roomId,
      stat: result.collapseResult.stat,
      rolled: result.collapseResult.rolled,
      threshold: result.collapseResult.required,
      tierEffects: null,
      passed: !result.collapseResult.fell,
    });
  }

  if (result.kind === 'move' || result.kind === 'open_door') {
    const enteredRoom = gameState.board[mover.floor].get(coordKey(mover.x, mover.y));
    io.to(roomCode).emit('game:roomEntered', { playerId, roomId: enteredRoom.roomId });
  }

  if (result.pendingCardDraw) {
    try {
      const drawOutcome = resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
      if (socket && drawOutcome.drawnCards) {
        socket.emit('game:cardsDrawn', { cards: drawOutcome.drawnCards });
      }
    } catch (drawErr) {
      console.error('resolveCardDraw error', drawErr);
    }
  }
}
```

（只新增中間 3 個 `if` 區塊，其餘完全不動；`game:roomEntered` 放在 `game:checkResolved` 之後、`pendingCardDraw` 之前，確保前端佇列的揭曉順序是「離開房間考驗→進入新房間→抽卡考驗」，跟遊戲實際發生的先後順序一致）

- [ ] **Step 4: 執行 Step 1 的測試，確認通過**

執行：`cd server && npx jest test/socketHandlers.test.js -t "broadcasts game:checkResolved to the whole room"`
預期：PASS

- [ ] **Step 5: 讓崩塌房間的道具介入回復路徑也能正確帶出 leaveCheckResult**

`handleCollapseCheckRollPending`（約第 595-626 行）目前的 `resumeContext` 只有 `{ pendingCardDraw: moveResult.pendingCardDraw }`，要多帶 `leaveCheckResult`：

```js
  resolverEntry.pendingRollChoice = {
    playerId,
    promptId: prompt.promptId,
    deadline: prompt.deadline,
    options: moveResult.options,
    resumeKind: 'collapseCheck',
    resumeContext: { pendingCardDraw: moveResult.pendingCardDraw, leaveCheckResult: moveResult.leaveCheckResult },
  };
```

`resumeCollapseCheckRollChoice`（約第 821-849 行）要把它接回最終的 `result`：

```js
function resumeCollapseCheckRollChoice(io, socket, effectResolverManager, gameState, roomCode, playerId, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const player = getPlayer(gameState, playerId);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];
  const diceCount = getStatValue(player, 'speed');
  const finalRoll = computeInterjectedRoll(
    gameState,
    resolverEntry.promptState,
    playerId,
    diceCount,
    modifiers,
    interjectionChoice,
    { now: Date.now(), itemCatalog: content.cards.items, rng: Math.random }
  );
  const collapseResult = resumeCollapseCheck(gameState, playerId, finalRoll);
  const result = {
    kind: 'open_door',
    x: room.x,
    y: room.y,
    roomId: room.roomId,
    pendingCardDraw: resumeContext.pendingCardDraw,
    collapseResult,
    ...(resumeContext.leaveCheckResult ? { leaveCheckResult: resumeContext.leaveCheckResult } : {}),
  };
  finishMoveResult(io, socket, gameState, roomCode, playerId, result, effectResolverManager, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
  return { pending: false };
}
```

（只加最後那個 `...(resumeContext.leaveCheckResult ? ... : {})` 展開，其餘不動）

- [ ] **Step 6: 新增崩塌房間＋ `game:roomEntered` 的測試**

在同一個測試檔案裡新增：

```js
test('game:move into the collapsed room broadcasts a collapseCheck game:checkResolved', async () => {
  // setup 比照既有崩塌房間相關測試（搜尋 room_collapsed_room）
  const checkResolvedPromise = new Promise((resolve) => client2.once('game:checkResolved', resolve));
  client1.emit('game:move', { direction: 'east' }, () => {});
  const checkResolved = await checkResolvedPromise;
  expect(checkResolved.checkKind).toBe('collapseCheck');
});

test('game:move into a plain (no leaveCheck) neighbor broadcasts game:roomEntered with the entered room id', async () => {
  const roomEnteredPromise = new Promise((resolve) => client2.once('game:roomEntered', resolve));
  client1.emit('game:move', { direction: 'south' }, () => {});
  const roomEntered = await roomEnteredPromise;
  expect(roomEntered.playerId).toBeDefined();
  expect(roomEntered.roomId).toBeDefined();
});
```

（跟 Step 1 一樣，比照這個檔案既有的 fixture/連線 helper 寫法，這裡只示意斷言重點）

- [ ] **Step 7: 執行整個檔案的測試，全數通過**

執行：`cd server && npx jest test/socketHandlers.test.js`
預期：PASS

- [ ] **Step 8: 重啟後端伺服器手動驗證一次**（若正在跑）

關閉再重開 `server/`（`node src/index.js`），避免舊行程沒吃到新程式碼。

- [ ] **Step 9: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(engine): broadcast game:checkResolved for leaveCheck/collapseCheck, and game:roomEntered"
```

---

## Task 4: `socketHandlers.js` — 廣播卡片內建考驗的 `game:checkResolved` ＋ `game:cardDrawn.hasCheck`

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 2 的 `effectResult.diceCheckResult`
- Produces：`game:cardDrawn` 新增欄位 `hasCheck: boolean`（前端 Task 6 用它決定要不要等待配對的 `game:checkResolved`，還是直接走無考驗流程）；卡片考驗也會廣播 `game:checkResolved`（`checkKind:'cardCheck'`）

- [ ] **Step 1: 寫失敗的測試 —— `game:cardDrawn` 要帶 `hasCheck`**

在 `server/test/socketHandlers.test.js` 找到第 1251-1257 行附近既有的 `game:cardDrawn` 測試，新增：

```js
test('game:cardDrawn reports hasCheck:true when the drawn card has a dice_check effect', async () => {
  // 用一張已知含 dice_check 的內容卡（例如 event_001 腐敗惡臭）當作牌庫內容
  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  // ...觸發抽到 event_001 的既有流程...
  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.hasCheck).toBe(true);
});

test('game:cardDrawn reports hasCheck:false when the drawn card has no dice_check effect', async () => {
  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  // ...觸發抽到一張沒有 dice_check 的卡...
  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.hasCheck).toBe(false);
});
```

（沿用第 1251 行附近既有測試的牌庫/內容 fixture 寫法，只是多斷言 `hasCheck`）

- [ ] **Step 2: 執行測試確認會失敗**

執行：`cd server && npx jest test/socketHandlers.test.js -t "reports hasCheck"`
預期：FAIL

- [ ] **Step 3: `resolveCardDraw` 加上 `hasCheck` 與卡片考驗的 `game:checkResolved` 廣播**

打開 `server/src/socketHandlers.js`，找到 `resolveCardDraw`（約第 647-689 行），把：

```js
  const card = drawCard(deck);
  io.to(roomCode).emit('game:cardDrawn', { playerId, deckType, cardId: card.id, cardName: card.name });
```

改成：

```js
  const card = drawCard(deck);
  const hasCheck = Array.isArray(card.effects) && card.effects.some((e) => e.type === 'dice_check');
  io.to(roomCode).emit('game:cardDrawn', { playerId, deckType, cardId: card.id, cardName: card.name, hasCheck });
```

- [ ] **Step 4: 在 `handleEffectResolveResult` 廣播卡片考驗的 `game:checkResolved`**

同一個檔案，找到 `handleEffectResolveResult`（約第 695-747 行），在既有的 `io.to(roomCode).emit('game:effectResolved', { playerId, sourceId });` **之前**加上：

```js
  if (effectResult.diceCheckResult && content) {
    io.to(roomCode).emit('game:checkResolved', {
      playerId,
      checkKind: 'cardCheck',
      sourceKind: findSourceKind(content, sourceId),
      sourceId,
      stat: effectResult.diceCheckResult.stat,
      rolled: effectResult.diceCheckResult.rolled,
      threshold: null,
      tierEffects: effectResult.diceCheckResult.tierEffects,
      passed: !effectResult.diceCheckResult.tierEffects.some((e) => e.type === 'stat_change' && e.delta < 0),
    });
  }
  io.to(roomCode).emit('game:effectResolved', { playerId, sourceId });
```

- [ ] **Step 5: 新增 `findSourceKind` helper**

在檔案裡任一個既有 helper 函式附近（例如 `findRoomDefinition` 旁邊，約第 525-530 行）新增：

```js
function findSourceKind(content, sourceId) {
  if (content.cards.items.some((c) => c.id === sourceId)) return 'item';
  if (content.cards.events.some((c) => c.id === sourceId)) return 'event';
  if (content.cards.omens.some((c) => c.id === sourceId)) return 'omen';
  if (content.rooms.some((r) => r.id === sourceId) || content.startingRooms.some((r) => r.id === sourceId)) return 'room';
  return null;
}
```

- [ ] **Step 6: 執行 Step 1 的測試，確認通過**

執行：`cd server && npx jest test/socketHandlers.test.js -t "reports hasCheck"`
預期：PASS

- [ ] **Step 7: 新增卡片考驗 `game:checkResolved` 的測試**

```js
test('drawing a card whose effect is a dice_check broadcasts a cardCheck game:checkResolved', async () => {
  const checkResolvedPromise = new Promise((resolve) => currentClient.once('game:checkResolved', resolve));
  // ...觸發抽到 event_001（腐敗惡臭，意志考驗）的既有流程...
  const checkResolved = await checkResolvedPromise;
  expect(checkResolved.checkKind).toBe('cardCheck');
  expect(checkResolved.sourceKind).toBe('event');
  expect(checkResolved.stat).toBe('sanity');
  expect(typeof checkResolved.passed).toBe('boolean');
});
```

- [ ] **Step 8: 執行整個檔案的測試，全數通過**

執行：`cd server && npx jest test/socketHandlers.test.js`
預期：PASS

- [ ] **Step 9: 重啟後端伺服器**

- [ ] **Step 10: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(engine): broadcast game:checkResolved for card-embedded dice_check, add hasCheck to game:cardDrawn"
```

---

## Task 5: 前端 `CheckModal.jsx` 元件 ＋ `mapUtils.js` 的 `findCardInfo`

**Files:**
- Create: `client/src/gameplay/CheckModal.jsx`
- Modify: `client/src/gameplay/mapUtils.js`

**Interfaces:**
- Consumes: `roomContent`/`cardContent`（既有一次性靜態資料）
- Produces：`CheckModal` 元件，props 為 `{ check, roomContent, cardContent, onDone }`；`check` 是 Task 6 從 `game:checkResolved` 佇列裡取出的一筆（`{checkKind, sourceKind, sourceId, stat, rolled, threshold, tierEffects, passed}`）；`onDone` 是玩家按下最終確認鍵時呼叫的 callback（不帶參數）

- [ ] **Step 1: `mapUtils.js` 新增 `findCardInfo`**

打開 `client/src/gameplay/mapUtils.js`，在既有 `findRoomInfo` 函式後面新增：

```js
function findCardInfo(cardId, cardContent) {
  if (!cardContent) return null;
  return (
    (cardContent.items || []).find((c) => c.id === cardId) ||
    (cardContent.events || []).find((c) => c.id === cardId) ||
    (cardContent.omens || []).find((c) => c.id === cardId) ||
    null
  );
}
```

把檔案最後一行的 export 從
```js
export { DIRECTION_DELTA, OPPOSITE_SIDE, getAvailableDirections, findRoomInfo };
```
改成
```js
export { DIRECTION_DELTA, OPPOSITE_SIDE, getAvailableDirections, findRoomInfo, findCardInfo };
```

- [ ] **Step 2: 建立 `CheckModal.jsx`**

新增檔案 `client/src/gameplay/CheckModal.jsx`：

```jsx
import { useState } from 'react';
import { findRoomInfo, findCardInfo } from './mapUtils';

const STAT_LABELS = { might: '力量', speed: '速度', knowledge: '知識', sanity: '意志' };

const TITLE_BY_KIND = {
  leaveCheck: '離開房間考驗',
  collapseCheck: '進入房間考驗',
  cardCheck: '進入房間 · 抽卡考驗',
};

// 骰子動畫佔位（開發者之後會自行設計替換），純粹是延遲揭曉結果的固定時長。
const ANIMATION_MS = 2500;

function resolveSource(check, roomContent, cardContent) {
  if (check.sourceKind === 'room') {
    const room = findRoomInfo(check.sourceId, roomContent);
    return { name: room ? room.name : check.sourceId, text: room ? room.text : '' };
  }
  const card = findCardInfo(check.sourceId, cardContent);
  return { name: card ? card.name : check.sourceId, text: card ? (card.text || card.description || '') : '' };
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 70,
};

const boxStyle = {
  width: 320,
  maxWidth: '90%',
  backgroundColor: '#111',
  color: '#f5f5f0',
  borderRadius: 12,
  padding: 20,
  boxSizing: 'border-box',
};

export default function CheckModal({ check, roomContent, cardContent, onDone }) {
  const [phase, setPhase] = useState('before'); // 'before' | 'animating' | 'result'
  const source = resolveSource(check, roomContent, cardContent);
  const statLabel = STAT_LABELS[check.stat] || check.stat;

  function handleRoll() {
    setPhase('animating');
    setTimeout(() => setPhase('result'), ANIMATION_MS);
  }

  if (phase === 'animating') {
    return (
      <div style={overlayStyle}>
        <div style={boxStyle}>
          <p style={{ fontSize: 20, textAlign: 'center', margin: 0 }}>擲骰中...</p>
        </div>
      </div>
    );
  }

  if (phase === 'result') {
    return (
      <div style={overlayStyle}>
        <div style={boxStyle}>
          <p style={{ fontSize: 14, letterSpacing: 2, color: check.passed ? '#8ad48a' : '#e08a8a', marginBottom: 6 }}>
            考驗結果
          </p>
          <p style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>{source.name}</p>
          <p style={{ fontSize: 22, fontWeight: 'bold', color: check.passed ? '#8ad48a' : '#e08a8a', marginBottom: 10 }}>
            {check.passed ? '成功！' : '失敗...'}
          </p>
          <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>
            {statLabel}考驗擲出 {check.rolled} 點
            {check.threshold != null ? `（需要 ${check.threshold} 以上）` : ''}
          </p>
          <button style={{ width: '100%', fontSize: 18, padding: 12 }} onClick={onDone}>
            確認
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={boxStyle}>
        <p style={{ fontSize: 14, letterSpacing: 2, color: '#e08a8a', marginBottom: 6 }}>
          {TITLE_BY_KIND[check.checkKind] || '考驗'}
        </p>
        <p style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>{source.name}</p>
        <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>{source.text}</p>
        <div style={{ backgroundColor: '#1c1c1c', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 15 }}>
          <div>考驗屬性：{statLabel}</div>
          {check.threshold != null && <div>需要：{check.threshold} 以上</div>}
        </div>
        <button style={{ width: '100%', fontSize: 18, padding: 12 }} onClick={handleRoll}>
          擲骰
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 手動確認元件能被 import 且無語法錯誤**

暫時不會被任何畫面渲染（Task 6 才會接上），先執行 `cd client && npx vite build` 或啟動 `npx vite` 確認沒有編譯錯誤即可（不用真的看到畫面）。

- [ ] **Step 4: Commit**

```bash
git add client/src/gameplay/CheckModal.jsx client/src/gameplay/mapUtils.js
git commit -m "feat(client): add CheckModal two-phase check UI component and findCardInfo helper"
```

---

## Task 6: `DebugGameScreen.jsx` —— 考驗佇列狀態與渲染

**Files:**
- Modify: `client/src/DebugGameScreen.jsx`

**Interfaces:**
- Consumes: `game:checkResolved`（Task 3/4）、`game:cardDrawn.hasCheck`（Task 4）、`CheckModal`（Task 5）
- Produces：畫面上會依序彈出考驗彈窗；`pendingCheckQueue` 內部狀態格式：`Array<{ noCheck: false, ...checkResolvedPayload } | { noCheck: true, playerId, sourceKind, sourceId }>`

- [ ] **Step 1: 新增 `pendingCheckQueue` 狀態＋兩個新事件監聽**

打開 `client/src/DebugGameScreen.jsx`，在既有的 `const [pendingRollChoice, setPendingRollChoice] = useState(null);` 後面新增：

```js
  const [pendingCheckQueue, setPendingCheckQueue] = useState([]);
```

在檔案最上面加入 import：
```js
import CheckModal from './gameplay/CheckModal';
```

在 `useEffect` 裡（第 53-113 行那個區塊），把 `onCardDrawn` 從：
```js
    function onCardDrawn(data) {
      setMessages((prev) => [...prev, `抽到的卡：${JSON.stringify(data)}`]);
    }
```
改成：
```js
    function onCardDrawn(data) {
      if (!data.hasCheck) {
        setPendingCheckQueue((prev) => [
          ...prev,
          { noCheck: true, playerId: data.playerId, sourceKind: data.deckType, sourceId: data.cardId },
        ]);
      }
      setMessages((prev) => [...prev, `抽到的卡：${JSON.stringify(data)}`]); // Task 7 會把這行換成人類可讀句子
    }
```
（`hasCheck:true` 的情況不在這裡推進佇列，因為配對的 `game:checkResolved` 稍後會自己推進——見下一步）

新增一個 handler：
```js
    function onCheckResolved(data) {
      setPendingCheckQueue((prev) => [...prev, { noCheck: false, ...data }]);
    }
```

在同一個 `useEffect` 的 `socket.on(...)` 清單裡加上：
```js
    socket.on('game:checkResolved', onCheckResolved);
```
在對應的 cleanup（`return () => { ... }`）裡加上：
```js
      socket.off('game:checkResolved', onCheckResolved);
```

- [ ] **Step 2: 渲染佇列——`CheckModal` 或無考驗的簡化彈窗**

在檔案裡找到 `pendingEffectChoice`/`pendingRollChoice` 那段彈窗渲染區塊（約第 305-362 行），在它**後面**（同一個 `phase === 'playing'` 的 `<div className="playing-layout">` 內）新增。無考驗的簡化彈窗需要查卡片名稱/內文，先在檔案最上面加入 import：

```js
import { findCardInfo } from './gameplay/mapUtils';
```

然後新增渲染區塊：

```jsx
          {pendingCheckQueue.length > 0 && !pendingCheckQueue[0].noCheck && (
            <CheckModal
              check={pendingCheckQueue[0]}
              roomContent={roomContent}
              cardContent={cardContent}
              onDone={() => setPendingCheckQueue((prev) => prev.slice(1))}
            />
          )}
          {pendingCheckQueue.length > 0 && pendingCheckQueue[0].noCheck && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 70,
              }}
            >
              <div style={{ width: 320, maxWidth: '90%', backgroundColor: '#111', color: '#f5f5f0', borderRadius: 12, padding: 20, boxSizing: 'border-box' }}>
                {(() => {
                  const noCheckEntry = pendingCheckQueue[0];
                  const card = findCardInfo(noCheckEntry.sourceId, cardContent);
                  return (
                    <>
                      <p style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>{card ? card.name : noCheckEntry.sourceId}</p>
                      <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>{card ? (card.text || card.description || '') : ''}</p>
                    </>
                  );
                })()}
                <button
                  style={{ width: '100%', fontSize: 18, padding: 12 }}
                  onClick={() => setPendingCheckQueue((prev) => prev.slice(1))}
                >
                  確認
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 3: 啟動 dev server，手動驗證**

依專案既有規則重啟前後端 dev server。用兩個瀏覽器分頁模擬雙人，走一次流程：移動到一間會觸發 leaveCheck 的房間（例如塔橋），確認：①彈出「離開房間考驗」彈窗，顯示房間 `text` 內容跟屬性/門檻摘要框 ②按下「擲骰」後畫面變成「擲骰中...」約 2.5 秒 ③接著顯示成功/失敗的結果彈窗 ④按「確認」後彈窗關閉，回到正常畫面。再抽一張有考驗的事件卡（例如 event_001 腐敗惡臭）跟一張沒有考驗的卡，確認前者走完整套彈窗流程，後者只彈出「描述＋確認」的簡化版。

- [ ] **Step 4: Commit**

```bash
git add client/src/DebugGameScreen.jsx
git commit -m "feat(client): wire up the check queue, rendering CheckModal / the no-check confirm modal in sequence"
```

---

## Task 7: 訊息欄可讀化＋24px 字體

**Files:**
- Modify: `client/src/DebugGameScreen.jsx`
- Modify: `client/src/gameplay/CharacterPanel.jsx`

**Interfaces:**
- Consumes: `roomContent`/`cardContent`（既有一次性靜態資料）、`gameState.players`（含 `name`）、`game:roomEntered`（Task 3）、`game:checkResolved`（Task 3/4）
- Produces：訊息欄文字改為人類可讀句子＋玩家署名；字體 24px

- [ ] **Step 1: `CharacterPanel.jsx` 字體改 24px**

打開 `client/src/gameplay/CharacterPanel.jsx`，把第 134-140 行：

```jsx
        {messages.length === 0 && (
          <p style={{ margin: '2px 0', fontSize: '0.85em', color: '#888' }}>（尚無訊息）</p>
        )}
        {[...messages].reverse().map((m, i) => (
          <p key={messages.length - i} style={{ margin: '2px 0', fontSize: '0.8em' }}>
            {m}
          </p>
        ))}
```

改成：

```jsx
        {messages.length === 0 && (
          <p style={{ margin: '2px 0', fontSize: 24, color: '#888' }}>（尚無訊息）</p>
        )}
        {[...messages].reverse().map((m, i) => (
          <p key={messages.length - i} style={{ margin: '2px 0', fontSize: 24 }}>
            {m}
          </p>
        ))}
```

- [ ] **Step 2: `DebugGameScreen.jsx` 新增玩家名稱查表 helper**

在檔案裡新增一個小 helper（放在 import 區塊之後、元件定義之前）：

```js
function findPlayerName(playerId, players) {
  const player = (players || []).find((p) => p.playerId === playerId);
  return player ? player.name : playerId;
}
```

- [ ] **Step 3: 新增 `game:roomEntered` 監聽，寫入人類可讀訊息**

在同一個 `useEffect` 區塊，新增 handler：

```js
    function onRoomEntered(data) {
      const room = findRoomInfo(data.roomId, roomContent);
      const playerName = findPlayerName(data.playerId, gameState?.players);
      setMessages((prev) => [...prev, `${playerName} 進入了「${room ? room.name : data.roomId}」`]);
    }
```

在檔案最上面的 import 補上 `findRoomInfo`（如果原本沒有的話）：
```js
import { getAvailableDirections, findRoomInfo, findCardInfo } from './gameplay/mapUtils';
```
（跟原本的 `import { getAvailableDirections } from './gameplay/mapUtils';` 合併成一行；`findCardInfo` 這裡也一併補上，因為 Task 6 已經在用它）

在 `socket.on(...)`/`socket.off(...)` 清單裡分別加上 `game:roomEntered` 的註冊與清除，比照 `game:checkResolved` 的加法方式。

- [ ] **Step 4: 把 `onCardDrawn` 的訊息文字換成人類可讀句子**

把 Task 6 Step 1 留下的
```js
      setMessages((prev) => [...prev, `抽到的卡：${JSON.stringify(data)}`]); // Task 7 會把這行換成人類可讀句子
```
改成：

```js
      const card = findCardInfo(data.cardId, cardContent);
      const cardName = card ? card.name : data.cardId;
      const playerName = findPlayerName(data.playerId, gameState?.players);
      const templateByDeck = {
        event: `${playerName}：發生了 ${cardName}`,
        item: `${playerName} 在房間裡找到了 ${cardName}`,
        omen: `${playerName}看到了一個怪異的現象（${cardName}）`,
      };
      setMessages((prev) => [...prev, templateByDeck[data.deckType] || `${playerName} 抽到了 ${cardName}`]);
```

- [ ] **Step 5: 把考驗結果也寫進訊息欄**

在 `onCheckResolved`（Task 6 Step 1 新增的）裡追加一行訊息：

```js
    function onCheckResolved(data) {
      setPendingCheckQueue((prev) => [...prev, { noCheck: false, ...data }]);
      const playerName = findPlayerName(data.playerId, gameState?.players);
      const STAT_LABELS_LOCAL = { might: '力量', speed: '速度', knowledge: '知識', sanity: '意志' };
      const statLabel = STAT_LABELS_LOCAL[data.stat] || data.stat;
      setMessages((prev) => [
        ...prev,
        `${playerName}：${statLabel}考驗${data.passed ? '成功' : '失敗'}（擲出 ${data.rolled} 點）`,
      ]);
    }
```

- [ ] **Step 6: 啟動 dev server，手動驗證**

重啟前後端。雙分頁模擬雙人，確認：①進入新房間時訊息欄出現「XX 進入了『房間名』」②抽到事件/道具/預兆卡時出現對應句型③考驗結果也會寫進訊息欄④文字明顯比之前大（24px）⑤訊息欄裡完全看不到 `JSON.stringify` 那種花括號/引號堆疊的文字。

- [ ] **Step 7: Commit**

```bash
git add client/src/DebugGameScreen.jsx client/src/gameplay/CharacterPanel.jsx
git commit -m "feat(client): human-readable message log with player names, 24px font"
```

---

## Self-Review Checklist（實作完成後逐項確認）

- [ ] 7 個任務的 spec 涵蓋範圍：leaveCheck／崩塌房間／卡片考驗三者皆已統一走 `game:checkResolved`（對照設計文件的「各觸發點需要的程式改動」段落）
- [ ] 房間進入的人類可讀訊息（設計文件沒有明講但屬於「訊息欄新增進入房間訊息」這個原始需求的一部分）已經在 Task 3/7 補上（`game:roomEntered`）
- [ ] 無考驗卡片／房間仍然只顯示「描述＋確認」，不會誤跳出擲骰按鈕
- [ ] 全部 7 個任務都不依賴尚未完成的任務（依序 1→2→3→4→5→6→7，6 依賴 5，7 依賴 6 的 `onCardDrawn`/`onCheckResolved` 骨架）
- [ ] 伺服器端每個新欄位的加入都用了「只在有值時才加上」的寫法，不會讓既有精確比對測試意外炸掉（除了 Task 1 Step 7 明確列出的 6 處已知需要更新的既有斷言）
