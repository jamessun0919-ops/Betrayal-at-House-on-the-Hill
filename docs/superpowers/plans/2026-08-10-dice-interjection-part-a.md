# 可被道具介入的擲骰（Part A：dice_check 路徑）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `item_005`（天使羽毛）/`item_006`（詭異人偶）/`item_010`（蠟燭）三張道具能在卡片/房間操作觸發的 `dice_check` 擲骰前，自動偵測玩家是否持有相關道具，跳出詢問視窗讓玩家決定要不要介入。

**Architecture:** 新增卡片頂層欄位 `diceInterjection`（跟 `effects` 平行）宣告道具的介入能力。`handleDiceCheck`（`effectResolver.js`）擲骰前先掃描玩家背包，若有可用道具則回傳一個新的 pending 結果（`rollChoice:true`，跟既有 `choice` 效果的 pending 區分開），`socketHandlers.js` 收到後建立一個全新、獨立的暫停狀態 `pendingRollChoice`（不影響既有的 `pendingChoice`），跳出詢問視窗；玩家回應（或逾時預設不使用）後，透過新的 `game:diceChoiceRespond` 事件恢復，把選擇結果放進 `context.interjectionChoice` 重新呼叫 `resolveEffects`，讓 `handleDiceCheck` 從「已經知道要不要用道具」這一步接續原本邏輯（套用道具代價/加骰/覆蓋值、擲骰、比對 `tiers`、解析後續 `effects`）。

本計畫**只涵蓋 `dice_check` 路徑**（卡片/房間操作觸發的擲骰，例如水晶球/面具/保險庫）。`leaveCheck` 路徑（離開房間前考驗，塔橋/雜亂的房間/藤蔓糾纏的溫室）的道具介入支援是 Part B，另一份計畫，等 Part A 完成後才執行。

**Tech Stack:** Node.js + CommonJS，沿用 `server/src/game/` 現有模組結構；Jest 測試。

## Global Constraints

- 純 JavaScript，不使用 TypeScript
- 所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串
- `effectResolver.js`/`diceInterjection.js` 不可以直接讀取 `content` 目錄——需要的卡片資料一律透過 `context.itemCatalog`（呼叫端從 `content.cards.items` 準備好往下傳）取得，這是既有「action boundary」慣例的延伸：`effectResolver.js` 只處理已經解析好的資料，不自己查內容目錄
- 新增的 `pendingRollChoice` 狀態要跟既有的 `pendingChoice` 完全獨立（各自的欄位、各自的逾時計時器 map、各自的 socket 事件），不可以合併成同一個欄位或同一個 respond 事件
- `handleDiceCheck` 恢復時（`context.interjectionChoice` 已定義）解析 tier 命中的 `effects` 前，一定要把 `interjectionChoice` 從往下傳的 context 裡拿掉，避免這個選擇結果誤套用到巢狀的下一個 `dice_check`（目前沒有卡片會巢狀，但這是正確性問題，不能省略）
- 每個任務結束都要跑 `cd server && npx jest --forceExit` 確認全套測試綠燈，再 commit

---

## Task 1: `player.diceInterjectionUsedThisTurn` 欄位＋回合重置

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: 無新依賴
- Produces: `player.diceInterjectionUsedThisTurn`（道具 id 字串陣列，lazy-optional，`createPlayer` 不初始化，比照 `summons`/`summonUsedThisTurn`），`advanceTurn` 對離開玩家重置為 `[]`

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/turnFlow.test.js` 找到既有 `advanceTurn clears the outgoing player's summons as a safety net` 測試附近，新增：

```js
test('advanceTurn resets the outgoing player\'s diceInterjectionUsedThisTurn to an empty array', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.diceInterjectionUsedThisTurn = ['item_006'];
  advanceTurn(gameState);
  expect(player.diceInterjectionUsedThisTurn).toEqual([]);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/turnFlow.test.js --forceExit`
Expected: FAIL — `diceInterjectionUsedThisTurn` 仍是 `['item_006']`

- [ ] **Step 3: 實作**

修改 `server/src/game/turnFlow.js` 的 `advanceTurn`：

```js
function advanceTurn(gameState) {
  requireTurnOrder(gameState);
  const outgoingPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const outgoingPlayer = getPlayer(gameState, outgoingPlayerId);
  if (outgoingPlayer) {
    const summon = outgoingPlayer.summons;
    if (summon && summon.carryingItemId) {
      const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
      room.droppedItems.push({ id: summon.carryingItemId });
    }
    outgoingPlayer.summons = null; // safety net -- should already be null before a turn can end
    outgoingPlayer.summonUsedThisTurn = false;
    outgoingPlayer.diceInterjectionUsedThisTurn = [];
  }
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.turnOrder.length;
  const nextPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const nextPlayer = getPlayer(gameState, nextPlayerId);
  resetActionPoints(nextPlayer);
  return nextPlayerId;
}
```

（只新增 `outgoingPlayer.diceInterjectionUsedThisTurn = [];` 這一行，其餘不變）

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat(dice): reset diceInterjectionUsedThisTurn when a player's turn ends"
```

---

## Task 2: `diceInterjection.js` — 純邏輯的道具掃描與骰值計算

**Files:**
- Create: `server/src/game/diceInterjection.js`
- Test: `server/test/game/diceInterjection.test.js`

**Interfaces:**
- Consumes: 無新依賴（純函式，只吃參數，不碰 `gameState`/`content` 目錄本身）
- Produces: `findInterjectionOptions(player, itemCatalog, sourceDeckType)`、`resolveFinalRoll(baseCount, chosenDiceInterjection, overrideValue, rng)`

- [ ] **Step 1: 寫失敗測試**

建立 `server/test/game/diceInterjection.test.js`：

```js
const { findInterjectionOptions, resolveFinalRoll } = require('../../src/game/diceInterjection');

function makeCatalog() {
  return [
    { id: 'item_005', name: '天使羽毛', diceInterjection: { scope: 'any', override: true, consumesItem: true } },
    {
      id: 'item_006',
      name: '詭異人偶',
      diceInterjection: {
        scope: 'any',
        bonusDice: 2,
        cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }],
        consumesItem: false,
      },
    },
    { id: 'item_010', name: '蠟燭', diceInterjection: { scope: 'eventTriggered', bonusDice: 1, consumesItem: false } },
    { id: 'item_003', name: '治療藥膏' }, // 沒有 diceInterjection 的一般道具，對照組
  ];
}

test('findInterjectionOptions returns held items with a matching scope', () => {
  const player = { inventory: [{ id: 'item_005' }, { id: 'item_003' }] };
  const options = findInterjectionOptions(player, makeCatalog(), undefined);
  expect(options).toEqual([
    { itemId: 'item_005', name: '天使羽毛', diceInterjection: makeCatalog()[0].diceInterjection },
  ]);
});

test('findInterjectionOptions excludes eventTriggered items unless sourceDeckType is "event"', () => {
  const player = { inventory: [{ id: 'item_010' }] };
  expect(findInterjectionOptions(player, makeCatalog(), undefined)).toEqual([]);
  expect(findInterjectionOptions(player, makeCatalog(), 'item')).toEqual([]);
  const eventOptions = findInterjectionOptions(player, makeCatalog(), 'event');
  expect(eventOptions).toEqual([{ itemId: 'item_010', name: '蠟燭', diceInterjection: makeCatalog()[2].diceInterjection }]);
});

test('findInterjectionOptions excludes a non-consumable item already used this turn', () => {
  const player = { inventory: [{ id: 'item_006' }], diceInterjectionUsedThisTurn: ['item_006'] };
  expect(findInterjectionOptions(player, makeCatalog(), undefined)).toEqual([]);
});

test('findInterjectionOptions still includes a consumable item even if its id happens to be in diceInterjectionUsedThisTurn', () => {
  // consumesItem items are removed from inventory on use, not tracked via
  // diceInterjectionUsedThisTurn -- this proves the "used this turn" filter
  // only applies to non-consumable items.
  const player = { inventory: [{ id: 'item_005' }], diceInterjectionUsedThisTurn: ['item_005'] };
  expect(findInterjectionOptions(player, makeCatalog(), undefined)).toEqual([
    { itemId: 'item_005', name: '天使羽毛', diceInterjection: makeCatalog()[0].diceInterjection },
  ]);
});

test('findInterjectionOptions ignores held items with no diceInterjection field', () => {
  const player = { inventory: [{ id: 'item_003' }] };
  expect(findInterjectionOptions(player, makeCatalog(), undefined)).toEqual([]);
});

test('findInterjectionOptions throws INVALID_ITEM_CATALOG when itemCatalog is not an array', () => {
  const player = { inventory: [] };
  expect(() => findInterjectionOptions(player, null, undefined)).toThrow('INVALID_ITEM_CATALOG');
});

test('resolveFinalRoll with no chosen interjection rolls baseCount dice, clamped to [1,8]', () => {
  const rng = () => 0.99; // every die -> face 2
  expect(resolveFinalRoll(3, null, undefined, rng)).toBe(6); // 3 dice * 2
  expect(resolveFinalRoll(0, null, undefined, rng)).toBe(2); // clamped up to 1 die
  expect(resolveFinalRoll(10, null, undefined, rng)).toBe(16); // clamped down to 8 dice
});

test('resolveFinalRoll with a bonusDice interjection adds to the dice count before rolling', () => {
  const rng = () => 0.99; // every die -> face 2
  const di = { bonusDice: 2 };
  expect(resolveFinalRoll(3, di, undefined, rng)).toBe(10); // (3+2) dice * 2
});

test('resolveFinalRoll with an override interjection returns the override value directly, ignoring rng', () => {
  const rng = () => { throw new Error('should not be called'); };
  const di = { override: true };
  expect(resolveFinalRoll(3, di, 5, rng)).toBe(5);
});

test('resolveFinalRoll throws INVALID_OVERRIDE_VALUE for an out-of-range or non-integer override value', () => {
  const di = { override: true };
  expect(() => resolveFinalRoll(3, di, 9, () => 0)).toThrow('INVALID_OVERRIDE_VALUE');
  expect(() => resolveFinalRoll(3, di, -1, () => 0)).toThrow('INVALID_OVERRIDE_VALUE');
  expect(() => resolveFinalRoll(3, di, 2.5, () => 0)).toThrow('INVALID_OVERRIDE_VALUE');
  expect(() => resolveFinalRoll(3, di, undefined, () => 0)).toThrow('INVALID_OVERRIDE_VALUE');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/diceInterjection.test.js --forceExit`
Expected: FAIL — 找不到 `server/src/game/diceInterjection.js`

- [ ] **Step 3: 實作**

建立 `server/src/game/diceInterjection.js`：

```js
const { rollDice } = require('./effectPipeline');

function findInterjectionOptions(player, itemCatalog, sourceDeckType) {
  if (!Array.isArray(itemCatalog)) {
    throw new Error('INVALID_ITEM_CATALOG');
  }
  const used = player.diceInterjectionUsedThisTurn || [];
  const options = [];
  for (const invItem of player.inventory || []) {
    const content = itemCatalog.find((c) => c.id === invItem.id);
    if (!content || !content.diceInterjection) continue;
    const di = content.diceInterjection;
    if (di.scope === 'eventTriggered' && sourceDeckType !== 'event') continue;
    if (!di.consumesItem && used.includes(invItem.id)) continue;
    options.push({ itemId: invItem.id, name: content.name, diceInterjection: di });
  }
  return options;
}

function resolveFinalRoll(baseCount, chosenDiceInterjection, overrideValue, rng) {
  if (chosenDiceInterjection && chosenDiceInterjection.override) {
    if (!Number.isInteger(overrideValue) || overrideValue < 0 || overrideValue > 8) {
      throw new Error('INVALID_OVERRIDE_VALUE');
    }
    return overrideValue;
  }
  const boostedCount = baseCount + (chosenDiceInterjection ? (chosenDiceInterjection.bonusDice || 0) : 0);
  const clampedCount = Math.max(1, Math.min(8, boostedCount));
  return rollDice(clampedCount, rng);
}

module.exports = { findInterjectionOptions, resolveFinalRoll };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/diceInterjection.js server/test/game/diceInterjection.test.js
git commit -m "feat(dice): add diceInterjection module (pure scan + roll computation)"
```

---

## Task 3: 卡片內容 — `item_005`/`item_006`/`item_010` 補上 `diceInterjection`

**Files:**
- Modify: `data/cards/item-cards.json`

**Interfaces:**
- Consumes: `diceInterjection` schema（Task 2 定義的形狀）
- Produces: 三張卡的實際內容，`needsCustomLogic` 改 `false`

- [ ] **Step 1: 修改內容**

用 `node -e "console.log(JSON.stringify(require('./data/cards/item-cards.json').filter(i=>['item_005','item_006','item_010'].includes(i.id)), null, 2))"` 先確認這三張卡目前的完整內容（含 `text`/`category`/`canTargetOthers` 等既有欄位），只新增 `diceInterjection` 欄位並把 `needsCustomLogic` 改成 `false`，不要動其他既有欄位。

`item_005`（天使羽毛）新增：
```json
"diceInterjection": { "scope": "any", "override": true, "consumesItem": true }
```

`item_006`（詭異人偶）新增：
```json
"diceInterjection": {
  "scope": "any",
  "bonusDice": 2,
  "cost": [{ "type": "stat_change", "stat": "sanity", "delta": -1 }],
  "consumesItem": false
}
```

`item_010`（蠟燭）新增：
```json
"diceInterjection": { "scope": "eventTriggered", "bonusDice": 1, "consumesItem": false }
```

三張卡都把 `needsCustomLogic` 改為 `false`。`diceInterjection` 欄位放在 `effects` 之後、`category` 之前（維持檔案既有的欄位順序風格）。

- [ ] **Step 2: 驗證**

```bash
node -e "JSON.parse(require('fs').readFileSync('data/cards/item-cards.json','utf8')); console.log('OK')"
node -e "
const items = require('./data/cards/item-cards.json');
for (const id of ['item_005','item_006','item_010']) {
  const c = items.find(i=>i.id===id);
  console.log(id, c.diceInterjection, c.needsCustomLogic);
}
"
```

- [ ] **Step 3: Commit**

```bash
git add data/cards/item-cards.json
git commit -m "feat(cards): wire diceInterjection into item_005/item_006/item_010"
```

---

## Task 4: `effectResolverManager.js` — 新增 `pendingRollChoice` 欄位

**Files:**
- Modify: `server/src/game/effectResolverManager.js`
- Test: `server/test/game/effectResolverManager.test.js`

**Interfaces:**
- Consumes: 無新依賴
- Produces: `startResolver` 建立的房間 entry 現在多一個 `pendingRollChoice: null` 欄位，跟既有 `pendingChoice` 平行

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolverManager.test.js` 找到既有驗證 `startResolver` 回傳形狀的測試附近，新增（若既有測試已經用 `toEqual` 驗證完整形狀，直接在該測試的期望值裡加上 `pendingRollChoice: null`，不要重複新增一個測試）：

```js
test('startResolver initializes pendingRollChoice to null alongside pendingChoice', () => {
  const manager = createEffectResolverManager();
  const entry = startResolver(manager, 'ROOM1');
  expect(entry.pendingRollChoice).toBeNull();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolverManager.test.js --forceExit`
Expected: FAIL — `entry.pendingRollChoice` 是 `undefined`

- [ ] **Step 3: 實作**

修改 `server/src/game/effectResolverManager.js` 的 `startResolver`：

```js
function startResolver(manager, roomCode) {
  if (manager.resolvers.has(roomCode)) {
    throw new Error('RESOLVER_ALREADY_STARTED');
  }
  const entry = { promptState: createPromptState(), pendingChoice: null, pendingRollChoice: null };
  manager.resolvers.set(roomCode, entry);
  return entry;
}
```

（只在既有的 entry 物件字面量加上 `pendingRollChoice: null`）

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/effectResolverManager.js server/test/game/effectResolverManager.test.js
git commit -m "feat(dice): add pendingRollChoice slot to effectResolverManager room entries"
```

---

## Task 5: `handleDiceCheck` 兩階段邏輯

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: `findInterjectionOptions`/`resolveFinalRoll`（Task 2），`context.itemCatalog`/`context.sourceDeckType`/`context.interjectionChoice`（呼叫端準備，Task 6 才會真的接上）
- Produces: `handleDiceCheck` 沒有可用道具時行為完全不變；有可用道具且 `context.interjectionChoice` 尚未決定時回傳新的 `{pending:true, rollChoice:true, baseCount, options, effect}`；`context.interjectionChoice` 已決定時（`null`＝不使用道具，或選中的道具物件）套用代價/加骰/覆蓋值後接續原本邏輯

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolver.test.js` 找到既有 `dice_check` 相關測試附近（`resolveEffects dice_check with...`），新增：

```js
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
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  const rng = jest.fn().mockReturnValue(0.0); // every die -> face 0 for the inner check
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
  ], { rng, interjectionChoice: null, itemCatalog: [] }); // itemCatalog: [] proves the inner check re-scanned (found nothing) rather than skipping
  expect(result.pending).toBe(false);
  expect(player.stats.knowledge.currentIndex).toBe(player.stats.knowledge.baseIndex + 1);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js --forceExit`
Expected: FAIL — `handleDiceCheck` 目前不認得 `context.itemCatalog`/`context.interjectionChoice`，會直接照舊擲骰，`rollChoice`/`baseCount`/`effect` 都不存在於回傳值

- [ ] **Step 3: 實作**

在 `server/src/game/effectResolver.js` 頂部新增 import：

```js
const { findInterjectionOptions, resolveFinalRoll } = require('./diceInterjection');
```

修改 `handleDiceCheck`：

原本：
```js
function handleDiceCheck(gameState, promptState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];

  const baseCount = effect.stat !== undefined ? getStatValue(player, effect.stat) : effect.diceCount;
  if (!Number.isInteger(baseCount) || baseCount < 0) {
    throw new Error('INVALID_DICE_CHECK_COUNT');
  }

  const adjustedCount = Math.max(1, Math.min(8, applyModifiers(baseCount, modifiers, 'onBeforeRoll', context)));
  const rolled = rollDice(adjustedCount, context.rng);
  const finalSum = applyModifiers(rolled, modifiers, 'onAfterRoll', context);
  const tier = evaluateTiers(finalSum, effect.tiers);
  return resolveEffects(gameState, promptState, playerId, tier.effects, context);
}
```

改為：

```js
function computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice, context) {
  if (!interjectionChoice) {
    const adjustedCount = Math.max(1, Math.min(8, applyModifiers(baseCount, modifiers, 'onBeforeRoll', context)));
    const rolled = rollDice(adjustedCount, context.rng);
    return applyModifiers(rolled, modifiers, 'onAfterRoll', context);
  }
  const player = requirePlayer(gameState, playerId);
  const { itemId, diceInterjection, overrideValue } = interjectionChoice;
  if (Array.isArray(diceInterjection.cost) && diceInterjection.cost.length > 0) {
    resolveEffects(gameState, promptState, playerId, diceInterjection.cost, context);
  }
  if (diceInterjection.consumesItem) {
    removeItem(player, itemId);
  } else {
    player.diceInterjectionUsedThisTurn = [...(player.diceInterjectionUsedThisTurn || []), itemId];
  }
  if (diceInterjection.override) {
    return resolveFinalRoll(baseCount, diceInterjection, overrideValue, context.rng);
  }
  const boostedCount = baseCount + (diceInterjection.bonusDice || 0);
  const adjustedCount = Math.max(1, Math.min(8, applyModifiers(boostedCount, modifiers, 'onBeforeRoll', context)));
  const rolled = rollDice(adjustedCount, context.rng);
  return applyModifiers(rolled, modifiers, 'onAfterRoll', context);
}

function handleDiceCheck(gameState, promptState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];

  const baseCount = effect.stat !== undefined ? getStatValue(player, effect.stat) : effect.diceCount;
  if (!Number.isInteger(baseCount) || baseCount < 0) {
    throw new Error('INVALID_DICE_CHECK_COUNT');
  }

  if (context.interjectionChoice === undefined) {
    const itemCatalog = context.itemCatalog || [];
    const options = findInterjectionOptions(player, itemCatalog, context.sourceDeckType);
    if (options.length > 0) {
      return { pending: true, rollChoice: true, baseCount, options, effect };
    }
  }
  const finalSum = computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, context.interjectionChoice || null, context);
  // Strip interjectionChoice before recursing into the matched tier's own
  // effects -- it belongs only to *this* dice_check, not to any dice_check
  // nested inside the tier's effects (which needs its own fresh scan).
  const { interjectionChoice, ...restContext } = context;
  const tier = evaluateTiers(finalSum, effect.tiers);
  return resolveEffects(gameState, promptState, playerId, tier.effects, restContext);
}
```

更新 `HANDLERS` 裡 `dice_check` 那一行不用改（呼叫方式沒變，還是 `(gameState, promptState, playerId, effect, context) => handleDiceCheck(...)`）。

**注意 `resolveFinalRoll` 在這裡的用途**：`computeInterjectedRoll` 對「加骰」跟「一般擲骰（沒選道具）」兩種情況維持原本手寫的 `applyModifiers`+`rollDice` 流程（因為 modifier 的 onBeforeRoll/onAfterRoll 要套用），只有 `override` 分支才呼叫 `resolveFinalRoll`（純粹取用它的輸入驗證，`override` 情境本來就不套用 modifier、不擲骰）。`resolveFinalRoll` 這個純函式主要給 Task 2 自己的單元測試驗證邏輯用，也給未來 Part B（`leaveCheck` 沒有 modifier 系統可套用）直接呼叫。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS，全部既有測試也要綠燈（尤其是既有的 `dice_check` 測試，因為它們呼叫 `resolveEffects` 時的 `context` 沒有 `itemCatalog`，`context.itemCatalog || []` 會得到空陣列，`findInterjectionOptions` 對空陣列必然回傳 `[]`，維持舊行為）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat(dice): add two-phase interjection support to handleDiceCheck"
```

---

## Task 6: `socketHandlers.js` — 把 `itemCatalog`/`sourceDeckType` 接上既有的 5 個 `resolveEffects` 呼叫點

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 5 的 `context.itemCatalog`/`context.sourceDeckType` 支援
- Produces: `resolveCardDraw`、`game:selectAction` 的道具/操作路徑、`applyRoomEndTurnBonus`、`game:effectPromptRespond`、`handleEffectChoiceTimeout` 這 5 個現有的 `resolveEffects` 呼叫點都會傳入 `itemCatalog: content.cards.items`（`resolveCardDraw` 額外傳 `sourceDeckType: deckType`）

**這個任務只負責把 `content`/`itemCatalog` 接到既有 5 個呼叫點，不處理 `rollChoice` pending 的後續（那是 Task 7）——這個任務完成後，遊戲裡任何 `dice_check` 若偵測到可用道具，會回傳 `pending:true, rollChoice:true`，但 `socketHandlers.js` 目前還不認得這個新形狀，會被既有的 `handleEffectResolveResult` 當成一般的 `choice` pending 誤處理。這是預期中的中繼狀態，Task 7 會修正，不要在這個任務裡跳著先做 Task 7 的事。**

- [ ] **Step 1: 寫失敗測試**

在 `server/test/socketHandlers.test.js` 找一個既有 `game:selectAction item:` 測試附近，新增：

```js
test('game:selectAction item: a dice_check effect can see the player\'s itemCatalog-eligible held items via context (regression guard for context threading)', async () => {
  // This test doesn't assert the full rollChoice flow (Task 7's job) -- it
  // only proves item-catalog data actually reaches handleDiceCheck through
  // game:selectAction's resolveEffects call, by observing that holding a
  // matching item changes the dice_check from "resolves immediately" to
  // "does not resolve immediately" (still pending after the ack).
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        {
          id: 'item_003',
          name: '測試道具',
          effects: [{
            type: 'dice_check',
            diceCount: 2,
            tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
          }],
          category: 'general',
        },
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [], consumesItem: false },
        },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const noEffectResolvedTimer = new Promise((resolve) => setTimeout(() => resolve('timeout'), 300));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const outcome = await Promise.race([effectResolvedPromise, noEffectResolvedTimer]);
  // Holding item_006 (a matching diceInterjection item) means the dice_check
  // must NOT have resolved immediately -- if context.itemCatalog wasn't
  // threaded through, it would have rolled right away and emitted effectResolved.
  expect(outcome).toBe('timeout');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "context threading" --forceExit`
Expected: FAIL — `game:selectAction` 目前呼叫 `resolveEffects` 沒帶 `itemCatalog`，`dice_check` 找不到任何介入選項，立刻擲骰解析完，`game:effectResolved` 會在 300ms 內收到，`outcome` 不會是 `'timeout'`

- [ ] **Step 3: 實作**

修改 `server/src/socketHandlers.js` 的 5 個 `resolveEffects` 呼叫點，全部多帶 `itemCatalog: content.cards.items`：

**`resolveCardDraw`**（頂層函式，簽章新增 `content` 參數，放在 `effectChoiceTimeouts` 之後）：

原本：
```js
function resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, deckType, effectChoiceTimeouts) {
  ...
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, { now: Date.now() });
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, card.id, effectResult, effectChoiceTimeouts);
}
```

改為：
```js
function resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, deckType, effectChoiceTimeouts, content) {
  ...
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, {
    now: Date.now(),
    itemCatalog: content.cards.items,
    sourceDeckType: deckType,
  });
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, card.id, effectResult, effectChoiceTimeouts, false, content);
}
```

（`handleEffectResolveResult` 呼叫也要補上 `, false, content` 兩個參數——`false` 對應既有的 `consumeItemIfApplied` 位置參數，`resolveCardDraw` 一直以來就沒有傳這個參數、靠預設值 `false`，這裡補上是因為後面要再多帶一個 `content` 參數，前面的位置參數不能省略。這是本節唯一容易漏掉的地方：`resolveCardDraw` 也是下面「呼叫 `handleEffectResolveResult` 的地方要補 `content`」清單裡的一員，不是只有 `game:selectAction`/`applyRoomEndTurnBonus`/`game:effectPromptRespond` 這 3 個。）

（函式其餘部分——`activatedOnUse` 提早 return 之前的所有內容——完全不變，只改 `context` 物件跟簽章多一個參數）

**`resolveCardDraw` 的兩個呼叫點**（都在 `registerSocketHandlers` 內，有 `content` closure，直接補上最後一個參數）：
- `game:move` handler 裡：`resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck, effectChoiceTimeouts)` → 加上 `, content`
- （`resolveCardDraw` 只有這一個呼叫點，在 `game:move` handler 裡）

**`game:selectAction` 的道具/操作路徑**（在 `registerSocketHandlers` 內，直接改 context 物件）：

原本：
```js
const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now() });
```

改為：
```js
const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now(), itemCatalog: content.cards.items });
```

**`applyRoomEndTurnBonus`**（頂層函式，簽章新增 `content` 參數，放在 `effectChoiceTimeouts` 之後）：

原本：
```js
function applyRoomEndTurnBonus(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition, effectChoiceTimeouts) {
  ...
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, bonusEffects, { now: Date.now() });
  handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition.id, effectResult, effectChoiceTimeouts, false);
  player.roomBonusesReceived = [...received, roomDefinition.id];
}
```

改為：
```js
function applyRoomEndTurnBonus(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition, effectChoiceTimeouts, content) {
  ...
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, bonusEffects, { now: Date.now(), itemCatalog: content.cards.items });
  handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition.id, effectResult, effectChoiceTimeouts, false);
  player.roomBonusesReceived = [...received, roomDefinition.id];
}
```

**`applyRoomEndTurnBonus` 的呼叫點**（在 `game:endTurn` handler 裡，有 `content` closure）：
`applyRoomEndTurnBonus(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition, effectChoiceTimeouts)` → 加上 `, content`

**`game:effectPromptRespond`**（在 `registerSocketHandlers` 內，直接改 context 物件）：

原本：
```js
const nextResult = resolveEffects(gameState, resolverEntry.promptState, choicePlayerId, chosenEffects, { now: Date.now() });
```

改為：
```js
const nextResult = resolveEffects(gameState, resolverEntry.promptState, choicePlayerId, chosenEffects, { now: Date.now(), itemCatalog: content.cards.items });
```

**`handleEffectChoiceTimeout`**（頂層函式，簽章新增 `content` 參數，放在 `effectChoiceTimeouts` 之後）：

原本：
```js
function handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, promptId, effectChoiceTimeouts) {
  try {
    ...
    const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, chosenEffects, { now: Date.now() });
    ...
  } catch (err) {
    console.error('effect choice timeout error', err);
  }
}
```

改為：
```js
function handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, promptId, effectChoiceTimeouts, content) {
  try {
    ...
    const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, chosenEffects, { now: Date.now(), itemCatalog: content.cards.items });
    ...
  } catch (err) {
    console.error('effect choice timeout error', err);
  }
}
```

**`handleEffectChoiceTimeout` 的呼叫點**（在 `handleEffectResolveResult`「頂層函式」裡的 `setTimeout` callback）：

`handleEffectResolveResult` 本身也要新增 `content` 參數（放在 `consumeItemIfApplied` 之後）才能往下傳給 `handleEffectChoiceTimeout`：

原本：
```js
function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied = false) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending) {
    resolverEntry.pendingChoice = { ... };
    io.to(roomCode).emit('game:effectPendingChoice', { ... });
    const delayMs = Math.max(effectResult.deadline - Date.now(), 0);
    const handle = setTimeout(() => {
      handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, effectResult.promptId, effectChoiceTimeouts);
    }, delayMs);
    effectChoiceTimeouts.set(roomCode, handle);
    return { pending: true };
  }
  ...
}
```

改為（只改函式簽章跟 `setTimeout` 內的呼叫，中間的 pendingChoice 建立邏輯不變）：
```js
function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied = false, content = null) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending) {
    resolverEntry.pendingChoice = { ... }; // 不變
    io.to(roomCode).emit('game:effectPendingChoice', { ... }); // 不變
    const delayMs = Math.max(effectResult.deadline - Date.now(), 0);
    const handle = setTimeout(() => {
      handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, effectResult.promptId, effectChoiceTimeouts, content);
    }, delayMs);
    effectChoiceTimeouts.set(roomCode, handle);
    return { pending: true };
  }
  ...
}
```

**`handleEffectResolveResult` 的所有呼叫點**（5 個，各自最後補上 `, content`；`resolveCardDraw` 內的那次已經在上面補過了，這裡是其餘 4 個）：
- `resolveCardDraw` 內的呼叫（已在上面補過，這裡列出只是完整性提醒，不要重複改）
- `game:selectAction` handler 裡的呼叫（在 `registerSocketHandlers` 內，有 `content` closure，直接補上）
- `applyRoomEndTurnBonus` 內的呼叫（因為 `applyRoomEndTurnBonus` 這時已經有 `content` 參數了，直接補上）
- `game:effectPromptRespond` handler 裡的呼叫（在 `registerSocketHandlers` 內，有 `content` closure，直接補上）
- （`handleEffectChoiceTimeout` 內部也會呼叫一次 `handleEffectResolveResult`，同樣補上 `content`——見下方）

`handleEffectChoiceTimeout` 內部呼叫 `handleEffectResolveResult` 那一行也要補上 `content`：
原本：`const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied);`
改為：`const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied, content);`

**注意**：`consumeItemIfApplied` 目前在 `handleEffectResolveResult` 簽章裡有預設值 `= false`，`content` 這個新參數也給預設值 `= null`（純粹是防呆，正常呼叫都會確實傳入，不應該真的用到這個預設值——如果 `content` 是 `null` 又剛好觸發 `handleEffectChoiceTimeout`，`content.cards.items` 會拋錯，這是故意的，比靜默吞掉資料遺失更好，符合專案「不可靜默失敗」的慣例）。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS，全部既有測試也要綠燈（沒有可用道具的既有測試場景，`itemCatalog` 有值但找不到任何符合的道具，`findInterjectionOptions` 回傳空陣列，行為不變）

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(dice): thread itemCatalog/sourceDeckType through existing resolveEffects call sites"
```

---

## Task 7: `socketHandlers.js` — `pendingRollChoice` 完整串接（詢問視窗、恢復、逾時、防呆）

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 5 的 `rollChoice` pending 結果形狀、Task 6 的 `content` 參數線路
- Produces: 新的 `game:diceChoiceRespond` socket 事件；`game:move`/`game:selectAction`/`game:endTurn`/`game:useStairs` 在 `pendingRollChoice` 存在時一律拒絕 `ROLL_CHOICE_IN_PROGRESS`；新的 `game:diceChoicePending`/`game:diceChoiceResolved` 廣播事件

- [ ] **Step 1: 寫失敗測試**

在 `server/test/socketHandlers.test.js` 檔案最後新增：

```js
function makeDiceInterjectionContent(overrides = {}) {
  return makeContent({
    cards: {
      events: [], omens: [],
      items: [
        {
          id: 'item_003',
          name: '測試道具',
          effects: [{
            type: 'dice_check',
            diceCount: 2,
            tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
          }],
          category: 'general',
        },
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }], consumesItem: false },
        },
      ],
    },
    ...overrides,
  });
}

test('game:selectAction item: a dice_check with an eligible held item broadcasts game:diceChoicePending instead of resolving immediately', async () => {
  const content = makeDiceInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const pending = await pendingPromise;
  expect(pending.playerId).toBe(currentPlayerId);
  expect(pending.options).toEqual([{ itemId: 'item_006', name: '詭異人偶', diceInterjection: content.cards.items.find((i) => i.id === 'item_006').diceInterjection }]);
  expect(typeof pending.promptId).toBe('string');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond with an item optionId applies its cost/bonus and resolves the original dice_check', async () => {
  const content = makeDiceInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const pending = await pendingPromise;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_006' }, resolve)
  );
  expect(respondResult.error).toBeUndefined();
  await effectResolvedPromise;

  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex - 1); // cost applied
  expect(player.diceInterjectionUsedThisTurn).toEqual(['item_006']);
  expect(player.inventory).toEqual([{ id: 'item_003' }, { id: 'item_006' }]); // non-consumable, still held

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond with optionId:"__skip__" resolves the dice_check with no bonus', async () => {
  const content = makeDiceInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const pending = await pendingPromise;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: '__skip__' }, resolve));
  await effectResolvedPromise;

  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex); // no cost -- item never used
  expect(player.diceInterjectionUsedThisTurn || []).toEqual([]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond rejects an optionId that isn\'t one of the offered options', async () => {
  const content = makeDiceInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const pending = await pendingPromise;

  const result = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'not_a_real_item' }, resolve)
  );
  expect(result.error).toBe('INVALID_PROMPT_OPTION');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:diceChoiceRespond rejects when there is no active roll choice', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();
  const result = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: 'not_real', optionId: '__skip__' }, resolve)
  );
  expect(result.error).toBe('NO_ACTIVE_ROLL_CHOICE');
  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a pending roll choice blocks game:move/game:selectAction/game:endTurn/game:useStairs with ROLL_CHOICE_IN_PROGRESS', async () => {
  const content = makeDiceInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  await pendingPromise;

  const moveResult = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(moveResult.error).toBe('ROLL_CHOICE_IN_PROGRESS');
  const selectActionResult = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'attack' }, resolve));
  expect(selectActionResult.error).toBe('ROLL_CHOICE_IN_PROGRESS');
  const endTurnResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endTurnResult.error).toBe('ROLL_CHOICE_IN_PROGRESS');
  const useStairsResult = await new Promise((resolve) => currentClient.emit('game:useStairs', {}, resolve));
  expect(useStairsResult.error).toBe('ROLL_CHOICE_IN_PROGRESS');

  clientA.close();
  clientB.close();
  httpServer.close();
}, 3000);

test('a roll choice that times out resolves with no item used (default skip)', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        {
          id: 'item_003',
          name: '測試道具',
          effects: [{
            type: 'dice_check',
            diceCount: 2,
            tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
          }],
          category: 'general',
        },
        {
          id: 'item_006',
          name: '詭異人偶',
          diceInterjection: { scope: 'any', bonusDice: 2, cost: [{ type: 'stat_change', stat: 'sanity', delta: -1 }], consumesItem: false },
        },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content, { rollChoiceTimeoutMs: 50 });
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_003' }, { id: 'item_006' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  await pendingPromise;

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await resolvedPromise;
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex); // timed out -- no item used, no cost

  clientA.close();
  clientB.close();
  httpServer.close();
}, 2000);
```

**這個測試需要 `setUpStartedGameWithContent` 支援一個新的 `rollChoiceTimeoutMs` 選項**（比照既有 `characterSelectTimeoutMs` 選項的傳遞方式，往 `registerSocketHandlers(io, ..., content, options)` 的 `options` 帶入）——確認 `setUpStartedGameWithContent`/`startTestServer` 目前怎麼把 `options` 往下傳，照同樣的方式加這個新選項（如果目前的測試輔助函式簽章不支援自訂 `options`，比照 `characterSelectTimeoutMs` 現有的傳遞路徑新增，不要另外發明一套）。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js --forceExit`
Expected: FAIL — `game:diceChoicePending`/`game:diceChoiceRespond` 都還不存在，`ROLL_CHOICE_IN_PROGRESS` 防呆也還沒接上

- [ ] **Step 3: 實作**

修改 `server/src/socketHandlers.js`：

不需要新增任何 `diceInterjection.js` 的 import——掃描邏輯已經在 Task 5 包進 `handleDiceCheck` 裡了，`socketHandlers.js` 不需要直接呼叫 `findInterjectionOptions`。

**`registerSocketHandlers` 函式頂部**，在既有 `const effectChoiceTimeouts = new Map();` 之後新增：
```js
const rollChoiceTimeouts = new Map(); // roomCode -> Timeout handle
const rollChoiceTimeoutMs = options.rollChoiceTimeoutMs || 20000;
```

**`hasPendingEffectChoice` 之後新增一個新函式**：
```js
function hasPendingRollChoice(effectResolverManager, roomCode) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  return Boolean(resolverEntry && resolverEntry.pendingRollChoice);
}
```

**在 `game:move`、`game:selectAction`、`game:endTurn`、`game:useStairs` 這 4 個 handler 裡，緊接在既有的 `hasPendingEffectChoice` 檢查之後，各自加上**：
```js
        if (hasPendingRollChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
```

**修改 `handleEffectResolveResult`**，在 `effectResult.pending` 分支最前面插入 `rollChoice` 判斷（`content` 參數是 Task 6 已經加好的）：

原本（Task 6 執行完的狀態）：
```js
function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied = false, content = null) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending) {
    resolverEntry.pendingChoice = { ... };
    ...
    return { pending: true };
  }
  ...
}
```

改為（`handleEffectResolveResult` 需要多接 `rollChoiceTimeouts`，簽章放在 `content` 之後）：
```js
function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied = false, content = null, rollChoiceTimeouts = null, rollChoiceTimeoutMs = 20000) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending && effectResult.rollChoice) {
    return handleRollChoicePending(io, effectResolverManager, roomCode, playerId, sourceId, effectResult, consumeItemIfApplied, rollChoiceTimeouts, rollChoiceTimeoutMs, effectChoiceTimeouts, content);
  }
  if (effectResult.pending) {
    resolverEntry.pendingChoice = { ... }; // 不變
    ...
    return { pending: true };
  }
  ...
}
```

**`handleEffectResolveResult` 的所有呼叫點**（Task 6 已經補過 `content` 的那 5 處）都再補上 `, rollChoiceTimeouts, rollChoiceTimeoutMs`（在 `registerSocketHandlers` 內的呼叫點有 closure 可直接取用；`handleEffectChoiceTimeout` 內部的呼叫也要往下傳，所以 `handleEffectChoiceTimeout` 自己的簽章也要多接這兩個參數，從它自己的呼叫點——`handleEffectResolveResult`（Task 6 已經在傳 `content` 了）——一併補上）。

**新增 `handleRollChoicePending`**（放在 `handleEffectResolveResult`之前或之後皆可，這裡放在它後面）：
```js
function handleRollChoicePending(io, effectResolverManager, roomCode, playerId, sourceId, effectResult, consumeItemIfApplied, rollChoiceTimeouts, rollChoiceTimeoutMs, effectChoiceTimeouts, content) {
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
  resolverEntry.pendingRollChoice = {
    playerId,
    promptId: prompt.promptId,
    deadline: prompt.deadline,
    options: effectResult.options,
    resumeKind: 'diceCheck',
    resumeContext: { effect: effectResult.effect, sourceId, consumeItemIfApplied },
  };
  io.to(roomCode).emit('game:diceChoicePending', {
    playerId,
    promptId: prompt.promptId,
    options: effectResult.options,
    deadline: prompt.deadline,
  });
  const delayMs = Math.max(prompt.deadline - Date.now(), 0);
  const handle = setTimeout(() => {
    handleRollChoiceTimeout(io, effectResolverManager, roomCode, prompt.promptId, rollChoiceTimeouts, effectChoiceTimeouts, content, rollChoiceTimeoutMs);
  }, delayMs);
  rollChoiceTimeouts.set(roomCode, handle);
  return { pending: true };
}
```

**新增共用的恢復函式 `resumeRollChoice`**：
```js
function resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, resumeKind, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
  if (resumeKind !== 'diceCheck') {
    throw new Error('UNSUPPORTED_ROLL_CHOICE_RESUME_KIND');
  }
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const { effect, sourceId, consumeItemIfApplied } = resumeContext;
  const context = { now: Date.now(), interjectionChoice, itemCatalog: content.cards.items };
  const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, [effect], context);
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
}
```

**新增 `clearRollChoiceTimeout`**（比照既有 `clearEffectChoiceTimeout`）：
```js
function clearRollChoiceTimeout(roomCode, rollChoiceTimeouts) {
  const handle = rollChoiceTimeouts.get(roomCode);
  if (handle) {
    clearTimeout(handle);
    rollChoiceTimeouts.delete(roomCode);
  }
}
```

**新增 `handleRollChoiceTimeout`**（比照既有 `handleEffectChoiceTimeout` 的做法，直接從呼叫端接收 `gameState` 參數，不自己重新查）：
```js
function handleRollChoiceTimeout(io, effectResolverManager, gameState, roomCode, promptId, rollChoiceTimeouts, effectChoiceTimeouts, content, rollChoiceTimeoutMs) {
  try {
    const resolverEntry = getResolver(effectResolverManager, roomCode);
    if (!resolverEntry || !resolverEntry.pendingRollChoice) return;
    rollChoiceTimeouts.delete(roomCode);
    const { playerId, resumeKind, resumeContext } = resolverEntry.pendingRollChoice;
    const result = resolvePromptTimeout(resolverEntry.promptState, { promptId, defaultOptionId: '__skip__' });
    if (!result) return;
    resolverEntry.pendingRollChoice = null;
    io.to(roomCode).emit('game:promptResolved', result);
    resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, resumeKind, resumeContext, null, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('roll choice timeout error', err);
  }
}
```

（同步修正 `handleRollChoicePending` 裡 `setTimeout` 的呼叫，補上 `gameState` 參數：`handleRollChoiceTimeout(io, effectResolverManager, gameState, roomCode, prompt.promptId, rollChoiceTimeouts, effectChoiceTimeouts, content, rollChoiceTimeoutMs)`——`handleRollChoicePending` 自己的簽章也要多接 `gameState`，從它的呼叫點（`handleEffectResolveResult`）往下傳，`handleEffectResolveResult` 本身已經有 `gameState` 參數，直接補上即可）

**新增 `game:diceChoiceRespond` socket 事件**（放在既有 `game:effectPromptRespond` 之後）：
```js
    socket.on('game:diceChoiceRespond', (payload, callback) => {
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
        if (!resolverEntry || !resolverEntry.pendingRollChoice) {
          return ack({ error: 'NO_ACTIVE_ROLL_CHOICE' });
        }
        const { promptId, optionId, overrideValue } = payload || {};
        const { playerId: choicePlayerId, options, resumeKind, resumeContext } = resolverEntry.pendingRollChoice;
        const result = respondToPrompt(resolverEntry.promptState, { promptId, playerId, optionId });
        clearRollChoiceTimeout(roomCode, rollChoiceTimeouts);
        resolverEntry.pendingRollChoice = null;
        io.to(roomCode).emit('game:promptResolved', result);

        const chosenOption = optionId === '__skip__' ? null : options.find((o) => o.itemId === optionId);
        const interjectionChoice = chosenOption
          ? { itemId: chosenOption.itemId, diceInterjection: chosenOption.diceInterjection, overrideValue }
          : null;

        const outcome = resumeRollChoice(io, effectResolverManager, gameState, roomCode, choicePlayerId, resumeKind, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
        if (outcome.drawnCards) {
          socket.emit('game:cardsDrawn', { cards: outcome.drawnCards });
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
        ack({});
      } catch (err) {
        console.error('game:diceChoiceRespond error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

**注意**：`respondToPrompt` 對不在 `options` 清單裡的 `optionId` 會拋 `INVALID_PROMPT_OPTION`（`promptState.js` 既有邏輯，不用另外處理）——這就是 Step 1 測試裡「拒絕不在選項清單裡的 optionId」那個案例會通過的原因，不需要額外的手動驗證。

**修改 `handleEffectChoiceTimeout` 的呼叫**（Task 6 已經讓它接收 `content` 參數；這個任務要讓它的內部呼叫 `handleEffectResolveResult` 時，一併補上 `rollChoiceTimeouts`/`rollChoiceTimeoutMs`）：

`handleEffectChoiceTimeout` 簽章這個任務要再擴充（在 Task 6 的 `content` 之後）：
```js
function handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, promptId, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs) {
  try {
    ...
    const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('effect choice timeout error', err);
  }
}
```

它自己的呼叫點（`handleEffectResolveResult` 內的 `setTimeout`）也要補上這兩個新參數：
```js
    const handle = setTimeout(() => {
      handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, effectResult.promptId, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs);
    }, delayMs);
```

**最後，`registerSocketHandlers` 內所有原本呼叫 `handleEffectResolveResult` 的地方**（`game:selectAction`、`applyRoomEndTurnBonus`、`game:effectPromptRespond`，共 3 處，都在 closure 內可直接取用 `rollChoiceTimeouts`/`rollChoiceTimeoutMs`），補齊最後兩個參數。`applyRoomEndTurnBonus` 本身的簽章也要多接這兩個參數，從 `game:endTurn` handler 呼叫它的地方一併補上。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS，全部既有測試也要綠燈

- [ ] **Step 5: 執行兩次確認穩定**

Run: `cd server && npx jest --forceExit` 再跑一次
Expected: 兩次結果一致，這個功能引入了新的計時器/逾時路徑，比照這個分支之前建立的先例（`summon-control-and-item-drop` 的 Task 5），多跑一次確認沒有新的競態

- [ ] **Step 6: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(dice): wire pendingRollChoice end-to-end (prompt, respond, timeout, guards)"
```

---

## 範圍外事項（Part B，另一份計畫）

- `leaveCheck` 路徑（`turnFlow.js`/`game:move`）的道具介入尚未串接——`moveToRoom` 目前擲骰時完全繞過本計畫新增的機制，`leaveCheck` 房間（塔橋/雜亂的房間/藤蔓糾纏的溫室）暫時還不能用天使羽毛/詭異人偶介入
- 前端 UI（跳出詢問視窗、選擇道具的畫面）延後到 M2d，這次只做後端機制
