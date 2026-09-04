# 階段倒數計時機制與伺服器基礎建設 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每個回合階段都有一個可設定秒數的倒數計時（預設30秒），逾時自動鎖定尚未鎖定的玩家/NPC；拿掉舊制殘留的3套「個別選擇逾時」系統（擲骰介入/道具選擇/效果選擇，角色選擇不動），把它們共用的「一房一格」待定選擇資料結構改成分玩家，讓一位玩家的待定選擇不會擋住整個房間。

**Architecture:** `gameState.phaseTimeoutMs`（不寫死，由 `createGameState` 帶入）驅動 `phaseFlow.js` 的 `phaseDeadline`；`promptState.js` 的容器從單一物件改成 `Map<playerId, prompt>`；`socketHandlers.js` 新增一個共用的階段逾時處理函式，逾時時對每位還沒鎖定的參與者依其待定選擇類型套用「已確認的預設行為」後強制鎖定；前端新增一個可拖曳、位置記憶在 `localStorage` 的倒數彈窗元件。

**Tech Stack:** Node.js／Express／Socket.IO（後端），React（前端），Jest（測試）。

## Global Constraints

- 設計文件：[2026-09-04-phase-countdown-design.md](../specs/2026-09-04-phase-countdown-design.md)
- 階段倒數秒數不寫死：`gameState.phaseTimeoutMs`，預設 `30000`，由 `createGameState` 的參數帶入，為之後「房主可調整秒數」功能預留接入點（該功能本身不在這次範圍）
- 角色選擇逾時（`characterSelectTimeoutMs`/`characterSelectTimeouts`）維持完全不動，不受這次任何改動影響
- 三種選擇類型的逾時預設行為（已與開發者確認，不可自行調整）：
  - **擲骰介入**：視同「不使用道具」，被介入的原動作正常繼續（照樣扣原動作行動力，通過/失敗照舊判定），介入本身不額外扣行動力
  - **道具選擇**：搜索/拾取本身視為完成（行動力已扣），套用既有的 `pickInventoryChoiceDefault` 邏輯丟棄最新拾取、超過上限的那件道具
  - **效果選擇**：卡片資料新增 `onTimeout` 欄位（`'skip'` 預設或 `'random'`），`'skip'` 時什麼都不發生，`'random'` 時從 `options` 隨機選一項套用（目前只有 `event_031` 標記 `'random'`）
- 待定選擇資料結構改成以 `playerId` 為 key 的 `Map`，不再是單一物件——這是這次範圍最大的一塊改動，牽涉 `promptState.js`／`effectResolverManager.js`／`socketHandlers.js`
- 前端倒數彈窗座標存 `localStorage`（本機裝置各自記憶，不跟伺服器同步）——這是本專案第一次使用 `localStorage`，`client/src` 目前完全沒有既有的 `localStorage` 讀寫模式可以參考，需要自己建立最小可用的讀寫封裝

---

### Task 1: `phaseTimeoutMs` 不寫死 ＋ `phaseFlow.js` 設定 `phaseDeadline`

**Files:**
- Modify: `server/src/game/gameState.js`
- Modify: `server/src/game/gameManager.js`
- Modify: `server/src/game/phaseFlow.js`
- Test: `server/test/game/gameState.test.js`
- Test: `server/test/game/phaseFlow.test.js`

**Interfaces:**
- Consumes: 無
- Produces: `createGameState(startingRooms, rooms, cards, options)`（新增第4個參數，`options.phaseTimeoutMs` 預設 `30000`）→ `gameState.phaseTimeoutMs` 欄位；`enterPhase(gameState, phase)` 設定 `gameState.phaseDeadline = Date.now() + gameState.phaseTimeoutMs`，供後續任務讀取。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/gameState.test.js`，找到現有 `createGameState` 測試附近，新增：

```javascript
test('createGameState defaults phaseTimeoutMs to 30000 when not specified', () => {
  const gameState = createGameState([], [], {});
  expect(gameState.phaseTimeoutMs).toBe(30000);
});

test('createGameState accepts a custom phaseTimeoutMs via options', () => {
  const gameState = createGameState([], [], {}, { phaseTimeoutMs: 5000 });
  expect(gameState.phaseTimeoutMs).toBe(5000);
});
```

（若 `server/test/game/gameState.test.js` 目前沒有可以用 `createGameState([], [], {})` 這種最簡參數呼叫的既有測試可以參考，改用檔案裡既有測試使用的 `startingRooms`/`rooms` fixture，只要保證新增的兩個測試能獨立通過即可，不用跟其他測試共用 fixture。）

在 `server/test/game/phaseFlow.test.js`，找到 `enterPhase` 相關測試附近，新增：

```javascript
test('enterPhase sets phaseDeadline to now + gameState.phaseTimeoutMs', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.phaseTimeoutMs = 12345;
  const before = Date.now();
  enterPhase(gameState, 'player_move');
  expect(gameState.phaseDeadline).toBeGreaterThanOrEqual(before + 12345);
  expect(gameState.phaseDeadline).toBeLessThanOrEqual(Date.now() + 12345);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/gameState.test.js test/game/phaseFlow.test.js -v`
Expected: 上面3個新測試 FAIL（`phaseTimeoutMs`/`phaseDeadline` 都是 `undefined`）

- [ ] **Step 3: 實作**

`server/src/game/gameState.js` 的 `createGameState` 函式簽名與內容：

```javascript
function createGameState(startingRooms, rooms, cards = {}, options = {}) {
  return {
    board: createBoard(startingRooms),
    players: new Map(),
    hauntStarted: false,
    omenCount: 0,
    roomDeck: createRoomDeck(rooms),
    eventDeck: createCardDeck(cards.events || []),
    itemDeck: createCardDeck(cards.items || []),
    omenDeck: createCardDeck(cards.omens || []),
    phaseTimeoutMs: options.phaseTimeoutMs || 30000,
  };
}
```

`server/src/game/gameManager.js` 的 `startGame` 函式，把 `createGameState(startingRooms, rooms, cards)`（第24行）改成接受並轉傳一個可選的 `phaseTimeoutMs`：

```javascript
function startGame(manager, roomCode, { startingRooms, rooms, cards, characters, players, phaseTimeoutMs }) {
  if (manager.games.has(roomCode)) {
    throw new Error('GAME_ALREADY_STARTED');
  }
  const gameState = createGameState(startingRooms, rooms, cards, { phaseTimeoutMs });
```

（`options.phaseTimeoutMs || 30000` 在 `createGameState` 內部已經處理了 `undefined` 的情況，這裡不用額外判斷。）

`server/src/game/phaseFlow.js` 的 `enterPhase` 函式（第45-84行），在第46行 `gameState.currentPhase = phase;` 之後加一行：

```javascript
function enterPhase(gameState, phase) {
  gameState.currentPhase = phase;
  gameState.phaseDeadline = Date.now() + gameState.phaseTimeoutMs;
  resetPhaseLocks(gameState, phase);
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/gameState.test.js test/game/phaseFlow.test.js -v`
Expected: PASS，包含新增的3個測試以及所有既有測試（純新增欄位/新增一行賦值，不改變任何既有行為）

- [ ] **Step 5: 執行完整測試套件確認沒有連鎖破壞**

Run: `cd server && npm test`
Expected: 全綠（`phaseTimeoutMs`/`phaseDeadline` 是全新欄位，沒有既有程式碼讀它們）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/gameState.js server/src/game/gameManager.js server/src/game/phaseFlow.js server/test/game/gameState.test.js server/test/game/phaseFlow.test.js
git commit -m "feat: add configurable phaseTimeoutMs and phaseDeadline"
```

---

### Task 2: `promptState.js` 改成分玩家

**Files:**
- Modify: `server/src/game/promptState.js`
- Test: `server/test/game/promptState.test.js`

**Interfaces:**
- Consumes: 無
- Produces（簽名變更）：
  - `createPromptState()` → `{ pending: Map() }`（原本 `{ pending: null }`）
  - `createPrompt(container, { type, targetPlayerId, description, options, timeoutMs, now })` → 簽名不變，內部改成檢查/寫入 `container.pending`（依 `targetPlayerId` 這個 Map key）
  - `respondToPrompt(container, { promptId, playerId, optionId })` → 簽名不變（本來就有 `playerId`），內部改成先用 `playerId` 從 Map 取出該玩家自己的 pending
  - `resolvePromptTimeout(container, { playerId, promptId, defaultOptionId })` → **簽名變更，新增必填的 `playerId`**
  - `getPendingPrompt(container, playerId)` → **簽名變更，新增必填的 `playerId`**

- [ ] **Step 1: 改寫測試**

`server/test/game/promptState.test.js` 目前有11個測試，全部直接測試這個檔案。讀取該檔案現有內容後，比照以下規則改寫（不是重寫整份檔案，是針對每個既有測試調整）：

- 任何呼叫 `resolvePromptTimeout(container, {...})` 的地方，`{...}` 裡要加上 `playerId`（值等於該測試情境裡 `createPrompt` 用的 `targetPlayerId`）
- 任何呼叫 `getPendingPrompt(container)` 的地方，改成 `getPendingPrompt(container, playerId)`
- 測試 `createPrompt throws PROMPT_ALREADY_PENDING when one is already pending`（現有第34-38行一帶）拆成兩個測試：

```javascript
test('createPrompt throws PROMPT_ALREADY_PENDING when the SAME player already has one pending', () => {
  const container = createPromptState();
  createPrompt(container, makePromptInput({ targetPlayerId: 'p1' }));
  expect(() => createPrompt(container, makePromptInput({ targetPlayerId: 'p1' }))).toThrow('PROMPT_ALREADY_PENDING');
});

test('createPrompt does NOT throw when a DIFFERENT player has a pending prompt -- each player has their own independent slot', () => {
  const container = createPromptState();
  createPrompt(container, makePromptInput({ targetPlayerId: 'p1' }));
  expect(() => createPrompt(container, makePromptInput({ targetPlayerId: 'p2' }))).not.toThrow();
  expect(getPendingPrompt(container, 'p1')).not.toBeNull();
  expect(getPendingPrompt(container, 'p2')).not.toBeNull();
});
```

（`makePromptInput` 是這份測試檔案既有的 fixture 產生器，沿用既有的用法，只是這次明確傳入 `targetPlayerId` 覆蓋預設值——先讀該檔案確認 `makePromptInput` 目前的簽名跟預設值長怎樣，照現有慣例呼叫。）

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/promptState.test.js -v`
Expected: FAIL（`resolvePromptTimeout`/`getPendingPrompt` 目前簽名還沒加 `playerId`，且 `container.pending` 還是單一物件不是 Map，新的第二個 `PROMPT_ALREADY_PENDING` 測試也會失敗）

- [ ] **Step 3: 實作**

把 `server/src/game/promptState.js` 整份改成：

```javascript
let promptCounter = 0;

function generatePromptId() {
  promptCounter += 1;
  return `prompt_${promptCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPromptState() {
  return { pending: new Map() };
}

function createPrompt(container, { type, targetPlayerId, description, options, timeoutMs, now }) {
  if (container.pending.has(targetPlayerId)) {
    throw new Error('PROMPT_ALREADY_PENDING');
  }
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('INVALID_PROMPT_OPTIONS');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('INVALID_TIMEOUT');
  }
  const prompt = {
    promptId: generatePromptId(),
    type,
    targetPlayerId,
    description,
    options,
    deadline: now + timeoutMs,
  };
  container.pending.set(targetPlayerId, prompt);
  return prompt;
}

function respondToPrompt(container, { promptId, playerId, optionId }) {
  const pending = container.pending.get(playerId);
  if (!pending || pending.promptId !== promptId) {
    throw new Error('PROMPT_MISMATCH');
  }
  if (pending.targetPlayerId !== playerId) {
    throw new Error('PROMPT_FORBIDDEN');
  }
  if (!pending.options.includes(optionId)) {
    throw new Error('INVALID_PROMPT_OPTION');
  }
  container.pending.delete(playerId);
  return { promptId, chosenOptionId: optionId, wasTimeout: false };
}

function resolvePromptTimeout(container, { playerId, promptId, defaultOptionId }) {
  const pending = container.pending.get(playerId);
  if (!pending || pending.promptId !== promptId) {
    return null;
  }
  container.pending.delete(playerId);
  return { promptId, chosenOptionId: defaultOptionId, wasTimeout: true };
}

function getPendingPrompt(container, playerId) {
  return container.pending.get(playerId) || null;
}

module.exports = {
  createPromptState,
  createPrompt,
  respondToPrompt,
  resolvePromptTimeout,
  getPendingPrompt,
};
```

**注意**：`respondToPrompt` 裡 `pending.targetPlayerId !== playerId` 這個檢查，在新結構下其實已經不可能為真（因為 `pending` 本來就是用 `playerId` 從 Map 取出來的，一定是那位玩家自己的），但保留這個檢查不會造成任何問題（純粹永遠不會觸發的防呆），比刪除它更保守、不影響任何行為，維持原樣即可，不要移除。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/promptState.test.js -v`
Expected: PASS，全部測試（原本11個經過調整後的 + 新拆出來的1個，共12個左右）

- [ ] **Step 5: 執行完整測試套件，確認上層呼叫者暫時不受影響**

Run: `cd server && npm test`
Expected: **`resolvePromptTimeout`／`getPendingPrompt` 呼叫端目前還沒更新，預期 `server/src/socketHandlers.js` 裡呼叫 `resolvePromptTimeout` 的3個地方會因為少傳 `playerId` 而在執行時期出錯**（`container.pending.get(undefined)` 恆為 `undefined`，導致這3處呼叫全部從「正常解析逾時」變成「靜默什麼都不做」）。這是預期中的暫時性行為，下一個任務（Task 3）會補上這3個呼叫點的 `playerId`。**這一步只需要確認 `promptState.js` 自己的12個測試全過、且沒有任何測試在「編譯/載入階段」就直接壞掉（例如語法錯誤）**，不用糾結其餘測試套件在這個中間狀態下是否全綠——先把這個中間狀態的實際結果記下來（跑一次 `npm test` 記錄失敗數），下一個任務結束後應該要恢復全綠。

- [ ] **Step 6: Commit**

```bash
git add server/src/game/promptState.js server/test/game/promptState.test.js
git commit -m "feat: make promptState per-player (Map keyed by targetPlayerId)"
```

---

### Task 3: 待定選擇資料結構改分玩家（`effectResolverManager.js` ＋ `socketHandlers.js` 呼叫點）

**Files:**
- Modify: `server/src/game/effectResolverManager.js`
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 2 的 `promptState.js` 新簽名
- Produces：
  - `startResolver` 建立的 `resolverEntry.pendingChoice`／`pendingRollChoice`／`pendingInventoryChoice` 三個欄位從單一值改成 `Map<playerId, {...}>`
  - `hasPendingEffectChoice(effectResolverManager, roomCode, playerId)`／`hasPendingRollChoice(...)`／`hasPendingInventoryChoice(...)` 三個 guard 新增必填的 `playerId` 參數，只查該玩家自己那一格

這個任務是這次計畫裡改動範圍最大的一塊，`server/src/socketHandlers.js` 裡有十幾個呼叫點要跟著改。以下逐一列出，**每一處都只是把原本操作單一值的地方改成操作 `Map`，不改變任何業務邏輯**。

- [ ] **Step 1: `effectResolverManager.js` 的 `startResolver`**

```javascript
function startResolver(manager, roomCode) {
  if (manager.resolvers.has(roomCode)) {
    throw new Error('RESOLVER_ALREADY_STARTED');
  }
  const entry = {
    promptState: createPromptState(),
    pendingChoice: new Map(),
    pendingRollChoice: new Map(),
    pendingInventoryChoice: new Map(),
    inventoryChoiceTimeoutHandle: null,
  };
  manager.resolvers.set(roomCode, entry);
  return entry;
}
```

（`inventoryChoiceTimeoutHandle` 這個欄位這次先保留不動，Task 4 會把它整個刪掉，不要在這個任務動它，避免兩個任務互相踩線。）

- [ ] **Step 2: `server/src/socketHandlers.js` 的三個 guard 函式**

```javascript
function hasPendingEffectChoice(effectResolverManager, roomCode, playerId) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  return Boolean(resolverEntry && resolverEntry.pendingChoice.has(playerId));
}

function hasPendingRollChoice(effectResolverManager, roomCode, playerId) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  return Boolean(resolverEntry && resolverEntry.pendingRollChoice.has(playerId));
}

function hasPendingInventoryChoice(effectResolverManager, roomCode, playerId) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  return Boolean(resolverEntry && resolverEntry.pendingInventoryChoice.has(playerId));
}
```

- [ ] **Step 3: 四個 guard 呼叫點加上 `playerId`**

這四處目前長相完全一致（`game:move` 第177-185行、`game:selectAction` 第232-240行、`game:useStairs` 第437-445行、`handleLockPhase` 第479-487行一帶——確切行號可能因為前面任務的改動略有偏移，用下面這段文字搜尋定位，四處都一樣）：

```javascript
        if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingRollChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingInventoryChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'INVENTORY_CHOICE_IN_PROGRESS' });
        }
```

四處都改成加上 `playerId`（這四個 handler 裡 `playerId` 都已經是從 `socket.data` 解構出來、在 scope 裡可以直接用的既有變數，不用額外處理）：

```javascript
        if (hasPendingEffectChoice(effectResolverManager, roomCode, playerId)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingRollChoice(effectResolverManager, roomCode, playerId)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingInventoryChoice(effectResolverManager, roomCode, playerId)) {
          return ack({ error: 'INVENTORY_CHOICE_IN_PROGRESS' });
        }
```

- [ ] **Step 4: 每處寫入/讀取 `pendingChoice`／`pendingRollChoice`／`pendingInventoryChoice` 的地方改成 Map 操作**

以下每一組「原本」「改成」都要找到對應位置逐一修改：

**`resolverEntry.pendingChoice = {...}` → `.set(playerId, {...})`**（`handleEffectResolveResult` 函式裡，`pending` 分支）：
```javascript
// 原本
    resolverEntry.pendingChoice = {
      promptId: effectResult.promptId,
      options: effectResult.options,
      defaultOptionId: effectResult.defaultOptionId,
      playerId,
      sourceId,
      consumeItemIfApplied,
      pendingBonusEffects: effectResult.pendingBonusEffects || [],
    };
// 改成
    resolverEntry.pendingChoice.set(playerId, {
      promptId: effectResult.promptId,
      options: effectResult.options,
      defaultOptionId: effectResult.defaultOptionId,
      playerId,
      sourceId,
      consumeItemIfApplied,
      pendingBonusEffects: effectResult.pendingBonusEffects || [],
    });
```

**`resolverEntry.pendingChoice = null;` → `.delete(playerId)`**——`handleEffectResolveResult` 裡非 pending 分支開頭那行（原本第1130行左右 `resolverEntry.pendingChoice = null;`）改成 `resolverEntry.pendingChoice.delete(playerId);`。

**`resolverEntry.pendingRollChoice = null; // a roll choice and a plain choice...` 這行註解後的賦值** ——`handleLeaveCheckRollPending`／`handleCollapseCheckRollPending`／`handleRollChoicePending` 三個函式裡都各有一行 `resolverEntry.pendingChoice = null; // a roll choice and a plain choice can never be simultaneously pending -- opening this one invalidates any other`，三處都改成 `resolverEntry.pendingChoice.delete(playerId);`（保留註解文字不變，這個「同一玩家不能同時有兩種pending」的既有設計原則沒有變，只是資料結構變了）。這三個函式裡各自的 `resolverEntry.pendingRollChoice = {...}` 賦值，同樣改成 `resolverEntry.pendingRollChoice.set(playerId, {...})`。

**`resolverEntry.pendingInventoryChoice = {...}`／`= null`** ——`openInventoryChoiceIfNeeded` 裡的賦值改成 `.set(playerId, {...})`；`game:inventoryChoiceRespond` handler 跟 `handleInventoryChoiceTimeout` 裡的 `resolverEntry.pendingInventoryChoice = null;` 改成 `.delete(playerId)`（用該函式 scope 裡已經解構出來的 `playerId`/`choicePlayerId` 變數）。

**讀取端**（`game:effectPromptRespond`／`game:diceChoiceRespond`／`game:inventoryChoiceRespond` 三個 handler 裡的 `if (!resolverEntry || !resolverEntry.pendingChoice) {...}` 這類存在性檢查，以及緊接著的解構賦值）：
```javascript
// 原本（以 game:effectPromptRespond 為例）
        if (!resolverEntry || !resolverEntry.pendingChoice) {
          return ack({ error: 'NO_ACTIVE_EFFECT_CHOICE' });
        }
        const { promptId, optionId } = payload || {};
        const { playerId: choicePlayerId, sourceId, options, consumeItemIfApplied, pendingBonusEffects } = resolverEntry.pendingChoice;
// 改成
        if (!resolverEntry || !resolverEntry.pendingChoice.has(playerId)) {
          return ack({ error: 'NO_ACTIVE_EFFECT_CHOICE' });
        }
        const { promptId, optionId } = payload || {};
        const { playerId: choicePlayerId, sourceId, options, consumeItemIfApplied, pendingBonusEffects } = resolverEntry.pendingChoice.get(playerId);
```
`game:diceChoiceRespond`（`pendingRollChoice`）／`game:inventoryChoiceRespond`（`pendingInventoryChoice`）比照同一套模式：`!resolverEntry.pendingXChoice` → `!resolverEntry.pendingXChoice.has(playerId)`，`resolverEntry.pendingXChoice` 解構來源 → `resolverEntry.pendingXChoice.get(playerId)`。

**`resolvePromptTimeout`／`respondToPrompt` 呼叫點補上 `playerId`**（Task 2 已經把 `resolvePromptTimeout` 簽名改成需要 `playerId`）：
- `handleRollChoiceTimeout`：`resolvePromptTimeout(resolverEntry.promptState, { promptId, defaultOptionId: '__skip__' })` → 這個函式目前只收 `promptId`，沒有 `playerId` 參數可用，**這個函式的完整改法留給 Task 4**（因為它整個函式的呼叫方式都要在 Task 4 重新設計），這個任務先不動它，讓它保持現狀（暫時會因為 Task 2 的簽名變更而讀到 `undefined`，Task 4 會修正）。
- `handleInventoryChoiceTimeout`、`handleEffectChoiceTimeout`：同理，留給 Task 4。
- `respondToPrompt(resolverEntry.promptState, { promptId, playerId, optionId })` 這三個 respond handler 既有呼叫**已經有傳 `playerId`**（`respondToPrompt` 簽名本來就有 `playerId`，Task 2 沒有改這個函式的必填參數），這幾處**不需要修改**，確認一下三處都確實有傳 `playerId` 就好。

- [ ] **Step 5: 改寫既有測試**

`server/test/socketHandlers.test.js` 裡跟 `EFFECT_CHOICE_IN_PROGRESS`／`ROLL_CHOICE_IN_PROGRESS`／`INVENTORY_CHOICE_IN_PROGRESS` 相關的18個既有斷言（查證確認全部都是「同一位玩家自己觸發選擇、自己被擋下」的情境，不是跨玩家），這次資料結構改動**不影響這18個斷言的邏輯**（同一玩家依然會被自己的待定選擇擋住），只需要確認它們在改完之後仍然通過即可，不用改寫斷言內容。

新增以下2個測試證明「跨玩家不再互相卡住」（放在 `server/test/socketHandlers.test.js` 裡任何一個既有的效果選擇測試附近，沿用該檔案既有的 `setUpStartedGameWithContent`/`makeContent` 慣例）：

```javascript
test('a pending inventory choice for one player does not block a different player\'s unrelated game:move', async () => {
  const content = makeSearchRoomContent(['item_001', 'item_002', 'item_003', 'item_004', 'item_005']);
  content.cards.items = [
    { id: 'item_001', name: 'A', effects: [] }, { id: 'item_002', name: 'B', effects: [] },
    { id: 'item_003', name: 'C', effects: [] }, { id: 'item_004', name: 'D', effects: [] },
    { id: 'item_005', name: 'E', effects: [] },
  ];
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  // Might is baseIndex 2 in makeStats -- push enough held items to exceed the cap on the NEXT search.
  player.inventory.push({ id: 'item_001' }, { id: 'item_002' }, { id: 'item_003' });

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  getPlayer(gameState, currentPlayerId).actionPoints = 1;
  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  await pendingPromise;

  // currentPlayerId now has an unresolved inventory choice -- otherClient (a
  // different, unrelated player) must still be able to act freely.
  const otherResult = await new Promise((resolve) => otherClient.emit('game:lockPhase', {}, resolve));
  expect(otherResult.error).toBeUndefined();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a pending inventory choice for one player still blocks that SAME player\'s own further actions', async () => {
  const content = makeSearchRoomContent(['item_001', 'item_002', 'item_003', 'item_004', 'item_005']);
  content.cards.items = [
    { id: 'item_001', name: 'A', effects: [] }, { id: 'item_002', name: 'B', effects: [] },
    { id: 'item_003', name: 'C', effects: [] }, { id: 'item_004', name: 'D', effects: [] },
    { id: 'item_005', name: 'E', effects: [] },
  ];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_001' }, { id: 'item_002' }, { id: 'item_003' });

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  getPlayer(gameState, currentPlayerId).actionPoints = 1;
  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  await pendingPromise;

  const result = await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  expect(result.error).toBe('INVENTORY_CHOICE_IN_PROGRESS');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

（若 `makeSearchRoomContent` 或 `might` 的 baseIndex 數值跟以上假設不完全吻合、無法讓5件道具剛好超過上限，implementer 自行依 `server/test/socketHandlers.test.js` 裡 `makeStats()`／既有道具選擇測試的實際數值調整持有的道具數量，讓「超過上限」這個前提條件確實成立，這是允許的實作彈性，不算偏離計畫。）

- [ ] **Step 6: 執行測試**

Run: `cd server && npx jest test/socketHandlers.test.js -v`
Expected: 除了 `handleRollChoiceTimeout`／`handleInventoryChoiceTimeout`／`handleEffectChoiceTimeout` 相關、依賴「逾時後自動解決」行為的少數測試（會在 Task 4 才修好）以外全部通過，包含這次新增的2個。如果有其他非預期失敗，先找出原因再繼續，不要略過。

- [ ] **Step 7: Commit**

```bash
git add server/src/game/effectResolverManager.js server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: make pending-choice tracking per-player instead of per-room"
```

---

### Task 4: 拿掉3套獨立計時器，改造成可被外部呼叫的逾時解決函式

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 2／Task 3 的 Map 化 `promptState`／`resolverEntry`
- Produces：三個函式改造成「不再自己排程 `setTimeout`，改成收 `playerId` 當參數、可以被外部（下一個任務的階段逾時處理函式）直接呼叫」：
  - `resolveRollChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, content, ...)` （原 `handleRollChoiceTimeout` 改名+改參數）
  - `resolveInventoryChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, cardContent)` （原 `handleInventoryChoiceTimeout` 改名+改參數）
  - `resolveEffectChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, content, ...)` （原 `handleEffectChoiceTimeout` 改名+改參數，並依卡片 `onTimeout` 欄位決定 skip 或 random）

**這個任務同時處理 Global Constraints 裡「效果選擇 `onTimeout` 欄位」的資料與解析邏輯部分**，因為 `resolveEffectChoiceByTimeout` 需要讀這個欄位才能正確運作。

- [ ] **Step 1: 卡片資料新增 `onTimeout` 欄位**

`data/cards/event-cards.json`，`event_031`（紅藍藥丸，第400-416行一帶）的 `effects[0]`（`type: "choice"` 那個物件）新增一個欄位：

```json
    "effects": [{
      "type": "choice",
      "description": "紅色藥丸還是藍色藥丸？",
      "timeoutMs": 20000,
      "defaultOptionId": "give_up",
      "onTimeout": "random",
      "options": [
```

其餘所有 `type: "choice"` 效果（`event_010`）與 `preview_and_choose` 效果（`omen_003`）**不加這個欄位**——`handleChoice`／`handlePreviewAndChoose` 讀不到時要預設當作 `'skip'`（見 Step 3），資料上不用每張都補。

- [ ] **Step 2: `effectResolver.js` 的 `handleChoice` 把 `onTimeout` 帶進回傳值**

`server/src/game/effectResolver.js` 的 `handleChoice` 函式（第531-548行）：

```javascript
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
    onTimeout: effect.onTimeout || 'skip',
    options: effect.options,
  };
}
```

`handlePreviewAndChoose`（第508-530行）呼叫 `handleChoice` 時傳入的物件字面量本身沒有 `onTimeout` 欄位，`effect.onTimeout || 'skip'` 會自然套用 `'skip'`，不用額外修改 `handlePreviewAndChoose` 本身。

- [ ] **Step 3: `handleEffectResolveResult` 把 `onTimeout` 存進 `pendingChoice`**

`server/src/socketHandlers.js` 的 `handleEffectResolveResult` 函式，`pendingChoice.set(playerId, {...})`（Task 3 已經改成 `.set`）那段物件字面量，新增一個欄位：

```javascript
    resolverEntry.pendingChoice.set(playerId, {
      promptId: effectResult.promptId,
      options: effectResult.options,
      defaultOptionId: effectResult.defaultOptionId,
      onTimeout: effectResult.onTimeout,
      playerId,
      sourceId,
      consumeItemIfApplied,
      pendingBonusEffects: effectResult.pendingBonusEffects || [],
    });
```

- [ ] **Step 4: 寫失敗測試——三個「逾時解決函式」的行為**

在 `server/test/socketHandlers.test.js` 新增（放在既有的擲骰介入/道具選擇/效果選擇測試附近）：

```javascript
test('resolveInventoryChoiceByTimeout applies the pickInventoryChoiceDefault item, keeping the search action already spent', async () => {
  const content = makeSearchRoomContent(['item_001', 'item_002', 'item_003', 'item_004', 'item_005']);
  content.cards.items = [
    { id: 'item_001', name: 'A', effects: [] }, { id: 'item_002', name: 'B', effects: [] },
    { id: 'item_003', name: 'C', effects: [] }, { id: 'item_004', name: 'D', effects: [] },
    { id: 'item_005', name: 'E', effects: [] },
  ];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_001' }, { id: 'item_002' }, { id: 'item_003' });

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const apBeforeSearch = getPlayer(gameState, currentPlayerId).actionPoints;
  getPlayer(gameState, currentPlayerId).actionPoints = 1;
  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  await pendingPromise;

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  resolveInventoryChoiceByTimeout(io_TEST_HOOK, effectResolverManager_TEST_HOOK, gameState, roomCode, currentPlayerId, content.cards);
  await resolvedPromise;

  // The searched-and-picked-up item never made it into the backpack (dropped
  // by default); the search itself still cost the action point.
  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(0); // 1 - 1 (room_action)
  expect(getPlayer(gameState, currentPlayerId).inventory.length).toBe(3); // still just the 3 pre-existing items

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

**已查證確認**：`server/src/socketHandlers.js` 檔案最後已有 `module.exports = { registerSocketHandlers };`（第1445行），改成：

```javascript
module.exports = { registerSocketHandlers, resolveRollChoiceByTimeout, resolveInventoryChoiceByTimeout, resolveEffectChoiceByTimeout };
```

`server/test/socketHandlers.test.js` 檔案開頭找到既有 `require('../src/socketHandlers')` 那一行，把這三個函式一併解構出來。

`startTestServer`（第42-62行）目前回傳 `{ httpServer, port, lobbyManager, gameManager, characterSelectionManager, effectResolverManager }`——**沒有 `io`**，但這三個函式的第一個參數需要 `io` 才能廣播事件。在 `startTestServer` 的 `return` 物件裡加上 `io`：

```javascript
    resolve({ httpServer, port: httpServer.address().port, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, io });
```

`setUpStartedGameWithContent`（呼叫 `startTestServer` 並轉傳部分欄位）跟著在自己的回傳物件裡加上 `io`。上面測試草稿裡的 `io_TEST_HOOK`／`effectResolverManager_TEST_HOOK` 換成 `setUpStartedGameWithContent` 回傳值解構出來的 `io`／`effectResolverManager`。

比照上面這個模式，各寫一個 `resolveRollChoiceByTimeout`（驗證擲骰介入逾時後被介入的動作正常完成、不多扣行動力）跟 `resolveEffectChoiceByTimeout`（分別驗證 `onTimeout:'skip'`／`'random'` 兩種卡片各自的正確行為）的測試，需要的 fixture 內容比照 `event_010`／`event_031` 的既有測試資料自行建構。

- [ ] **Step 5: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -v`
Expected: 新增的測試 FAIL（函式還沒改名/改參數/匯出）

- [ ] **Step 6: 實作——刪除獨立計時器排程，改造三個函式**

刪除以下獨立計時器相關程式碼：
- `registerSocketHandlers` 開頭的 `effectChoiceTimeouts`／`rollChoiceTimeouts`／`rollChoiceTimeoutMs`／`inventoryChoiceTimeoutMs` 這幾個宣告——**先不要刪 `inventoryChoiceTimeoutMs`／`rollChoiceTimeoutMs` 這兩個變數本身**，因為 `createPrompt` 呼叫還是需要一個 `timeoutMs` 數字（見下方，這兩個現在改成「這個選擇彈窗UI最長顯示多久」的語意，不再是「逾時自動解決」的觸發點，可以沿用同樣的預設值 `20000`，只是不再有自己的 `setTimeout`）。實際要刪除的是 `effectChoiceTimeouts`／`rollChoiceTimeouts` 這兩個 `Map`（不再需要追蹤計時器 handle），以及 `effectResolverManager.js` `startResolver` 裡的 `inventoryChoiceTimeoutHandle: null,` 這一行欄位。
- `handleLeaveCheckRollPending`／`handleCollapseCheckRollPending`／`handleRollChoicePending` 三個函式裡，各自的這段（`setTimeout` 排程＋存進 Map）整段刪除：
  ```javascript
  const delayMs = Math.max(prompt.deadline - Date.now(), 0);
  const handle = setTimeout(() => {
    handleRollChoiceTimeout(io, effectResolverManager, gameState, roomCode, prompt.promptId, rollChoiceTimeouts, effectChoiceTimeouts, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
  }, delayMs);
  rollChoiceTimeouts.set(roomCode, handle);
  ```
  這三個函式的簽名跟著簡化，移除不再需要的 `rollChoiceTimeouts` 參數（其餘參數維持不動，包含 `rollChoiceTimeoutMs`——`createPrompt` 呼叫還是需要它）。
- `openInventoryChoiceIfNeeded` 函式裡對應的 `setTimeout` 排程整段（`const handle = setTimeout(...); resolverEntry.inventoryChoiceTimeoutHandle = handle;`）刪除，簽名移除 `inventoryChoiceTimeoutMs` 這個現在用不到的參數——**不對，`createPrompt` 呼叫仍需要 `timeoutMs`，這個參數留著，只刪除 `setTimeout` 排程那兩行**。
- `handleEffectResolveResult` 函式裡對應的 `setTimeout` 排程整段（`const delayMs = ...; const handle = setTimeout(...); effectChoiceTimeouts.set(roomCode, handle);`）刪除，簽名移除不再需要的 `effectChoiceTimeouts` 參數。
- `game:inventoryChoiceRespond` handler 裡 `if (resolverEntry.inventoryChoiceTimeoutHandle) { clearTimeout(...); resolverEntry.inventoryChoiceTimeoutHandle = null; }` 這段整段刪除（欄位已經不存在了）。
- `game:diceChoiceRespond` handler 裡的 `clearRollChoiceTimeout(roomCode, rollChoiceTimeouts);` 呼叫、`game:effectPromptRespond` 裡的 `clearEffectChoiceTimeout(roomCode, effectChoiceTimeouts);` 呼叫——這兩個輔助函式 `clearRollChoiceTimeout`／`clearEffectChoiceTimeout` 本身以及這兩處呼叫都一併刪除（連同 `clearCharacterSelectTimeout` 那個模式相似但服務不同系統的函式**不要動**，那個是角色選擇專用，維持不變）。

把 `handleRollChoiceTimeout`／`handleInventoryChoiceTimeout`／`handleEffectChoiceTimeout` 三個函式改名＋改參數：

```javascript
function resolveRollChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs) {
  try {
    const resolverEntry = getResolver(effectResolverManager, roomCode);
    const pending = resolverEntry && resolverEntry.pendingRollChoice.get(playerId);
    if (!pending) return;
    const { resumeKind, resumeContext } = pending;
    const promptId = resolverEntry.promptState.pending.get(playerId)?.promptId;
    const result = resolvePromptTimeout(resolverEntry.promptState, { playerId, promptId, defaultOptionId: '__skip__' });
    if (!result) {
      resolverEntry.pendingRollChoice.delete(playerId);
      return;
    }
    resolverEntry.pendingRollChoice.delete(playerId);
    io.to(roomCode).emit('game:promptResolved', result);
    resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, resumeKind, resumeContext, null, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('roll choice timeout error', err);
  }
}
```

**注意 `resumeRollChoice`／`handleRollChoicePending` 等函式的簽名裡原本有 `rollChoiceTimeouts`／`effectChoiceTimeouts` 這兩個參數，這次全部從所有牽涉的函式簽名跟呼叫點移除**（因為對應的兩個 Map 已經整個刪除）——implementer 需要順著呼叫鏈把 `resumeRollChoice`、`resumeLeaveCheckRollChoice`、`resumeCollapseCheckRollChoice`、`handleRollChoicePending`、`finishMoveResult` 這幾個函式簽名與呼叫點裡，所有 `rollChoiceTimeouts`／`effectChoiceTimeouts` 參數都拿掉，只保留 `rollChoiceTimeoutMs`／`inventoryChoiceTimeoutMs` 這兩個純數字參數。

```javascript
function resolveInventoryChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, cardContent) {
  try {
    const resolverEntry = getResolver(effectResolverManager, roomCode);
    const pending = resolverEntry && resolverEntry.pendingInventoryChoice.get(playerId);
    if (!pending) return;
    const { triggeredByItemId, newlyAcquiredItemIds } = pending;
    const promptId = resolverEntry.promptState.pending.get(playerId)?.promptId;
    const result = resolvePromptTimeout(resolverEntry.promptState, { playerId, promptId, defaultOptionId: triggeredByItemId });
    if (!result) return;
    resolverEntry.pendingInventoryChoice.delete(playerId);
    applyInventoryLeave(gameState, playerId, result.chosenOptionId);
    io.to(roomCode).emit('game:promptResolved', result);
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('inventory choice timeout error', err);
  }
}
```

**注意這裡刻意不再呼叫 `openInventoryChoiceIfNeeded` 檢查「丟掉一件之後還是超過上限」——舊的獨立20秒計時器系統裡，`handleInventoryChoiceTimeout` 會遞迴再開一次選擇；但現在的統一階段逾時機制（Task 5）本身就是「對所有還沒鎖定的參與者逐一處理」，如果丟掉最新一件之後還是超過上限，這位玩家的背包會維持超過上限的狀態直到他自己下一次真的去處理，不會在逾時當下被強制連環丟到低於上限。這是設計文件裡「已完成的部分維持完成」原則的自然延伸，跟開發者確認過的規則沒有衝突（開發者原話：探索有成功但進背包沒成功，只講了最新拾取那件，沒有要求連環清到低於上限）。**

```javascript
function resolveEffectChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs) {
  try {
    const resolverEntry = getResolver(effectResolverManager, roomCode);
    const pending = resolverEntry && resolverEntry.pendingChoice.get(playerId);
    if (!pending) return;
    const { sourceId, options, onTimeout, consumeItemIfApplied, pendingBonusEffects } = pending;
    const promptId = resolverEntry.promptState.pending.get(playerId)?.promptId;
    if (onTimeout === 'random') {
      const randomOption = options[Math.floor(Math.random() * options.length)];
      const result = resolvePromptTimeout(resolverEntry.promptState, { playerId, promptId, defaultOptionId: randomOption.optionId });
      if (!result) return;
      resolverEntry.pendingChoice.delete(playerId);
      io.to(roomCode).emit('game:promptResolved', result);
      const chosenEffects = [...resolveChoiceOption(options, result.chosenOptionId), ...(pendingBonusEffects || [])];
      const nextResult = resolveEffects(gameState, resolverEntry.promptState, playerId, chosenEffects, { now: Date.now(), itemCatalog: content.cards.items, omenCatalog: content.cards.omens, npcCatalog: content.npcs });
      handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, consumeItemIfApplied, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
      io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      return;
    }
    // onTimeout === 'skip' (default): nothing happens, just clear the pending state.
    const result = resolvePromptTimeout(resolverEntry.promptState, { playerId, promptId, defaultOptionId: '__skip__' });
    if (!result) return;
    resolverEntry.pendingChoice.delete(playerId);
    io.to(roomCode).emit('game:promptResolved', result);
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('effect choice timeout error', err);
  }
}
```

**`'skip'` 分支刻意不呼叫 `resolveEffects`（不像原本的 `handleEffectChoiceTimeout` 一定會套用 `defaultOptionId` 對應的效果）——這是這次設計「什麼都不發生」跟舊制「套用預設選項」最根本的行為差異，也是本任務的核心目的，不要不小心保留舊的「套用defaultOptionId效果」行為。**

在檔案最後補上／擴充 `module.exports`（含這三個新函式，供 Task 5 跟測試呼叫；若檔案原本沒有 `module.exports`，這是新增；若已有，新增這三個進去）：

```javascript
module.exports = { registerSocketHandlers, resolveRollChoiceByTimeout, resolveInventoryChoiceByTimeout, resolveEffectChoiceByTimeout };
```

- [ ] **Step 7: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -v`
Expected: PASS，全部通過（含 Step 4 新增的3個逾時解決函式測試）

- [ ] **Step 8: 執行完整測試套件**

Run: `cd server && npm test`
Expected: 全綠（Task 3 結尾記錄的暫時性失敗這裡應該全部恢復）

- [ ] **Step 9: 死代碼檢查**

Run: `cd server && grep -rn "rollChoiceTimeouts\|effectChoiceTimeouts\|inventoryChoiceTimeoutHandle\|handleRollChoiceTimeout\|handleInventoryChoiceTimeout\|handleEffectChoiceTimeout\|clearRollChoiceTimeout\|clearEffectChoiceTimeout" src/`

Expected: 沒有任何輸出。有殘留代表刪除不完整，需要補齊。

- [ ] **Step 10: Commit**

```bash
git add data/cards/event-cards.json server/src/game/effectResolver.js server/src/game/effectResolverManager.js server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: replace per-choice timeouts with externally-triggerable resolve functions, add onTimeout card field"
```

---

### Task 5: 統一階段逾時機制

**Files:**
- Modify: `server/src/socketHandlers.js`
- Modify: `server/src/game/effectResolver.js`（`handleRemoveImprint` 的 NPC 刪除連動）
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 1 的 `gameState.phaseDeadline`、Task 4 的三個 `resolveXChoiceByTimeout` 函式、`phaseFlow.js` 既有的 `getParticipants`／`lockPlayerPhase`／`allParticipantsLocked`
- Produces：`scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs)`——在每個可能觸發階段推進的地方呼叫；內部的 `handlePhaseTimeout` 逾時處理函式。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/socketHandlers.test.js` 新增：

```javascript
test('phase auto-locks an unresolved player when the phase deadline passes, with a very short phaseTimeoutMs', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, gameManager, roomCode } =
    await setUpStartedGameWithContent(makeContent(), { phaseTimeoutMs: 50 });
  const gameState = getGameState(gameManager, roomCode);

  // Neither player locks player_move -- just wait past the 50ms deadline.
  await new Promise((resolve) => setTimeout(resolve, 150));

  expect(gameState.currentPhase).toBe('npc_move'); // player_move auto-advanced once both got force-locked, npc_move is empty so it cascades too
  clientA.close();
  clientB.close();
  httpServer.close();
});

test('phase timeout resolves a player\'s pending inventory choice via the default (drop newest item) before locking them', async () => {
  const content = makeSearchRoomContent(['item_001', 'item_002', 'item_003', 'item_004', 'item_005']);
  content.cards.items = [
    { id: 'item_001', name: 'A', effects: [] }, { id: 'item_002', name: 'B', effects: [] },
    { id: 'item_003', name: 'C', effects: [] }, { id: 'item_004', name: 'D', effects: [] },
    { id: 'item_005', name: 'E', effects: [] },
  ];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } =
    await setUpStartedGameWithContent(content, { phaseTimeoutMs: 150 });
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_001' }, { id: 'item_002' }, { id: 'item_003' });

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  getPlayer(gameState, currentPlayerId).actionPoints = 1;
  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  await pendingPromise;

  await new Promise((resolve) => setTimeout(resolve, 250)); // past the 150ms phase deadline

  expect(getPlayer(gameState, currentPlayerId).inventory.length).toBe(3); // newest pickup dropped, not added
  expect(getPlayer(gameState, currentPlayerId).phaseLocked).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "phase auto-locks|phase timeout resolves" -v`
Expected: FAIL（機制還不存在，階段永遠不會自動推進）

- [ ] **Step 3: 實作**

在 `server/src/socketHandlers.js`，`registerSocketHandlers` 函式內新增一個 `Map`（跟其他既有的 `characterSelectTimeouts` 等宣告放一起）：

```javascript
  const phaseTimeouts = new Map(); // roomCode -> { handle, deadline }
```

新增以下兩個函式（放在檔案裡其他 handler 函式附近，例如 `handleLockPhase` 之後）：

```javascript
function scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs) {
  const existing = phaseTimeouts.get(roomCode);
  if (existing && existing.deadline === gameState.phaseDeadline) {
    return; // already scheduled for this exact phase entry, nothing changed
  }
  if (existing) {
    clearTimeout(existing.handle);
  }
  const delayMs = Math.max(gameState.phaseDeadline - Date.now(), 0);
  const handle = setTimeout(() => {
    handlePhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
  }, delayMs);
  phaseTimeouts.set(roomCode, { handle, deadline: gameState.phaseDeadline });
}

function handlePhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs) {
  try {
    const phase = gameState.currentPhase;
    const unresolved = getParticipants(gameState, phase).filter((p) => !p.phaseLocked);
    for (const participant of unresolved) {
      const playerId = participant.playerId;
      resolveRollChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
      resolveInventoryChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, content.cards);
      resolveEffectChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
      // A participant force-locked here may already have been auto-advanced
      // past by an earlier iteration's cascade (allParticipantsLocked inside
      // lockPlayerPhase) -- re-check they're still a participant of the
      // ORIGINAL phase and still unlocked before locking them again.
      if (gameState.currentPhase === phase && !participant.phaseLocked) {
        lockPlayerPhase(gameState, playerId);
      }
    }
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
    scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
  } catch (err) {
    console.error('phase timeout error', err);
  }
}
```

`getParticipants`／`lockPlayerPhase` 從 `./game/phaseFlow` 的既有 `require` 那行補上匯入（目前那行是 `const { lockPlayerPhase, resolveActingEntity } = require('./game/phaseFlow');`，改成 `const { lockPlayerPhase, resolveActingEntity, getParticipants } = require('./game/phaseFlow');`——`getParticipants` 目前有沒有從 `phaseFlow.js` 匯出？查證 `phaseFlow.js` 目前 `module.exports = { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase, requirePhase, resolveActingEntity, allParticipantsLocked };`——**沒有 `getParticipants`，這個任務要順便把它加進 `phaseFlow.js` 的 `module.exports`**）。

在 `handleLockPhase` 函式裡，`ack({ currentPhase: gameState.currentPhase })` 之前、`io.to(roomCode).emit('game:stateUpdate', ...)` 之後（或之前皆可，只要在 `lockPlayerPhase` 呼叫完成之後），加上呼叫：

```javascript
scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
```

（`handleLockPhase` 函式裡有兩個分支——`actingAsNpcId` 分支跟真人玩家分支——兩處都要各加一次這個呼叫，各自的 `lockPlayerPhase` 呼叫完成之後。）

**遊戲剛開始時的第一次排程**：`gameManager.js` 的 `startGame` 呼叫 `enterPhase(gameState, 'player_move')` 之後，`gameState.phaseDeadline` 已經被設定好了，但這時候還沒有 `phaseTimeouts` 這個 Map 的存在（那是 `socketHandlers.js` 內部的東西，`gameManager.js` 拿不到）。查證 `finishCharacterSelection` 函式（呼叫 `startGame` 的地方）——這個函式在 `socketHandlers.js` 裡，`startGame` 呼叫完成之後、`io.to(roomCode).emit('game:started', {...})` 之前或之後，補上第一次 `scheduleOrRefreshPhaseTimeout(...)` 呼叫。

`server/src/game/effectResolver.js` 的 `handleRemoveImprint` 函式，NPC 刪除連動的 `allParticipantsLocked`/`advancePhase` 呼叫那段——**這段程式碼在純 `game/` 模組裡，沒有 `io`／`phaseTimeouts`，沒辦法直接呼叫 `scheduleOrRefreshPhaseTimeout`**。查證這個函式目前的呼叫鏈：`handleRemoveImprint` 是透過 `resolveEffects` 被呼叫，而 `resolveEffects` 的所有呼叫端都在 `socketHandlers.js`（Step 3 前面列出的6個呼叫點）。**這個任務不用讓 `effectResolver.js` 自己知道怎麼排程**——只要確保 `socketHandlers.js` 裡每一處呼叫 `resolveEffects(...)` 之後、廣播 `game:stateUpdate` 之前或之後，都補上一次 `scheduleOrRefreshPhaseTimeout(...)` 呼叫即可（因為 `scheduleOrRefreshPhaseTimeout` 自己會比對 `gameState.phaseDeadline` 有沒有變，沒變就不做事，呼叫多次是安全的）。逐一檢查 Step 3 列出的6個 `resolveEffects` 呼叫點所在的外層函式（`game:selectAction` 的 sourceEffects 分支、`game:effectPromptRespond`、`applyRoomEndTurnBonus`、`resolveCardDraw`、`resumeRollChoice` 的 diceCheck 分支、`resolveEffectChoiceByTimeout`），確認每一處在函式返回前都會呼叫到 `scheduleOrRefreshPhaseTimeout`——多數應該已經被前面「`handleLockPhase`」跟「`finishCharacterSelection`」的改動間接涵蓋（因為這些效果解析大多發生在某次 `game:move`／`game:selectAction`／`game:lockPhase` 呼叫的過程中，該次呼叫結尾廣播 `game:stateUpdate` 前統一補一次即可）；為了確保萬無一失，**在 `game:move` 與 `game:selectAction` 這兩個 handler 各自的所有成功路徑（每一個 `ack(result); ... io.to(roomCode).emit('game:stateUpdate', ...)` 附近）都各加一次 `scheduleOrRefreshPhaseTimeout` 呼叫**，寧可多呼叫幾次（函式本身有防重複排程的比對）也不要漏掉真正會改變 `currentPhase` 的路徑。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -v`
Expected: PASS，全部通過

- [ ] **Step 5: 執行完整測試套件**

Run: `cd server && npm test`
Expected: 全綠。**這一步特別注意**：既有大量測試沒有明確帶入 `phaseTimeoutMs`，會用預設值 `30000`（30秒），遠大於 Jest 單一測試的合理執行時間，這些測試不會受新排程機制影響而意外卡住或逾時——如果發現任何既有測試因為這次改動變慢或掛住，回頭檢查是不是不小心把預設 `phaseTimeoutMs` 改小了，或是 `setTimeout` 排程本身有洩漏（測試結束時 `httpServer.close()` 有沒有確實清掉關聯的計時器——若 Jest 跑完後出現「A worker process has failed to exit gracefully」的警告增加，需要進一步排查，但這在這個專案原本測試套件裡就是已知的既有現象，不一定是這次改動造成的，先確認警告數量沒有明顯增加即可）。

- [ ] **Step 6: Commit**

```bash
git add server/src/socketHandlers.js server/src/game/phaseFlow.js server/test/socketHandlers.test.js
git commit -m "feat: add unified phase-deadline timeout that force-resolves and locks unresponsive participants"
```

---

### Task 6: 前端——可拖曳的階段倒數彈窗

**Files:**
- Create: `client/src/gameplay/PhaseCountdownPopup.jsx`
- Modify: `client/src/DebugGameScreen.jsx`

**Interfaces:**
- Consumes: `gameState.phaseDeadline`（`game:stateUpdate`／`game:started` payload裡，`serializeGameState` 目前沒有帶這個欄位，需要先確認/補上）
- Produces: `PhaseCountdownPopup({ phase, deadline, locked })` 元件

- [ ] **Step 1: 確認並補上 `serializeGameState` 廣播 `phaseDeadline`**

查證 `server/src/game/gameState.js` 的 `serializeGameState` 函式（第53-91行）目前有沒有帶 `phaseDeadline`——目前只有 `currentPhase`，**沒有** `phaseDeadline`。新增一行：

```javascript
    currentPhase: gameState.currentPhase || null,
    phaseDeadline: gameState.phaseDeadline || null,
```

在 `server/test/game/gameState.test.js` 新增：

```javascript
test('serializeGameState includes phaseDeadline', () => {
  const gameState = createGameState([], [], {});
  gameState.phaseDeadline = 12345;
  expect(serializeGameState(gameState).phaseDeadline).toBe(12345);
});
```

Run: `cd server && npx jest test/game/gameState.test.js -v` 確認通過，再 `cd server && npm test` 確認完整套件全綠，commit（`git add server/src/game/gameState.js server/test/game/gameState.test.js && git commit -m "feat: broadcast phaseDeadline in serializeGameState"`）。

- [ ] **Step 2: 新建 `PhaseCountdownPopup.jsx`**

```jsx
import { useState, useEffect, useRef } from 'react';

const STORAGE_KEY = 'phaseCountdownPopupPosition';
const DEFAULT_POSITION = { x: 16, y: 80 };

function loadStoredPosition() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_POSITION;
    const parsed = JSON.parse(raw);
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
    return DEFAULT_POSITION;
  } catch (err) {
    return DEFAULT_POSITION;
  }
}

function savePosition(position) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch (err) {
    // localStorage unavailable (private browsing, quota, etc.) -- position
    // just won't persist across reloads, not a functional failure.
  }
}

const PHASE_LABELS = {
  player_move: '移動階段',
  npc_move: 'NPC移動階段',
  player_interact: '互動階段',
  npc_interact: 'NPC互動階段',
  settlement: '結算階段',
};

export default function PhaseCountdownPopup({ phase, deadline, locked }) {
  const [position, setPosition] = useState(loadStoredPosition);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const dragRef = useRef(null); // { startClientX, startClientY, startPosition } while dragging

  useEffect(() => {
    if (!deadline) return undefined;
    const tick = () => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [deadline]);

  function handlePointerDown(e) {
    dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startPosition: position };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e) {
    if (!dragRef.current) return;
    const { startClientX, startClientY, startPosition } = dragRef.current;
    const next = {
      x: startPosition.x + (e.clientX - startClientX),
      y: startPosition.y + (e.clientY - startClientY),
    };
    setPosition(next);
  }

  function handlePointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    savePosition(position);
  }

  if (!phase || !deadline) return null;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 90,
        cursor: 'move',
        userSelect: 'none',
        border: '2px solid #555',
        backgroundColor: '#f0f0f0',
        borderRadius: 4,
        padding: '6px 10px',
        fontSize: 14,
        minWidth: 100,
        textAlign: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }}
    >
      <div>{PHASE_LABELS[phase] || phase}</div>
      <div style={{ fontSize: 20, fontWeight: 'bold' }}>{locked ? '等待其他玩家' : `${secondsLeft}s`}</div>
    </div>
  );
}
```

- [ ] **Step 3: 在 `DebugGameScreen.jsx` 接上**

新增 import（跟既有 `import NpcPanel from './gameplay/NpcPanel';` 那行附近）：

```javascript
import PhaseCountdownPopup from './gameplay/PhaseCountdownPopup';
```

在 `playing-layout__viewport` 區塊裡（跟四個角落按鈕同一層、`{/* 四個角落浮動按鈕 */}` 這段附近），加上：

```jsx
              <PhaseCountdownPopup
                phase={gameState.currentPhase}
                deadline={gameState.phaseDeadline}
                locked={actingAsNpcId ? activeEntity.phaseLocked : me.phaseLocked}
              />
```

（`PhaseCountdownPopup` 是 `position:fixed`，不需要放在特定的 relative 容器裡，放在 `playing-layout` 底下任何位置都可以正常運作，選一個跟其他浮動元件同層的位置即可，不影響版面配置。）

- [ ] **Step 4: 執行 build check**

Run: `cd client && npm run build`
Expected: 成功，無錯誤

- [ ] **Step 5: 手動瀏覽器驗證**

依 CLAUDE.md 規則，這是可觀察的UI改動，需要透過 Browser pane 實際驗證：
1. `preview_start` 啟動 server（3001）+ client（5173）
2. 建房、雙人加入、選角、開始遊戲
3. 確認畫面上出現階段倒數彈窗，顯示「移動階段」與倒數秒數，且秒數會隨時間遞減
4. 拖曳彈窗到畫面另一個位置，重新整理頁面，確認彈窗出現在拖曳後的位置（不是預設位置）
5. 其中一位玩家點擊「階段結束」鎖定，確認該玩家自己畫面上的彈窗文字變成「等待其他玩家」
6. 檢查瀏覽器 console 全程無錯誤
7. 驗證完成後停止 preview server

- [ ] **Step 6: Commit**

```bash
git add client/src/gameplay/PhaseCountdownPopup.jsx client/src/DebugGameScreen.jsx
git commit -m "feat: add draggable, position-persisted phase countdown popup"
```

---

### Task 7: 死代碼清查與完整回歸

**Files:**
- Modify: 視查證結果而定
- Test: 執行完整測試套件

- [ ] **Step 1: 全域死代碼掃描**

```bash
cd server && grep -rn "rollChoiceTimeouts\|effectChoiceTimeouts\|inventoryChoiceTimeoutHandle\|handleRollChoiceTimeout\|handleInventoryChoiceTimeout\|handleEffectChoiceTimeout\|clearRollChoiceTimeout\|clearEffectChoiceTimeout" src/ test/
```

Expected: 沒有任何輸出（Task 4 的 Step 9 已經檢查過 `src/`，這裡連同 `test/` 一起再檢查一次，確認測試檔案裡也沒有遺留舊名稱的殘留引用）。

- [ ] **Step 2: 確認 `resolvePromptTimeout`／`getPendingPrompt` 所有呼叫端都已經傳入 `playerId`**

```bash
cd server && grep -rn "resolvePromptTimeout(\|getPendingPrompt(" src/
```

逐一確認每個呼叫都有傳 `playerId`（不是只有 `promptId`／`defaultOptionId`）。

- [ ] **Step 3: 執行完整測試套件**

Run: `cd server && npm test`
Expected: 全綠

- [ ] **Step 4: 執行前端 build**

Run: `cd client && npm run build`
Expected: 成功

- [ ] **Step 5: 如果 Step 1/2 有發現需要清理的地方，處理後重跑 Step 3/4 確認仍全綠，Commit**

```bash
git add -A
git commit -m "chore: dead-code sweep after phase countdown refactor"
```

（如果 Step 1/2 完全沒有發現任何問題，這個任務不需要額外 commit，在報告裡註明「掃描乾淨，無需清理」即可。）

---

## 自我審查記錄（writing-plans 流程要求）

- **spec 涵蓋**：設計文件五個部分分別對應 Task 1（秒數不寫死＋機制）、Task 2+3（待定選擇分玩家）、Task 4（拿掉個別計時器＋三種逾時邏輯）、Task 5（統一階段逾時機制）、Task 6（前端彈窗）；角色選擇逾時維持不動，全計畫沒有任何任務觸碰 `characterSelectTimeouts`／`handleCharacterSelectTimeout`／`assignRandomCharacter`，符合範圍排除
- **型別一致性**：`resolveRollChoiceByTimeout`／`resolveInventoryChoiceByTimeout`／`resolveEffectChoiceByTimeout`（Task 4 定義）在 Task 5 的 `handlePhaseTimeout` 裡以相同簽名呼叫；`scheduleOrRefreshPhaseTimeout`（Task 5 定義）在 Task 5 自己的多個呼叫點與未來擴充點使用一致簽名；`gameState.phaseTimeoutMs`/`phaseDeadline`（Task 1 定義）貫穿 Task 5／Task 6 使用一致的欄位名稱
- **佔位掃描**：Task 4 Step 4 原本對 `module.exports`／`startTestServer` 回傳值的現況不確定，已在自我審查階段直接查證確認（`socketHandlers.js:1445` 已有 `module.exports`，`startTestServer` 目前沒有回傳 `io`），計畫本文已改成明確的定案指示，不再留任何待查證的分支選擇
