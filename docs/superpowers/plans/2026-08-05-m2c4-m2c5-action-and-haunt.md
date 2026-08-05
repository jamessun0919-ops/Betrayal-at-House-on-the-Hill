# M2c-4（道具／操作動作接線）＋ M2c-5（邪祟考驗機制）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `turnFlow.js` 的 `selectAction` 從殼子接上「道具」「操作」的真實效果解析，並在抽到預兆卡時執行邪祟考驗（累計骰子總和 >5 觸發邪祟）。

**Architecture:** 沿用 M2c-1/M2c-2 已建好的 `effectResolver.resolveEffects`／`effectResolverManager`／`pendingChoice`／`EFFECT_CHOICE_IN_PROGRESS` 死鎖防護機制，不重新設計。`turnFlow.js` 只驗證合法性（持有、同房間、行動力、回合歸屬），內容查表（道具/房間的 `effects` 陣列）跟實際呼叫 `resolveEffects` 都放在 `socketHandlers.js`，維持 `turnFlow.js` 不依賴靜態內容目錄的既有邊界。

**Tech Stack:** Node.js（CommonJS）、Socket.IO、Jest。不使用 TypeScript。

## Global Constraints

- 所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串
- 不做兩層 20 秒計時提問 UI——`game:selectAction` 維持跟 `game:move` 一致的直接事件模式
- 「襲擊」動作維持殼子不動（`{kind:'attack', pending:true}`），M3 範圍
- 天使羽毛／詭異人偶／幸運兔腳／蠟燭（反應式道具）本次不支援主動使用，不用為它們寫任何觸發邏輯
- 每個任務完成後執行 `cd server && npx jest` 確認全部既有測試仍然全綠

---

## Task 1: 卡片資料新增 `category`／`canTargetOthers` 欄位（schema，數值由開發者確認）

**Files:**
- Modify: `data/cards/item-cards.json`
- Modify: `data/cards/omen-cards.json`

**這個任務沒有自動化測試**——純資料欄位新增，agent 只補框架跟合理預設值，實際數值由開發者逐張確認修正（見設計文件 2.3 節）。

- [ ] **Step 1: 修改 `item-cards.json`**

在每一筆**已填內容**的道具（`item_001` 到 `item_012`，不含最後兩筆空白模板）新增 `category`／`canTargetOthers` 兩個欄位，放在 `effects` 之後、`needsCustomLogic` 之前。預設值規則：武器類（`item_001` 左輪手槍、`item_002` 炸藥、`item_011` 斧頭、`item_012` 獻祭之劍）填 `category:"weapon"`；卡面文字明確寫「使用一次後消失」的（`item_002`/`item_003`/`item_004`/`item_005`）填 `category:"consumable"`；其餘（`item_006`/`item_007`/`item_008`/`item_009`/`item_010`）填 `category:"general"`。`canTargetOthers` 只有 `item_003`（治療藥膏）跟 `item_004`（嗅鹽）填 `true`，其餘全部 `false`。兩筆空白模板（`id:""`）也各自加上 `category:"general"`／`canTargetOthers:false` 當預設佔位，維持 JSON 陣列結構一致。

範例（`item_003` 修改後）：

```json
{
  "id": "item_003",
  "name": "治療藥膏",
  "description": "",
  "text": "玩家回合可選擇使用在自己或同房間玩家，若目標對象的力量、速度或兩者皆低於該角色基本數值，則將該能力回復至基本值。本道具使用一次後消失。",
  "effects": [],
  "category": "consumable",
  "canTargetOthers": true,
  "needsCustomLogic": true
}
```

**開發者請逐張複查這份預設值，尤其是 `category` 的武器/消耗品/一般三選一，agent 只是依卡面文字做第一輪合理猜測。**

- [ ] **Step 2: 修改 `omen-cards.json`**

每一筆新增 `category` 欄位（不加 `canTargetOthers`，見設計文件 2.3 節）。`omen_010`（戒指）、`omen_012`（長矛）填 `category:"weapon"`，其餘 11 筆填 `category:"general"`。**沒有任何一筆填 `"consumable"`**——所有預兆卡都要保留在場上計入 `omenCount`。

範例（`omen_010` 修改後）：

```json
{ "id": "omen_010", "name": "戒指", "text": "玩家在自身的回合可以選擇以意志進行襲擊，如果襲擊成功，敵方受到精神損傷而非肉體損傷，對於無意志的目標無法使用", "effects": [], "category": "weapon" }
```

- [ ] **Step 3: 驗證 JSON 合法**

Run: `node -e "JSON.parse(require('fs').readFileSync('data/cards/item-cards.json'))" && node -e "JSON.parse(require('fs').readFileSync('data/cards/omen-cards.json'))" && echo OK`
Expected: 印出 `OK`，沒有拋出解析錯誤

- [ ] **Step 4: Commit**

```bash
git add data/cards/item-cards.json data/cards/omen-cards.json
git commit -m "feat(m2c4): add category/canTargetOthers fields to item and omen cards"
```

---

## Task 2: `effectResolver.js` — `resolveEffects` 新增 `appliedCount`

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Modify: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: 無新依賴
- Produces: `resolveEffects` 的非 pending 回傳值從 `{pending: false}` 擴充為 `{pending: false, appliedCount: number}`——`appliedCount` 是實際套用的效果數（`dice_check` 命中空陣列分支時整條鏈路回傳 0，透過既有的遞迴呼叫自動往外層傳遞，不需要修改 `handleDiceCheck`）

- [ ] **Step 1: 修改既有測試斷言（兩處會因為回傳值變化而失敗）**

`effectResolver.test.js` 目前有兩處用 `toEqual` 嚴格比對整個回傳值，新增 `appliedCount` 後會失敗。先修正這兩處，讓它們符合新的預期形狀：

```js
test('resolveEffects applies a stat_change delta', () => {
  const gameState = makeGameStateWithPlayer();
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', delta: 1 },
  ]);
  expect(result).toEqual({ pending: false, appliedCount: 1 });
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(3); // baseIndex 2 + 1
});
```

```js
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
```

- [ ] **Step 2: 新增 `appliedCount` 專用測試**

在檔案最後新增：

```js
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

test('resolveEffects appliedCount is 0 for an empty effects array', () => {
  const gameState = makeGameStateWithPlayer();
  const result = resolveEffects(gameState, createPromptState(), 'p1', []);
  expect(result).toEqual({ pending: false, appliedCount: 0 });
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js`
Expected: FAIL——所有斷言 `appliedCount` 的測試都會失敗（目前回傳值沒有這個欄位）

- [ ] **Step 4: 實作**

修改 `server/src/game/effectResolver.js` 的 `resolveEffects` 函式：

```js
function resolveEffects(gameState, promptState, playerId, effects, context = {}) {
  if (!Array.isArray(effects)) {
    throw new Error('INVALID_EFFECTS_LIST');
  }
  requirePlayer(gameState, playerId);
  let appliedCount = 0;
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
  }
  return { pending: false, appliedCount };
}
```

（其餘函式，包含所有 `HANDLERS` 裡的個別 handler，完全不變。）

- [ ] **Step 5: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js`
Expected: PASS，全部測試（含既有的）通過

- [ ] **Step 6: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat(m2c4): add appliedCount to resolveEffects for consumable-use tracking"
```

---

## Task 3: `turnFlow.js` — `selectAction` 接上道具／操作真實邏輯

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Modify: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: 無新依賴（`gameState.board`/`coordKey` 已經在檔案內可用）
- Produces: `selectAction(gameState, playerId, actionType, options = {})` 簽名擴充：
  - `actionType==='item'`：`options = {itemId, targetPlayerId, itemCanTargetOthers}`，成功回傳 `{kind:'item', itemId, targetPlayerId}`（`targetPlayerId` 沒帶則等於 `playerId`），拋 `ITEM_NOT_HELD`／`ITEM_CANNOT_TARGET_OTHERS`／`TARGET_NOT_IN_ROOM`
  - `actionType==='room_action'`：`options = {hasRoomAction}`，成功回傳 `{kind:'room_action'}`，拋 `NO_ROOM_ACTION_AVAILABLE`
  - `actionType==='attack'`：行為不變，回傳 `{kind:'attack', pending:true}`

- [ ] **Step 1: 修改一筆既有測試（'item' 動作語意整個變了，殼子測試要換成 'attack'）**

`turnFlow.test.js` 現有這個測試用 `'item'` 驗證「殼子行為」，但 `'item'` 現在有真實邏輯了，不再是殼子。改成用 `'attack'`（唯一還維持殼子的類型）：

```js
test('selectAction deducts 1 action point and returns a pending marker for attack (still a stub)', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'attack');
  expect(result).toEqual({ kind: 'attack', pending: true });
  expect(player.actionPoints).toBe(startingAP - 1);
});
```

- [ ] **Step 2: 新增道具／操作動作的測試**

在檔案最後新增：

```js
test('selectAction item: succeeds when the player holds the item, defaults target to self', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_003' });
  expect(result).toEqual({ kind: 'item', itemId: 'item_003', targetPlayerId: 'p1' });
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('selectAction item: throws ITEM_NOT_HELD when the player does not have the item', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => selectAction(gameState, 'p1', 'item', { itemId: 'item_003' })).toThrow('ITEM_NOT_HELD');
});

test('selectAction item: succeeds targeting another player in the same room when itemCanTargetOthers is true', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  // addPlayer always places new players at the entrance hall (0,0), same as p1.
  player.inventory.push({ id: 'item_003' });
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_003', targetPlayerId: 'p2', itemCanTargetOthers: true });
  expect(result).toEqual({ kind: 'item', itemId: 'item_003', targetPlayerId: 'p2' });
  expect(player2.floor).toBe('ground'); // sanity check target resolved correctly
});

test('selectAction item: throws ITEM_CANNOT_TARGET_OTHERS when targeting another player without permission', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.inventory.push({ id: 'item_010' });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_010', targetPlayerId: 'p2', itemCanTargetOthers: false })
  ).toThrow('ITEM_CANNOT_TARGET_OTHERS');
});

test('selectAction item: throws TARGET_NOT_IN_ROOM when the target is elsewhere, even with itemCanTargetOthers', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player2.x = 5; // move p2 out of the entrance hall
  player.inventory.push({ id: 'item_003' });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_003', targetPlayerId: 'p2', itemCanTargetOthers: true })
  ).toThrow('TARGET_NOT_IN_ROOM');
});

test('selectAction room_action: succeeds when hasRoomAction is true', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'room_action', { hasRoomAction: true });
  expect(result).toEqual({ kind: 'room_action' });
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('selectAction room_action: throws NO_ROOM_ACTION_AVAILABLE when hasRoomAction is false or omitted', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => selectAction(gameState, 'p1', 'room_action', { hasRoomAction: false })).toThrow('NO_ROOM_ACTION_AVAILABLE');
  expect(() => selectAction(gameState, 'p1', 'room_action')).toThrow('NO_ROOM_ACTION_AVAILABLE');
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: FAIL——新增的 item/room_action 測試會失敗（目前 `selectAction` 對所有 actionType 都回傳同一種殼子）

- [ ] **Step 4: 實作**

修改 `server/src/game/turnFlow.js` 的 `selectAction` 函式：

```js
function selectAction(gameState, playerId, actionType, options = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (!ACTION_TYPES.includes(actionType)) {
    throw new Error('INVALID_ACTION_TYPE');
  }
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }

  if (actionType === 'item') {
    const { itemId, targetPlayerId } = options;
    if (!player.inventory.some((item) => item.id === itemId)) {
      throw new Error('ITEM_NOT_HELD');
    }
    const effectTargetId = targetPlayerId || playerId;
    if (effectTargetId !== playerId && !options.itemCanTargetOthers) {
      throw new Error('ITEM_CANNOT_TARGET_OTHERS');
    }
    const targetPlayer = requirePlayer(gameState, effectTargetId);
    if (
      targetPlayer.floor !== player.floor ||
      targetPlayer.x !== player.x ||
      targetPlayer.y !== player.y
    ) {
      throw new Error('TARGET_NOT_IN_ROOM');
    }
    player.actionPoints -= 1;
    return { kind: 'item', itemId, targetPlayerId: effectTargetId };
  }

  if (actionType === 'room_action') {
    if (!options.hasRoomAction) {
      throw new Error('NO_ROOM_ACTION_AVAILABLE');
    }
    player.actionPoints -= 1;
    return { kind: 'room_action' };
  }

  player.actionPoints -= 1;
  return { kind: actionType, pending: true };
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: PASS，全部測試（含既有的）通過

Run: `cd server && npx jest`
Expected: PASS，全部既有測試全綠

- [ ] **Step 6: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat(m2c4): wire item/room_action into selectAction with target and holding validation"
```

---

## Task 4: `socketHandlers.js` — `cardId`→`sourceId` 改名＋`consumeItemIfApplied` 支援

**Files:**
- Modify: `server/src/socketHandlers.js`
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `getPlayer` from `./game/gameState`（已匯入）、`removeItem` from `./game/playerEntity`（新增匯入）
- Produces：
  - `handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied = false)`——參數改名＋新增第9個參數
  - `game:effectResolved`／`game:effectPendingChoice` 廣播的 payload 欄位從 `cardId` 改成 `sourceId`（`game:cardDrawn` **維持 `cardId` 不變**，因為那個事件本來就永遠是卡片）
  - `pendingChoice` 物件新增 `sourceId`（取代 `cardId`）跟 `consumeItemIfApplied` 兩個欄位

這個任務**只做介面準備，不新增使用者可見的新行為**——`resolveCardDraw` 呼叫 `handleEffectResolveResult` 時 `consumeItemIfApplied` 維持省略（預設 `false`），行為跟現在完全一樣，只是換了參數名字、多了一個沒人用的可選參數。Task 5 才會真的傳 `true` 進去。

- [ ] **Step 1: 修改既有測試斷言**

`socketHandlers.test.js` 裡有一處斷言讀 `game:effectResolved` 廣播的 `cardId` 欄位，要改成 `sourceId`：

```js
  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.sourceId).toBe('item_001');
```

（同一個測試裡 `cardDrawn.cardId` 那一行維持不變，`game:cardDrawn` 沒有改名。）

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js`
Expected: FAIL——剛改的斷言會失敗（`effectResolved.sourceId` 現在還是 `undefined`，欄位還叫 `cardId`）

- [ ] **Step 3: 實作**

修改 `server/src/socketHandlers.js` 頂部 `require`，加入 `removeItem`：

```js
const { moveToRoom, selectAction, useStairs, isTurnOver, advanceTurn } = require('./game/turnFlow');
const { startResolver, getResolver } = require('./game/effectResolverManager');
const { resolveEffects, resolveChoiceOption } = require('./game/effectResolver');
const { hasCards, drawCard } = require('./game/cardDeck');
const { removeItem } = require('./game/playerEntity');
```

修改 `handleEffectResolveResult`：

```js
function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied = false) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending) {
    resolverEntry.pendingChoice = {
      promptId: effectResult.promptId,
      options: effectResult.options,
      defaultOptionId: effectResult.defaultOptionId,
      playerId,
      sourceId,
      consumeItemIfApplied,
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
    return { pending: true };
  }
  resolverEntry.pendingChoice = null;
  if (consumeItemIfApplied && effectResult.appliedCount > 0) {
    const player = getPlayer(gameState, playerId);
    removeItem(player, sourceId);
  }
  io.to(roomCode).emit('game:effectResolved', { playerId, sourceId });
  return { pending: false };
}
```

修改 `resolveCardDraw`（只改最後一行的呼叫，`game:cardDrawn` 那行的 `cardId:card.id` 不動）：

```js
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, { now: Date.now() });
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, card.id, effectResult, effectChoiceTimeouts);
```

（這行參數順序沒變，只是第6個參數現在在函式簽名裡叫 `sourceId` 不叫 `cardId`，呼叫端不用改。）

修改 `handleEffectChoiceTimeout`：

```js
function handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, promptId, effectChoiceTimeouts) {
  try {
    const resolverEntry = getResolver(effectResolverManager, roomCode);
    if (!resolverEntry || !resolverEntry.pendingChoice) return;
    effectChoiceTimeouts.delete(roomCode);
    const { playerId, sourceId, options, defaultOptionId, consumeItemIfApplied } = resolverEntry.pendingChoice;
    const result = resolvePromptTimeout(resolverEntry.promptState, { promptId, defaultOptionId });
    if (!result) {
      return;
    }
    io.to(roomCode).emit('game:promptResolved', result);
    const chosenEffects = resolveChoiceOption(options, result.chosenOptionId);
    const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, chosenEffects, { now: Date.now() });
    const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied);
    if (!resolveOutcome.pending) {
      advanceTurnIfOver(gameState, playerId);
    }
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('effect choice timeout error', err);
  }
}
```

修改 `game:effectPromptRespond` handler：

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
        const { playerId: choicePlayerId, sourceId, options, consumeItemIfApplied } = resolverEntry.pendingChoice;
        const result = respondToPrompt(resolverEntry.promptState, { promptId, playerId, optionId });
        clearEffectChoiceTimeout(roomCode, effectChoiceTimeouts);
        io.to(roomCode).emit('game:promptResolved', result);
        const chosenEffects = resolveChoiceOption(options, result.chosenOptionId);
        const nextResult = resolveEffects(gameState, resolverEntry.promptState, choicePlayerId, chosenEffects, { now: Date.now() });
        const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, choicePlayerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied);
        if (!resolveOutcome.pending) {
          advanceTurnIfOver(gameState, choicePlayerId);
        }
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
Expected: PASS，全部既有測試全綠

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "refactor(m2c4): rename cardId to sourceId and add consumeItemIfApplied plumbing"
```

---

## Task 5: `socketHandlers.js` — `game:selectAction` 接上道具／操作真實邏輯

**Files:**
- Modify: `server/src/socketHandlers.js`
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `getPlayer`（已匯入）、`coordKey` from `./game/boardGenerator`（新增匯入）
- Produces: 新增私有函式 `findRoomDefinition(content, roomId)`；`game:selectAction` handler 完全改寫，支援真實道具/操作效果解析

- [ ] **Step 1: 寫失敗測試**

在 `server/test/socketHandlers.test.js` 找到既有的 `setUpStartedGameWithContent` 定義（不用改它），在檔案最後新增。因為目前沒有任何 socket 事件可以把道具塞進玩家背包（`grant_item` 只會在卡片效果解析時發生），測試改成**直接操作伺服器端 `gameState`** 給玩家道具，透過 `setUpStartedGameWithContent` 回傳的 `roomCode`／`gameManager` 取得：

```js
test('game:selectAction item: uses a held consumable item on self and removes it from inventory after it applies', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_003',
        name: '治療藥膏',
        effects: [{ type: 'stat_change', stat: 'might', delta: 1 }],
        category: 'consumable',
        canTargetOthers: true,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_003' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const result = await new Promise((resolve) => {
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result).toEqual({ kind: 'item', itemId: 'item_003', targetPlayerId: currentPlayerId });

  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.sourceId).toBe('item_003');
  expect(getPlayer(gameState, currentPlayerId).stats.might.currentIndex).toBe(3); // baseIndex 2 + 1
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([]); // consumable removed after applying

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: throws ITEM_NOT_HELD when the player does not have the item', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'not_held' }, resolve);
  });
  expect(result.error).toBe('ITEM_NOT_HELD');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: a general-category item is not removed from inventory after use', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_006',
        name: '詭異人偶',
        effects: [{ type: 'stat_change', stat: 'might', delta: 1 }],
        category: 'general',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_006' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_006' }, resolve));
  await effectResolvedPromise;

  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_006' }]); // still held

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item: a consumable item that fails its check is not removed (matches 魔術方塊 rules)', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_009',
        name: '魔術方塊',
        effects: [{
          type: 'dice_check',
          diceCount: 1,
          tiers: [{ min: 0, max: 8, effects: [] }], // always "fails" -> no effects applied
        }],
        category: 'consumable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_009' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_009' }, resolve));
  await effectResolvedPromise;

  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_009' }]); // check "failed" -> not consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: resolves the current room\'s effects', async () => {
  const content = makeContent({
    rooms: [{
      id: 'room_new',
      doors: 4,
      floor: 'ground',
      effects: [{ type: 'stat_change', stat: 'might', delta: 1 }],
    }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  expect(result).toEqual({ kind: 'room_action' });

  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.sourceId).toBe('room_new');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: throws NO_ROOM_ACTION_AVAILABLE when the current room has no effects', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();
  // Default starting room (entrance hall) has no `effects` field.

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBe('NO_ROOM_ACTION_AVAILABLE');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

**注意**：這裡假設 `setUpStartedGameWithContent`／`setUpStartedGame` 的回傳物件裡有 `roomCode`／`gameManager`——檔案目前的版本已經回傳這兩個欄位（`setUpStartedGameWithContent` 回傳 `{..., roomCode, ...}`，`startTestServer` 回傳 `{..., gameManager, ...}`，`setUpStartedGameWithContent` 內部呼叫 `startTestServer` 後沒有把 `gameManager` 往外傳）——**要先確認並補上**：在 `setUpStartedGameWithContent` 函式的 `return` 那行加上 `gameManager`：

```js
  return { httpServer, clientA, clientB, roomCode, aliceId, bobId, currentClient, otherClient, currentPlayerId, startedPayload, gameManager };
```

（`setUpStartedGame()` 那個既有版本的 `return` 也要比照加上 `gameManager`，因為 `game:selectAction item: throws ITEM_NOT_HELD` 這個測試用的是 `setUpStartedGame()`，雖然這個特定測試沒有用到 `gameManager`，但保持兩個 helper 回傳形狀一致比較不容易踩坑。）

還要在檔案最上方的 `require` 加入 `getGameState`／`getPlayer`：

```js
const { getGameState } = require('../src/game/gameManager');
const { getPlayer } = require('../src/game/gameState');
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js`
Expected: FAIL——新增的 item/room_action selectAction 測試會失敗（`game:selectAction` 目前對所有 actionType 都走殼子路徑，不會真的解析效果）

- [ ] **Step 3: 實作**

修改 `server/src/socketHandlers.js` 頂部 `require`，加入 `coordKey`：

```js
const { coordKey } = require('./game/boardGenerator');
```

新增私有函式 `findRoomDefinition`（放在 `hasPendingEffectChoice` 函式之後）：

```js
function findRoomDefinition(content, roomId) {
  return (
    content.rooms.find((r) => r.id === roomId) ||
    content.startingRooms.find((r) => r.id === roomId)
  );
}
```

把 `game:selectAction` handler 整個換成：

```js
    socket.on('game:selectAction', (payload, callback) => {
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
        const { actionType, itemId, targetPlayerId } = payload || {};
        const selectOptions = { itemId, targetPlayerId };
        let sourceEffects = null;
        let sourceId = null;
        let consumeItemIfApplied = false;

        if (actionType === 'item') {
          const itemContent = content.cards.items.find((i) => i.id === itemId);
          selectOptions.itemCanTargetOthers = Boolean(itemContent && itemContent.canTargetOthers);
          sourceEffects = itemContent ? itemContent.effects : [];
          sourceId = itemId;
          consumeItemIfApplied = Boolean(itemContent && itemContent.category === 'consumable');
        }

        if (actionType === 'room_action') {
          const currentPlayer = getPlayer(gameState, playerId);
          const placedRoom = gameState.board[currentPlayer.floor].get(coordKey(currentPlayer.x, currentPlayer.y));
          const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
          sourceEffects =
            roomDefinition && Array.isArray(roomDefinition.effects) && roomDefinition.effects.length > 0
              ? roomDefinition.effects
              : null;
          selectOptions.hasRoomAction = Boolean(sourceEffects);
          sourceId = placedRoom.roomId;
        }

        const result = selectAction(gameState, playerId, actionType, selectOptions);
        ack(result);

        let stillResolving = false;
        if (sourceEffects) {
          try {
            const resolverEntry = getResolver(effectResolverManager, roomCode);
            const targetForEffects = result.targetPlayerId || playerId;
            const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now() });
            const outcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, targetForEffects, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied);
            stillResolving = outcome.pending;
          } catch (err) {
            console.error('selectAction effect resolution error', err);
          }
        } else if (result.pending) {
          io.to(roomCode).emit('game:pendingAction', { playerId, actionType: result.kind });
        }

        if (!stillResolving) {
          advanceTurnIfOver(gameState, playerId);
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:selectAction error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js`
Expected: PASS

Run: `cd server && npx jest`
Expected: PASS，全部既有測試全綠

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(m2c4): wire real item/room_action effect resolution into game:selectAction"
```

---

## Task 6: 邪祟考驗機制（M2c-5）

**Files:**
- Modify: `server/src/socketHandlers.js`
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `rollDice` from `./game/effectPipeline`（新增匯入）
- Produces: `game:hauntCheck`（廣播）：`{omenCount, rollSum}`；`game:hauntStarted`（廣播）：`{omenCount, rollSum}`

- [ ] **Step 1: 寫失敗測試**

在 `server/test/socketHandlers.test.js` 最後新增：

```js
test('drawing an omen card increments omenCount and broadcasts a haunt check', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{ id: 'omen_002', name: '書', effects: [{ type: 'stat_change', stat: 'knowledge', delta: 1 }] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const hauntCheckPromise = new Promise((resolve) => currentClient.once('game:hauntCheck', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const hauntCheck = await hauntCheckPromise;
  expect(hauntCheck.omenCount).toBe(1);
  expect(typeof hauntCheck.rollSum).toBe('number');

  const gameState = getGameState(gameManager, roomCode);
  expect(gameState.omenCount).toBe(1);

  clientA.close();
  clientB.close();
  httpServer.close();
});

用真實 `rollDice`（沒有注入 rng）測試「會不會觸發」是機率性的，會讓測試變成偶發性失敗。改成用 `jest.spyOn(Math, 'random')` 讓骰子結果確定（`rollDice` 在 `socketHandlers.js` 呼叫端沒有注入 rng 參數的管道，只能在測試裡直接 patch `Math.random`），並且先手動把 `omenCount` 墊高，讓這次抽卡遞增後骰的顆數足以確定觸發：

```js
test('a haunt check summing over 5 sets hauntStarted and broadcasts game:hauntStarted', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{ id: 'omen_001', name: '測試預兆', effects: [] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const gameState = getGameState(gameManager, roomCode);
  gameState.omenCount = 2; // this draw brings it to 3 -> 3 dice rolled

  // Force every die to roll its maximum face (2): 3 dice * 2 = 6 > 5, guaranteed trigger.
  jest.spyOn(Math, 'random').mockReturnValue(0.99);

  const hauntStartedPromise = new Promise((resolve) => currentClient.once('game:hauntStarted', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));

  const hauntStarted = await hauntStartedPromise;
  expect(hauntStarted.omenCount).toBe(3);
  expect(hauntStarted.rollSum).toBe(6);
  expect(gameState.hauntStarted).toBe(true);

  jest.restoreAllMocks();
  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a haunt check that does not exceed 5 does not set hauntStarted', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{ id: 'omen_001', name: '測試預兆', effects: [] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  // Force every die to roll its minimum face (0): omenCount=1 -> 1 die -> sum 0, well under 5.
  jest.spyOn(Math, 'random').mockReturnValue(0);

  let hauntStartedFired = false;
  currentClient.on('game:hauntStarted', () => {
    hauntStartedFired = true;
  });

  const hauntCheckPromise = new Promise((resolve) => currentClient.once('game:hauntCheck', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const hauntCheck = await hauntCheckPromise;

  expect(hauntCheck.rollSum).toBe(0);
  expect(hauntStartedFired).toBe(false);
  const gameState = getGameState(gameManager, roomCode);
  expect(gameState.hauntStarted).toBe(false);

  jest.restoreAllMocks();
  clientA.close();
  clientB.close();
  httpServer.close();
});
```

（連同最前面「omenCount 遞增＋廣播 game:hauntCheck」的測試，這個任務總共新增三個測試。）

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js`
Expected: FAIL——三個新測試都會失敗（`omenCount` 從未遞增，`game:hauntCheck`/`game:hauntStarted` 從未廣播）

- [ ] **Step 3: 實作**

修改 `server/src/socketHandlers.js` 頂部 `require`，加入 `rollDice`：

```js
const { rollDice } = require('./game/effectPipeline');
```

修改 `resolveCardDraw`，在抽卡廣播之後、效果解析之前加入邪祟考驗：

```js
function resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, deckType, effectChoiceTimeouts) {
  const deckField = DECK_FIELD_BY_TYPE[deckType];
  if (!deckField) {
    throw new Error('UNKNOWN_DECK_TYPE');
  }
  const deck = gameState[deckField];
  if (!hasCards(deck)) {
    return { pending: false };
  }
  const card = drawCard(deck);
  io.to(roomCode).emit('game:cardDrawn', { playerId, deckType, cardId: card.id, cardName: card.name });

  if (deckType === 'omen' && !gameState.hauntStarted) {
    gameState.omenCount += 1;
    const rollSum = rollDice(gameState.omenCount);
    io.to(roomCode).emit('game:hauntCheck', { omenCount: gameState.omenCount, rollSum });
    if (rollSum > 5) {
      gameState.hauntStarted = true;
      io.to(roomCode).emit('game:hauntStarted', { omenCount: gameState.omenCount, rollSum });
    }
  }

  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, { now: Date.now() });
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, card.id, effectResult, effectChoiceTimeouts);
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js`
Expected: PASS

Run: `cd server && npx jest`
Expected: PASS，全部既有測試全綠

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(m2c5): trigger haunt check on each omen draw, set hauntStarted when the roll exceeds 5"
```
