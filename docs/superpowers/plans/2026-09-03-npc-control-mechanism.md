# NPC 操控機制實際實作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `omen_004`（獵犬）的使用能真的召喚出一個可操控的 NPC 實體（`gameState.players` 裡一個 `isNPC:true` 的物件），操控者能在 `npc_move` 階段透過既有 socket 事件（帶新的 `actingAsNpcId` 參數）移動它、拾取/遺留房間道具、鎖定它自己的階段，完全取代目前完全沒有前端程式碼、一觸發就會卡死玩家的舊 `switch_control`／`player.summons` 機制。

**Architecture:** 新增一個共用的 `resolveActingEntity` 授權函式，把「操控者的 socket 連線 + 可選的 `actingAsNpcId`」解析成「這次動作實際套用的 playerId」，交給既有的 `moveToRoom`／`selectAction`／`lockPlayerPhase` 家族函式（NPC 走一個新的、獨立的 `npcFlow.js`，因為既有 `moveToRoom`/`pickupItemAction` 帶有大量跟 NPC 無關的分支，硬塞進去會讓函式更難讀）。NPC 資料模型比照真人玩家（`stats`/`inventory`/`actionPoints` 同形狀），行動力重置、階段鎖定完全複用既有 `phaseFlow.js`／`playerEntity.js` 邏輯，不新增特殊分支。

**Tech Stack:** Node.js／Express／Socket.IO（後端），React（前端），Jest（測試）。

## Global Constraints

- 設計文件：[2026-09-03-npc-control-mechanism-design.md](../specs/2026-09-03-npc-control-mechanism-design.md)（含 2026-09-01 文件的既有確認）
- NPC 行動範圍：只能移動進已放置的鄰房（不能開新門）、只能拾取/遺留房間掉落物（背包上限 1 件），全部歸類在 `npc_move` 階段；`npc_interact` 對 NPC 沒有任何可做的事，操控者只需要鎖定
- `actingAsNpcId` 是 `game:move`／`game:selectAction`（限 `mode:'pickup'/'leave'`）／`game:lockPhase`（含別名 `game:endTurn`）payload 的可選欄位，不帶時完全比照操控自己
- `gameState.turnOrder`／`currentPlayerIndex`／開局洗牌邏輯**保留不動**（大量既有測試輔助函式依賴它決定 `currentPlayerId`），只刪除真正的消費函式（`getCurrentTurnPlayerId`／`requireTurnOrder`／`moveSummon`／`selectSummonAction`）
- 舊 `switch_control`／`player.summons`／`player.summonUsedThisTurn` 機制整套刪除，不保留相容層
- 所有新程式碼註解與測試命名遵守「回合」（完整5階段循環）／「階段」（單一階段）的既有用語區分規則

---

### Task 1: `playerEntity.js` 新增 `createNpc` 工廠函式

**Files:**
- Modify: `server/src/game/playerEntity.js`
- Test: `server/test/game/playerEntity.test.js`

**Interfaces:**
- Consumes: 無（純資料工廠，跟既有 `createPlayer` 平行）
- Produces: `createNpc({ npcID, controlledBy, linkedImprintId, floor, x, y, stats })` → 回傳一個 `{ playerId, isNPC:true, npcID, controlledBy, linkedImprintId, floor, x, y, stats, actionPoints:0, inventory:[], phaseLocked:false }` 物件。`playerId` 是自動產生的隨機字串（`'npc_' + 8碼亂數`），供後續任務把這個物件塞進 `gameState.players`（用這個 `playerId` 當 key）。驗證失敗時丟出跟 `createPlayer` 完全一樣的錯誤：`MISSING_STAT_DEFINITION`／`INVALID_STAT_TRACK`／`INVALID_SKULL_INDEX`／`INVALID_BASE_INDEX`。

現有 `createPlayer`（`server/src/game/playerEntity.js:14-59`）把「驗證 `stats` 形狀＋建出 `statTracks` 物件」這段邏輯（第 15-41 行）跟「組裝最終物件」混在一起。這個任務先把驗證＋組裝 `statTracks` 抽成一個共用函式 `buildStatTracks(stats)`，讓 `createPlayer` 跟新的 `createNpc` 都呼叫它，不要複製貼上這 25 行邏輯。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/playerEntity.test.js` 找到現有 `createPlayer` 相關測試附近（檔案頂端 `require` 的地方會有 `const { createPlayer, ... } = require('../../src/game/playerEntity');`），把這一行改成也 `require` 新函式，並新增以下測試：

```javascript
const { createPlayer, createNpc, ...(其餘既有已列出的匯出，原樣保留) } = require('../../src/game/playerEntity');

function makeNpcStats() {
  return {
    might: { track: [1], baseIndex: 0, skullIndex: 0 },
    speed: { track: [6], baseIndex: 0, skullIndex: 0 },
    knowledge: { track: [1], baseIndex: 0, skullIndex: 0 },
    sanity: { track: [1], baseIndex: 0, skullIndex: 0 },
  };
}

test('createNpc builds a player-shaped NPC entity at the controller\'s position', () => {
  const npc = createNpc({
    npcID: 'npc_001',
    controlledBy: 'p1',
    linkedImprintId: 'omen_004',
    floor: 'ground',
    x: 3,
    y: -2,
    stats: makeNpcStats(),
  });
  expect(npc.isNPC).toBe(true);
  expect(npc.npcID).toBe('npc_001');
  expect(npc.controlledBy).toBe('p1');
  expect(npc.linkedImprintId).toBe('omen_004');
  expect(npc.floor).toBe('ground');
  expect(npc.x).toBe(3);
  expect(npc.y).toBe(-2);
  expect(npc.actionPoints).toBe(0);
  expect(npc.inventory).toEqual([]);
  expect(npc.phaseLocked).toBe(false);
  expect(typeof npc.playerId).toBe('string');
  expect(npc.playerId.startsWith('npc_')).toBe(true);
  expect(npc.stats.speed.track).toEqual([6]);
  expect(npc.stats.speed.currentIndex).toBe(0);
});

test('createNpc generates a different playerId for each call', () => {
  const a = createNpc({ npcID: 'npc_001', controlledBy: 'p1', linkedImprintId: 'omen_004', floor: 'ground', x: 0, y: 0, stats: makeNpcStats() });
  const b = createNpc({ npcID: 'npc_001', controlledBy: 'p1', linkedImprintId: 'omen_004', floor: 'ground', x: 0, y: 0, stats: makeNpcStats() });
  expect(a.playerId).not.toBe(b.playerId);
});

test('createNpc throws MISSING_STAT_DEFINITION for an incomplete stats object, same validation as createPlayer', () => {
  const stats = makeNpcStats();
  delete stats.speed;
  expect(() =>
    createNpc({ npcID: 'npc_001', controlledBy: 'p1', linkedImprintId: 'omen_004', floor: 'ground', x: 0, y: 0, stats })
  ).toThrow('MISSING_STAT_DEFINITION');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/playerEntity.test.js -t "createNpc" -v`
Expected: FAIL，`createNpc is not a function` 或 `TypeError`

- [ ] **Step 3: 實作 `buildStatTracks` 共用函式並改寫 `createPlayer`**

在 `server/src/game/playerEntity.js` 裡，把第 14-41 行的 `createPlayer` 開頭那段驗證＋組裝 `statTracks` 的邏輯抽出來：

```javascript
function buildStatTracks(stats) {
  for (const stat of STATS) {
    const def = stats[stat];
    if (!def || !isValidTrackShape(def.track)) {
      throw new Error('MISSING_STAT_DEFINITION');
    }
    if (!isNonDecreasing(def.track)) {
      throw new Error('INVALID_STAT_TRACK');
    }
    if (!Number.isInteger(def.skullIndex) || def.skullIndex < 0 || def.skullIndex >= def.track.length) {
      throw new Error('INVALID_SKULL_INDEX');
    }
    if (!Number.isInteger(def.baseIndex) || def.baseIndex < 0 || def.baseIndex >= def.track.length) {
      throw new Error('INVALID_BASE_INDEX');
    }
  }
  const statTracks = {};
  for (const stat of STATS) {
    const def = stats[stat];
    statTracks[stat] = {
      track: def.track.slice(),
      currentIndex: def.baseIndex,
      baseIndex: def.baseIndex,
      skullIndex: def.skullIndex,
      overflow: 0,
    };
  }
  return statTracks;
}

function createPlayer({ playerId, name, characterId, floor, x, y, stats, actionPoints }) {
  const statTracks = buildStatTracks(stats);
  return {
    playerId,
    name,
    characterId: characterId || null,
    floor,
    x,
    y,
    stats: statTracks,
    actionPoints,
    inventory: [],
    visitedRooms: [{ floor, x, y }],
    enteredFromSide: null,
    previousPosition: null,
    wieldedWeaponId: null,
    wornGearIds: [],
    pendingStatReverts: [],
  };
}

function generateNpcInstanceId() {
  return 'npc_' + Math.random().toString(36).slice(2, 10);
}

function createNpc({ npcID, controlledBy, linkedImprintId, floor, x, y, stats }) {
  const statTracks = buildStatTracks(stats);
  return {
    playerId: generateNpcInstanceId(),
    isNPC: true,
    npcID,
    controlledBy,
    linkedImprintId,
    floor,
    x,
    y,
    stats: statTracks,
    actionPoints: 0,
    inventory: [],
    phaseLocked: false,
  };
}
```

在檔案底部的 `module.exports` 加入 `createNpc`：

```javascript
module.exports = {
  STATS,
  createPlayer,
  createNpc,
  changeStat,
  resetActionPoints,
  movePlayerTo,
  getStatValue,
  isBelowBase,
  addItem,
  removeItem,
  clearEquipStateIfNeeded,
};
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/playerEntity.test.js -v`
Expected: PASS，包含新增的 3 個測試以及所有既有 `createPlayer` 相關測試（`buildStatTracks` 重構不能改變 `createPlayer` 的既有行為）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/playerEntity.js server/test/game/playerEntity.test.js
git commit -m "feat: add createNpc factory, sharing stat-track validation with createPlayer"
```

---

### Task 2: `phaseFlow.js` 新增 `resolveActingEntity`，移除 NPC 拒絕檢查

**Files:**
- Modify: `server/src/game/phaseFlow.js`
- Test: `server/test/game/phaseFlow.test.js`

**Interfaces:**
- Consumes: `getPlayer(gameState, playerId)`（已有的 `require('./gameState')`）
- Produces: `resolveActingEntity(gameState, callerId, actingAsNpcId)` → 沒有 `actingAsNpcId` 時回傳 `callerId`；有的話驗證該 NPC 存在、`isNPC:true`、`controlledBy === callerId`，通過回傳該 NPC 自己的 `playerId`，否則丟 `NPC_NOT_CONTROLLED_BY_YOU`。`requirePhase`／`lockPlayerPhase` 不再對 `player.isNPC` 特殊處理，後續任務（Task 3／Task 5）會直接把 `resolveActingEntity` 回傳的 NPC id 當作這兩支函式的 `playerId` 參數使用。

**目前 `requirePhase`／`lockPlayerPhase` 的 NPC 拒絕檢查即將移除**：這兩支函式現在對 `player.isNPC` 一律丟 `NOT_YOUR_PHASE`，這是骨架階段刻意留下、後續要拆掉的擋板（見 `phaseFlow.js:95-101`／`117-121` 的既有註解）。移除後，`requirePhase`／`lockPlayerPhase` 對任何 `playerId`（不論是不是 NPC）都只單純比對階段/鎖定狀態——因為授權（這個呼叫者是否真的有資格操作這個 id）已經由 `resolveActingEntity` 在更上層做完。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/phaseFlow.test.js`，先找到頂端的 `require` 行，加入 `resolveActingEntity`：

```javascript
const { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase, requirePhase, resolveActingEntity } = require('../../src/game/phaseFlow');
```

刪除第 142-147 行的既有測試（下一步會確認它現在應該通過而非拋錯）：

```javascript
test('requirePhase throws NOT_YOUR_PHASE for an NPC player even if currentPhase matches expectedPhase', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  gameState.players.get('p1').isNPC = true;
  expect(() => requirePhase(gameState, 'p1', 'player_move')).toThrow('NOT_YOUR_PHASE');
});
```

刪除第 111-115 行的既有測試（`lockPlayerPhase throws NOT_YOUR_PHASE when called during an NPC phase`）——這個檢查本來是用「目前是不是 NPC 階段」硬擋所有呼叫者，NPC 階段本身仍然要有正常的階段/鎖定檢查，但不再是「一律拒絕」，下一步的新測試會取代它。

新增以下測試（放在 `requirePhase`／`lockPlayerPhase` 既有測試群組附近）：

```javascript
test('requirePhase and lockPlayerPhase treat an NPC playerId exactly like a real player once phase/lock match', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.players.set('npc_1', { playerId: 'npc_1', isNPC: true, controlledBy: 'p1', phaseLocked: false });
  gameState.currentPhase = 'npc_move';
  expect(() => requirePhase(gameState, 'npc_1', 'npc_move')).not.toThrow();
  expect(() => lockPlayerPhase(gameState, 'npc_1')).not.toThrow();
  expect(gameState.players.get('npc_1').phaseLocked).toBe(true);
});

test('resolveActingEntity returns the caller\'s own id when actingAsNpcId is not given', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  expect(resolveActingEntity(gameState, 'p1', undefined)).toBe('p1');
  expect(resolveActingEntity(gameState, 'p1', null)).toBe('p1');
});

test('resolveActingEntity returns the NPC\'s own id when it is controlled by the caller', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.players.set('npc_1', { playerId: 'npc_1', isNPC: true, controlledBy: 'p1' });
  expect(resolveActingEntity(gameState, 'p1', 'npc_1')).toBe('npc_1');
});

test('resolveActingEntity throws NPC_NOT_CONTROLLED_BY_YOU for an NPC controlled by someone else', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  gameState.players.set('npc_1', { playerId: 'npc_1', isNPC: true, controlledBy: 'p2' });
  expect(() => resolveActingEntity(gameState, 'p1', 'npc_1')).toThrow('NPC_NOT_CONTROLLED_BY_YOU');
});

test('resolveActingEntity throws NPC_NOT_CONTROLLED_BY_YOU for a non-existent NPC id', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  expect(() => resolveActingEntity(gameState, 'p1', 'no_such_npc')).toThrow('NPC_NOT_CONTROLLED_BY_YOU');
});

test('resolveActingEntity throws NPC_NOT_CONTROLLED_BY_YOU when actingAsNpcId points at a real player, not an NPC', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  expect(() => resolveActingEntity(gameState, 'p1', 'p2')).toThrow('NPC_NOT_CONTROLLED_BY_YOU');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/phaseFlow.test.js -v`
Expected: 新增的 `resolveActingEntity` 測試 FAIL（函式不存在）；`requirePhase and lockPlayerPhase treat an NPC playerId...` 這個測試也會 FAIL（目前仍會丟 `NOT_YOUR_PHASE`）

- [ ] **Step 3: 實作**

在 `server/src/game/phaseFlow.js`，刪除 `lockPlayerPhase`（第 92-109 行）裡的這段：

```javascript
  if (isNpcPhase(phase) || player.isNPC) {
    // Real players never act during an NPC phase, and an NPC entity has no
    // socket connection of its own to call this from -- NPC-phase locking
    // (an owner locking their controlled NPC) is Handover item 8's "NPC 回合
    // 的操控權授權" piece, deliberately deferred, see the design doc.
    throw new Error('NOT_YOUR_PHASE');
  }
```

改成：

```javascript
  if (phase !== (player.isNPC ? gameState.currentPhase : phase)) {
    // unreachable no-op left intentionally out -- see replacement below
  }
```

（上面這段不要寫進程式碼，只是說明思路：`lockPlayerPhase` 原本已經沒有另外檢查 `gameState.currentPhase !== phase`，因為 `phase` 本來就是從 `gameState.currentPhase` 讀出來的，這行 if 本來就恆真/多餘。正確作法是把整個 `if (isNpcPhase(phase) || player.isNPC) { throw ... }` 區塊直接刪除，不用任何替代邏輯。）

刪除後的 `lockPlayerPhase` 應該長這樣：

```javascript
function lockPlayerPhase(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const phase = gameState.currentPhase;
  if (player.phaseLocked) {
    throw new Error('ALREADY_LOCKED');
  }
  player.phaseLocked = true;
  if (allParticipantsLocked(gameState, phase)) {
    advancePhase(gameState);
  }
}
```

同樣地，`requirePhase` 改成：

```javascript
function requirePhase(gameState, playerId, expectedPhase) {
  const player = requirePlayer(gameState, playerId);
  if (gameState.currentPhase !== expectedPhase) {
    throw new Error('NOT_YOUR_PHASE');
  }
  if (player.phaseLocked) {
    throw new Error('ALREADY_LOCKED');
  }
}
```

（原本 `if (player.isNPC || gameState.currentPhase !== expectedPhase)` 拿掉 `player.isNPC ||` 這半段即可。）

`isNpcPhase` 函式（第 14-16 行）在拿掉 `lockPlayerPhase` 那段之後不再被 `lockPlayerPhase` 呼叫，但仍被 `getParticipants`（第 27-33 行）使用，**保留不動**。

在檔案裡新增 `resolveActingEntity` 函式（放在 `requirePhase` 之後、`module.exports` 之前）：

```javascript
// Authorization boundary for NPC-driven actions -- socketHandlers.js calls
// this once per relevant event with the caller's own (trusted, from
// socket.data) playerId and the optional actingAsNpcId from the payload,
// then treats the returned id as "the playerId this action applies to" for
// every existing function below (requirePhase/lockPlayerPhase/turnFlow.js's
// moveToRoom/selectAction, or npcFlow.js for an NPC). Those functions no
// longer need their own isNPC check -- this is the only place that decides
// whether a caller is allowed to act as a given NPC.
function resolveActingEntity(gameState, callerId, actingAsNpcId) {
  if (!actingAsNpcId) {
    return callerId;
  }
  const npc = getPlayer(gameState, actingAsNpcId);
  if (!npc || !npc.isNPC || npc.controlledBy !== callerId) {
    throw new Error('NPC_NOT_CONTROLLED_BY_YOU');
  }
  return actingAsNpcId;
}
```

更新 `module.exports`：

```javascript
module.exports = { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase, requirePhase, resolveActingEntity };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/phaseFlow.test.js -v`
Expected: PASS，全部測試（含既有的、非 NPC 相關的 `requirePhase`/`lockPlayerPhase` 測試都要維持通過）

- [ ] **Step 5: 執行完整測試套件確認沒有連鎖破壞**

Run: `cd server && npm test`
Expected: 除了本檔案，其餘測試也應維持全綠（`requirePhase`/`lockPlayerPhase` 目前的呼叫者都是傳真人 `playerId`，`player.isNPC` 對他們來說本來就是 `undefined`/falsy，移除這個檢查不影響任何既有呼叫路徑的行為）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/phaseFlow.js server/test/game/phaseFlow.test.js
git commit -m "feat: add resolveActingEntity, remove requirePhase/lockPlayerPhase's blanket NPC rejection"
```

---

### Task 3: 新增 `npcFlow.js`（NPC 移動／道具邏輯）

**Files:**
- Create: `server/src/game/npcFlow.js`
- Test: `server/test/game/npcFlow.test.js`

**Interfaces:**
- Consumes: `getPlayer`（`./gameState`）、`requirePhase`（`./phaseFlow`，Task 2 已移除 isNPC 檢查，可以直接用 NPC 自己的 `playerId` 呼叫）、`coordKey`／`DIRECTION_DELTA`／`canMoveBetween`（`./boardGenerator`）
- Produces: `moveNpc(gameState, npcId, direction)` → `{ kind: 'move', x, y }`；`npcItemAction(gameState, npcId, itemId, mode)`（`mode` 為 `'pickup'` 或 `'leave'`）→ `{ kind: 'item', mode, itemId }`。兩者都內部呼叫 `requirePhase(gameState, npcId, 'npc_move')`，丟出的錯誤碼跟真人玩家完全共用（`NOT_YOUR_PHASE`／`ALREADY_LOCKED`／`PLAYER_NOT_FOUND`），加上這個任務新增的 `INVALID_MOVE_DIRECTION`／`ITEM_NOT_IN_ROOM`／`ITEM_NOT_HELD`／`NPC_INVENTORY_FULL`。

- [ ] **Step 1: 寫失敗測試**

Create `server/test/game/npcFlow.test.js`:

```javascript
const { createGameState, addPlayer, getPlayer } = require('../../src/game/gameState');
const { createNpc } = require('../../src/game/playerEntity');
const { enterPhase } = require('../../src/game/phaseFlow');
const { moveNpc, npcItemAction } = require('../../src/game/npcFlow');

function makeStats() {
  return {
    might: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
    speed: { track: [2, 3, 4], baseIndex: 1, skullIndex: 0 },
    knowledge: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
  };
}

function makeGameStateWithNpc() {
  const startingRooms = [
    { id: 'room_lobby_b', floor: 'ground' },
    { id: 'room_lobby_a', floor: 'ground' },
    { id: 'room_lobby_c', floor: 'ground' },
    { id: 'room_upper_landing', floor: 'upper' },
    { id: 'room_basement_landing', floor: 'basement' },
  ];
  const gameState = createGameState(startingRooms, [], {});
  const controller = addPlayer(gameState, { playerId: 'p1', name: 'Alice', characterId: 'char_001', stats: makeStats() });
  const npc = createNpc({ npcID: 'npc_001', controlledBy: 'p1', linkedImprintId: 'omen_004', floor: controller.floor, x: controller.x, y: controller.y, stats: makeStats() });
  npc.actionPoints = 2;
  gameState.players.set(npc.playerId, npc);
  enterPhase(gameState, 'npc_move');
  return { gameState, controller, npc };
}

test('moveNpc moves into an already-placed neighbor room and spends 1 of the NPC\'s own actionPoints', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  // room_lobby_a (0,1) has a north door to room_lobby_b (0,0) -- see boardGenerator.js createBoard.
  const result = moveNpc(gameState, npc.playerId, 'north');
  expect(result).toEqual({ kind: 'move', x: 0, y: 0 });
  expect(npc.x).toBe(0);
  expect(npc.y).toBe(0);
  expect(npc.actionPoints).toBe(1);
});

test('moveNpc throws INVALID_MOVE_DIRECTION toward a direction with no placed neighbor (never opens a door)', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  // room_lobby_a has doorSides ['north','east','west'] but only north (room_lobby_b) is placed.
  expect(() => moveNpc(gameState, npc.playerId, 'east')).toThrow('INVALID_MOVE_DIRECTION');
});

test('moveNpc throws NOT_ENOUGH_ACTION_POINTS -- reuses NOT_ENOUGH_ACTION_POINTS via requirePhase\'s AP check', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  npc.actionPoints = 0;
  expect(() => moveNpc(gameState, npc.playerId, 'north')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});

test('moveNpc throws NOT_YOUR_PHASE outside npc_move', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  gameState.currentPhase = 'player_move';
  expect(() => moveNpc(gameState, npc.playerId, 'north')).toThrow('NOT_YOUR_PHASE');
});

test('npcItemAction mode:pickup picks up a room-dropped item into the NPC\'s own inventory', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  const room = gameState.board[npc.floor].get(`${npc.x},${npc.y}`);
  room.droppedItems.push({ id: 'item_003' });
  const result = npcItemAction(gameState, npc.playerId, 'item_003', 'pickup');
  expect(result).toEqual({ kind: 'item', mode: 'pickup', itemId: 'item_003' });
  expect(npc.inventory).toEqual([{ id: 'item_003' }]);
  expect(room.droppedItems).toEqual([]);
  expect(npc.actionPoints).toBe(1);
});

test('npcItemAction mode:pickup throws NPC_INVENTORY_FULL when the NPC already carries 1 item', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  npc.inventory.push({ id: 'item_002' });
  const room = gameState.board[npc.floor].get(`${npc.x},${npc.y}`);
  room.droppedItems.push({ id: 'item_003' });
  expect(() => npcItemAction(gameState, npc.playerId, 'item_003', 'pickup')).toThrow('NPC_INVENTORY_FULL');
});

test('npcItemAction mode:pickup throws ITEM_NOT_IN_ROOM when the item isn\'t there (e.g. someone else already took it)', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  expect(() => npcItemAction(gameState, npc.playerId, 'item_003', 'pickup')).toThrow('ITEM_NOT_IN_ROOM');
});

test('npcItemAction mode:leave drops a carried item back into the current room', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  npc.inventory.push({ id: 'item_003' });
  const result = npcItemAction(gameState, npc.playerId, 'item_003', 'leave');
  expect(result).toEqual({ kind: 'item', mode: 'leave', itemId: 'item_003' });
  expect(npc.inventory).toEqual([]);
  const room = gameState.board[npc.floor].get(`${npc.x},${npc.y}`);
  expect(room.droppedItems).toEqual([{ id: 'item_003' }]);
});

test('npcItemAction mode:leave throws ITEM_NOT_HELD when the NPC isn\'t carrying that item', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  expect(() => npcItemAction(gameState, npc.playerId, 'item_003', 'leave')).toThrow('ITEM_NOT_HELD');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/npcFlow.test.js -v`
Expected: FAIL，`Cannot find module '../../src/game/npcFlow'`

- [ ] **Step 3: 實作**

Create `server/src/game/npcFlow.js`:

```javascript
const { getPlayer } = require('./gameState');
const { requirePhase } = require('./phaseFlow');
const { coordKey, DIRECTION_DELTA, canMoveBetween } = require('./boardGenerator');

const NPC_INVENTORY_CAP = 1;

function requireNpc(gameState, npcId) {
  const npc = getPlayer(gameState, npcId);
  if (!npc) {
    throw new Error('PLAYER_NOT_FOUND');
  }
  return npc;
}

function getRoomAt(gameState, floor, x, y) {
  return gameState.board[floor].get(coordKey(x, y));
}

function moveNpc(gameState, npcId, direction) {
  const npc = requireNpc(gameState, npcId);
  requirePhase(gameState, npcId, 'npc_move');
  if (npc.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const room = getRoomAt(gameState, npc.floor, npc.x, npc.y);
  const doorSides = Array.isArray(room.doorSides) ? room.doorSides : [];
  if (
    !doorSides.includes(direction) ||
    !canMoveBetween(gameState.board, npc.floor, { x: npc.x, y: npc.y }, direction)
  ) {
    // NPCs only ever move into an already-placed neighbor room -- never open
    // a new door, regardless of whether the room deck has cards left. Same
    // restriction the old moveSummon enforced.
    throw new Error('INVALID_MOVE_DIRECTION');
  }
  const delta = DIRECTION_DELTA[direction];
  npc.x += delta.dx;
  npc.y += delta.dy;
  npc.actionPoints -= 1;
  return { kind: 'move', x: npc.x, y: npc.y };
}

function npcItemAction(gameState, npcId, itemId, mode) {
  const npc = requireNpc(gameState, npcId);
  requirePhase(gameState, npcId, 'npc_move');
  if (npc.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const room = getRoomAt(gameState, npc.floor, npc.x, npc.y);
  if (mode === 'leave') {
    const index = npc.inventory.findIndex((item) => item.id === itemId);
    if (index === -1) {
      throw new Error('ITEM_NOT_HELD');
    }
    const [item] = npc.inventory.splice(index, 1);
    room.droppedItems.push(item);
    npc.actionPoints -= 1;
    return { kind: 'item', mode: 'leave', itemId };
  }
  // mode === 'pickup'
  if (npc.inventory.length >= NPC_INVENTORY_CAP) {
    throw new Error('NPC_INVENTORY_FULL');
  }
  const index = room.droppedItems.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_IN_ROOM');
  }
  const [item] = room.droppedItems.splice(index, 1);
  npc.inventory.push(item);
  npc.actionPoints -= 1;
  return { kind: 'item', mode: 'pickup', itemId };
}

module.exports = { moveNpc, npcItemAction };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/npcFlow.test.js -v`
Expected: PASS，全部 9 個測試

- [ ] **Step 5: Commit**

```bash
git add server/src/game/npcFlow.js server/test/game/npcFlow.test.js
git commit -m "feat: add npcFlow.js for NPC movement and item pickup/leave"
```

---

### Task 4: NPC 建立（`create_npc` 效果、`npcs.json` 內容載入、`remove_imprint` 連動移除）

**Files:**
- Modify: `server/src/game/contentLoader.js`
- Modify: `server/src/index.js`
- Modify: `server/src/game/effectResolver.js`
- Modify: `data/cards/omen-cards.json`
- Test: `server/test/game/effectResolver.test.js`
- Test: `server/test/socketHandlers.test.js`（`makeContent` 輔助函式）

**Interfaces:**
- Consumes: `createNpc`（Task 1，`./playerEntity`）
- Produces: `HANDLERS.create_npc` 效果類型，讀 `context.npcCatalog`（`{npcID, stats, ...}` 陣列，即 `data/characters/npcs.json` 的內容）＋ `effect.npcID`／`effect.linkedImprintId`，建立 NPC 加進 `gameState.players`。`handleRemoveImprint` 新增：移除的銘印若是某個 NPC 的 `linkedImprintId`（且該 NPC 由同一位玩家操控），連動刪除該 NPC（背包裡的道具掉落在 NPC 當時所在房間）。

- [ ] **Step 1: `contentLoader.js` 新增 `loadNpcs`**

在 `server/src/game/contentLoader.js`，`loadCharacters` 函式（第 23-25 行）之後新增：

```javascript
function loadNpcs(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'characters', 'npcs.json'));
}
```

`module.exports` 加入 `loadNpcs`：

```javascript
module.exports = {
  loadRooms,
  loadStartingRooms,
  loadCharacters,
  loadNpcs,
  loadEventCards,
  loadItemCards,
  loadOmenCards,
  DEFAULT_DATA_DIR,
};
```

在 `server/src/index.js`，`require` 區塊（第 7-14 行）加入 `loadNpcs`，`content` 物件（第 22-31 行）加入 `npcs: loadNpcs()`：

```javascript
const {
  loadCharacters,
  loadNpcs,
  loadRooms,
  loadStartingRooms,
  loadEventCards,
  loadItemCards,
  loadOmenCards,
} = require('./game/contentLoader');
...
const content = {
  characters: loadCharacters(),
  npcs: loadNpcs(),
  rooms: loadRooms(),
  startingRooms: loadStartingRooms(),
  cards: {
    events: loadEventCards(),
    items: loadItemCards(),
    omens: loadOmenCards(),
  },
};
```

- [ ] **Step 2: 執行伺服器啟動的既有測試確認沒有連鎖破壞**

Run: `cd server && npm test`
Expected: 全綠（這步純新增讀取，沒有任何既有程式碼路徑被改動）

- [ ] **Step 3: Commit（先獨立提交內容載入這塊，方便之後回溯）**

```bash
git add server/src/game/contentLoader.js server/src/index.js
git commit -m "feat: load data/characters/npcs.json into content.npcs"
```

- [ ] **Step 4: 寫失敗測試——`create_npc` 效果**

在 `server/test/game/effectResolver.test.js`，刪除第 546-609 行全部 5 個 `switch_control` 測試（`creates player.summons` / `SUMMON_ALREADY_USED_THIS_TURN` / `SUMMON_ALREADY_ACTIVE` / 兩個 `INVALID_SWITCH_CONTROL_EFFECT`），改成：

```javascript
function makeNpcCatalog() {
  return [{
    npcID: 'npc_001',
    stats: {
      might: { track: [1], baseIndex: 0, skullIndex: 0 },
      speed: { track: [6], baseIndex: 0, skullIndex: 0 },
      knowledge: { track: [1], baseIndex: 0, skullIndex: 0 },
      sanity: { track: [1], baseIndex: 0, skullIndex: 0 },
    },
  }];
}

test('resolveEffects create_npc adds a new NPC entity to gameState.players at the player\'s current position', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.floor = 'ground';
  player.x = 3;
  player.y = -2;
  const before = gameState.players.size;
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'create_npc', npcID: 'npc_001', linkedImprintId: 'omen_004' },
  ], { npcCatalog: makeNpcCatalog() });
  expect(gameState.players.size).toBe(before + 1);
  const npc = [...gameState.players.values()].find((p) => p.isNPC);
  expect(npc.npcID).toBe('npc_001');
  expect(npc.controlledBy).toBe('p1');
  expect(npc.linkedImprintId).toBe('omen_004');
  expect(npc.floor).toBe('ground');
  expect(npc.x).toBe(3);
  expect(npc.y).toBe(-2);
});

test('resolveEffects create_npc throws UNKNOWN_NPC_ID when npcID isn\'t in the catalog', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [
      { type: 'create_npc', npcID: 'no_such_npc', linkedImprintId: 'omen_004' },
    ], { npcCatalog: makeNpcCatalog() })
  ).toThrow('UNKNOWN_NPC_ID');
});
```

在同檔案第 362-370 行的既有測試（`remove_imprint removes an imprint with a non-stat_change effect without crashing`），把內嵌的 `omenCatalog` fixture 從 `switch_control` 改成 `create_npc`，維持這個測試原本「移除一個非 stat_change 效果的銘印時不會壞掉/不會誤套用效果」的意圖：

```javascript
test('resolveEffects remove_imprint removes an imprint with a non-stat_change effect without crashing or applying anything', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'omen_004' });
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_imprint' },
  ], { omenCatalog: [{ id: 'omen_004', category: 'imprint', effects: [{ type: 'create_npc', npcID: 'npc_001', linkedImprintId: 'omen_004' }] }] });
  expect(player.inventory).toEqual([]);
});
```

新增 `remove_imprint` 的 NPC 連動移除測試（放在上面那個測試之後）：

```javascript
test('resolveEffects remove_imprint deletes the controller\'s NPC when the removed imprint matches its linkedImprintId', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'omen_004' });
  gameState.players.set('npc_1', {
    playerId: 'npc_1', isNPC: true, controlledBy: 'p1', linkedImprintId: 'omen_004',
    floor: 'ground', x: 0, y: 0, inventory: [{ id: 'item_003' }],
  });
  const room = { roomId: 'room_test', droppedItems: [] };
  gameState.board = { ground: new Map([['0,0', room]]) };

  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_imprint' },
  ], { omenCatalog: [{ id: 'omen_004', category: 'imprint', effects: [{ type: 'create_npc', npcID: 'npc_001', linkedImprintId: 'omen_004' }] }] });

  expect(gameState.players.has('npc_1')).toBe(false);
  expect(room.droppedItems).toEqual([{ id: 'item_003' }]); // carried item dropped where the NPC stood
});

test('resolveEffects remove_imprint leaves an NPC alone when the removed imprint is a different card', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'omen_005' });
  gameState.players.set('npc_1', {
    playerId: 'npc_1', isNPC: true, controlledBy: 'p1', linkedImprintId: 'omen_004',
    floor: 'ground', x: 0, y: 0, inventory: [],
  });
  gameState.board = { ground: new Map([['0,0', { roomId: 'room_test', droppedItems: [] }]]) };

  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_imprint' },
  ], { omenCatalog: [{ id: 'omen_005', category: 'imprint', effects: [{ type: 'stat_change', stat: 'speed', delta: 1 }] }] });

  expect(gameState.players.has('npc_1')).toBe(true);
});
```

- [ ] **Step 5: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "create_npc" -v`
Run: `cd server && npx jest test/game/effectResolver.test.js -t "remove_imprint" -v`
Expected: `create_npc` 測試 FAIL（`UNSUPPORTED_EFFECT_TYPE`）；新增的 2 個 `remove_imprint` NPC 測試 FAIL

- [ ] **Step 6: 實作 `handleCreateNpc`，刪除 `handleSwitchControl`**

在 `server/src/game/effectResolver.js` 頂端 `require` 區塊（第 2 行），加入 `createNpc`：

```javascript
const { changeStat, addItem, removeItem, getStatValue, movePlayerTo, STATS, isBelowBase, createNpc } = require('./playerEntity');
```

刪除 `handleSwitchControl`（第 328-352 行）整個函式，改成：

```javascript
function handleCreateNpc(gameState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const npcCatalog = (context && context.npcCatalog) || [];
  const npcData = npcCatalog.find((n) => n.npcID === effect.npcID);
  if (!npcData) {
    throw new Error('UNKNOWN_NPC_ID');
  }
  const npc = createNpc({
    npcID: effect.npcID,
    controlledBy: playerId,
    linkedImprintId: effect.linkedImprintId,
    floor: player.floor,
    x: player.x,
    y: player.y,
    stats: npcData.stats,
  });
  gameState.players.set(npc.playerId, npc);
  return { pending: false };
}
```

在 `handleRemoveImprint`（第 132-156 行）的 `removeItem(player, chosenId);`（第 146 行）之後，新增 NPC 連動移除：

```javascript
  removeItem(player, chosenId);
  for (const [npcId, npc] of gameState.players) {
    if (npc.isNPC && npc.controlledBy === playerId && npc.linkedImprintId === chosenId) {
      const npcRoom = gameState.board[npc.floor].get(coordKey(npc.x, npc.y));
      for (const item of npc.inventory) {
        npcRoom.droppedItems.push(item);
      }
      gameState.players.delete(npcId);
      break; // at most one NPC per imprint instance
    }
  }
```

在 `HANDLERS` 對照表（第 543-570 行），把 `switch_control:` 那一行（第 563 行）改成：

```javascript
  create_npc: (gameState, promptState, playerId, effect, context) => handleCreateNpc(gameState, playerId, effect, context),
```

- [ ] **Step 7: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -v`
Expected: PASS，包含新增的 4 個測試（`create_npc` x2、`remove_imprint` NPC 連動 x2）跟改寫過的 fixture 測試

- [ ] **Step 8: 更新 `omen_004` 資料與其驗證測試**

在 `data/cards/omen-cards.json`，把 `omen_004` 的 `effects`（第 34-38 行）改成：

```json
    "effects": [
      { "type": "stat_change", "stat": "might", "delta": 1 },
      { "type": "stat_change", "stat": "sanity", "delta": 1 },
      { "type": "create_npc", "npcID": "npc_001", "linkedImprintId": "omen_004" }
    ],
```

在 `server/test/game/effectResolver.test.js` 第 1868-1881 行的驗證測試，改成：

```javascript
test('omen_004 (獵犬) in data/cards/omen-cards.json has the passive might/sanity bonus alongside create_npc', () => {
  const omenCards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/cards/omen-cards.json'), 'utf8'));
  const omen004 = omenCards.find((c) => c.id === 'omen_004');
  expect(omen004).toBeDefined();
  expect(omen004.effects).toEqual([
    { type: 'stat_change', stat: 'might', delta: 1 },
    { type: 'stat_change', stat: 'sanity', delta: 1 },
    { type: 'create_npc', npcID: 'npc_001', linkedImprintId: 'omen_004' },
  ]);
});
```

- [ ] **Step 9: `socketHandlers.test.js` 的 `makeContent` 新增 `npcs` 預設值**

在 `server/test/socketHandlers.test.js`，`makeContent`（第 13-30 行）的回傳物件加一個欄位，跟 `characters`/`rooms` 同一層：

```javascript
function makeContent(overrides = {}) {
  return {
    characters: [ ... 既有內容不動 ... ],
    npcs: [],
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    ...(既有其餘欄位不動)
    ...overrides,
  };
}
```

- [ ] **Step 10: 執行完整測試套件確認沒有連鎖破壞**

Run: `cd server && npm test`
Expected: 全綠（`npcs: []` 是新增的預設空陣列，任何沒有明確傳 `npcs` overrides 的既有測試都不受影響；`content.npcs` 是全新欄位，沒有既有程式碼讀它）

- [ ] **Step 11: Commit**

```bash
git add server/src/game/effectResolver.js data/cards/omen-cards.json server/test/game/effectResolver.test.js server/test/socketHandlers.test.js
git commit -m "feat: replace switch_control with create_npc, wire NPC cleanup into remove_imprint"
```

---

### Task 5: `socketHandlers.js` 接上 `actingAsNpcId`

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `resolveActingEntity`（Task 2，`./game/phaseFlow`）、`moveNpc`／`npcItemAction`（Task 3，`./game/npcFlow`）
- Produces: `game:move`／`game:selectAction`（`mode:'pickup'/'leave'` 限定）／`game:lockPhase`（含別名 `game:endTurn`）payload 支援可選的 `actingAsNpcId` 欄位。同時刪除這三個 handler 裡舊的 `if (player.summons)` 分支（連同它們呼叫的 `moveSummon`/`selectSummonAction`，改由 `actingAsNpcId` 分支取代）。

- [ ] **Step 1: 寫失敗測試——刪除舊 4 個 switch_control 整合測試，新增 `actingAsNpcId` 測試**

在 `server/test/socketHandlers.test.js`，刪除第 4810 行附近起「an omen card is drawn but doesn't seize control」到第 4934 行「game:selectAction actionType:dissipate...」共 4 個測試（正確範圍：從描述 omen_004 抽卡不觸發控制的測試開頭，到 `actionType:dissipate` 測試結尾，即前面查證過的 4 段：`player.summons` 相關的 draw／use／move／dissipate 測試）。

新增以下測試（沿用檔案既有的 `setUpStartedGameWithContent`／`makeContent` 慣例）：

```javascript
function makeNpcContent(overrides = {}) {
  return makeContent({
    npcs: [{
      npcID: 'npc_001',
      stats: {
        might: { track: [1], baseIndex: 0, skullIndex: 0 },
        speed: { track: [6], baseIndex: 0, skullIndex: 0 },
        knowledge: { track: [1], baseIndex: 0, skullIndex: 0 },
        sanity: { track: [1], baseIndex: 0, skullIndex: 0 },
      },
    }],
    cards: {
      events: [], items: [],
      omens: [{ id: 'omen_004', name: '犬靈', category: 'imprint', activatedOnUse: true, effects: [{ type: 'create_npc', npcID: 'npc_001', linkedImprintId: 'omen_004' }] }],
    },
    ...overrides,
  });
}

test('game:selectAction using omen_004 creates a controllable NPC at the player\'s position', async () => {
  const content = makeNpcContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_004' });

  const result = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve)
  );
  expect(result.error).toBeUndefined();
  const npc = gameState.players.get([...gameState.players.keys()].find((id) => gameState.players.get(id).isNPC));
  expect(npc.controlledBy).toBe(currentPlayerId);
  expect(npc.floor).toBe(player.floor);
  expect(npc.x).toBe(player.x);
  expect(npc.y).toBe(player.y);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move with actingAsNpcId moves the controlled NPC, leaving the real player\'s own position untouched', async () => {
  const content = makeNpcContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_004' });
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve));
  const npc = [...gameState.players.values()].find((p) => p.isNPC);
  gameState.currentPhase = 'npc_move'; // force -- npc_move only naturally arrives after every real player locks player_move/player_interact
  const playerX = player.x;
  const playerY = player.y;

  const result = await new Promise((resolve) =>
    currentClient.emit('game:move', { direction: 'north', actingAsNpcId: npc.playerId }, resolve)
  );
  expect(result.error).toBeUndefined();
  expect(npc.x).toBe(0);
  expect(npc.y).toBe(0);
  expect(player.x).toBe(playerX);
  expect(player.y).toBe(playerY);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move with actingAsNpcId rejects an NPC not controlled by the caller', async () => {
  const content = makeNpcContent();
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_004' });
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve));
  const npc = [...gameState.players.values()].find((p) => p.isNPC);
  gameState.currentPhase = 'npc_move';

  const result = await new Promise((resolve) =>
    otherClient.emit('game:move', { direction: 'north', actingAsNpcId: npc.playerId }, resolve)
  );
  expect(result.error).toBe('NPC_NOT_CONTROLLED_BY_YOU');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction with actingAsNpcId supports mode:pickup for the controlled NPC', async () => {
  const content = makeNpcContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_004' });
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve));
  const npc = [...gameState.players.values()].find((p) => p.isNPC);
  gameState.currentPhase = 'npc_move';
  const room = gameState.board[npc.floor].get(coordKey(npc.x, npc.y));
  room.droppedItems.push({ id: 'item_003' });

  const result = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003', mode: 'pickup', actingAsNpcId: npc.playerId }, resolve)
  );
  expect(result.error).toBeUndefined();
  expect(npc.inventory).toEqual([{ id: 'item_003' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:lockPhase with actingAsNpcId locks the NPC\'s own phaseLocked, not the caller\'s', async () => {
  const content = makeNpcContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_004' });
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve));
  const npc = [...gameState.players.values()].find((p) => p.isNPC);
  gameState.currentPhase = 'npc_move';

  const result = await new Promise((resolve) =>
    currentClient.emit('game:lockPhase', { actingAsNpcId: npc.playerId }, resolve)
  );
  expect(result.error).toBeUndefined();
  expect(npc.phaseLocked).toBe(true);
  expect(player.phaseLocked).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "actingAsNpcId" -v`
Run: `cd server && npx jest test/socketHandlers.test.js -t "omen_004 creates a controllable NPC" -v`
Expected: FAIL（`actingAsNpcId` 目前完全沒有被 socketHandlers.js 讀取，`game:move`/`game:selectAction` 對 NPC id 呼叫既有邏輯會走真人玩家路徑並拋 `PLAYER_NOT_FOUND` 或類似錯誤；`create_npc` 測試在 Task 4 已經通過，這裡只是確認整合層也正常）

- [ ] **Step 3: 實作**

在 `server/src/socketHandlers.js` 頂端 `require` 區塊（第 17-19 行），更新：

```javascript
const { moveToRoom, selectAction, useStairs, resumeCollapseCheck, performTeleport, resolveTeleportDestination } = require('./game/turnFlow');
const { lockPlayerPhase, resolveActingEntity } = require('./game/phaseFlow');
const { moveNpc, npcItemAction } = require('./game/npcFlow');
const { coordKey } = require('./game/boardGenerator');
```

（`moveSummon`／`selectSummonAction` 從 `turnFlow` 的解構中移除——它們會在 Task 6 才真的從 `turnFlow.js` 刪除，這裡先移除引用是為了不留下指向即將刪除的函式的孤兒 import。）

`game:move` handler（第 165-217 行）：把第 185-192 行的 `if (player.summons) {...}` 分支整段刪除，改成在 `const { direction } = payload || {};` 之前插入：

```javascript
        const { direction, actingAsNpcId } = payload || {};
        if (actingAsNpcId) {
          const npcId = resolveActingEntity(gameState, playerId, actingAsNpcId);
          const result = moveNpc(gameState, npcId, direction);
          ack(result);
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
          return;
        }
        const player = getPlayer(gameState, playerId);
```

（原本 `const { direction } = payload || {};` 那一行整行被上面取代；原本緊接著的 `const player = getPlayer(gameState, playerId);` 保留在新分支之後，其餘既有邏輯，也就是 `moveToRoom` 呼叫那一段完全不動。）

`game:selectAction` handler：把第 239-246 行的 `if (player.summons) {...}` 分支整段刪除。原本第 239 行 `const player = getPlayer(gameState, playerId);` 要移到 NPC 分支之後，並在它之前插入：

```javascript
        const { actingAsNpcId } = payload || {};
        if (actingAsNpcId) {
          const npcId = resolveActingEntity(gameState, playerId, actingAsNpcId);
          const { itemId, mode } = payload || {};
          if (mode !== 'pickup' && mode !== 'leave') {
            return ack({ error: 'NPC_ACTION_NOT_ALLOWED' });
          }
          const result = npcItemAction(gameState, npcId, itemId, mode);
          ack(result);
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
          return;
        }
        const player = getPlayer(gameState, playerId);
```

原本第 247 行 `const { actionType, itemId, targetPlayerId, mode } = payload || {};`（真人玩家路徑自己的 payload 解構）維持不動，接在新分支之後。

`handleLockPhase` 共用函式（第 461-504 行）：把第 481-486 行的 `if (player.summons) {...}` 分支整段刪除。原本第 481 行 `const player = getPlayer(gameState, playerId);` 移到 NPC 分支之後，並在它之前插入：

```javascript
        const { actingAsNpcId } = payload || {};
        if (actingAsNpcId) {
          const npcId = resolveActingEntity(gameState, playerId, actingAsNpcId);
          lockPlayerPhase(gameState, npcId);
          ack({ currentPhase: gameState.currentPhase });
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
          return;
        }
        const player = getPlayer(gameState, playerId);
```

（NPC 分支刻意不呼叫 `applyRoomEndTurnBonus`——房間 `onceOnlyPerPlayer` 加成是真人玩家專屬機制，設計文件範圍排除明確講了 NPC 不受任何考驗/加成影響。）

`resolveEffects` 相關 context 組裝（Task 4 已確認 `context.npcCatalog` 是 `create_npc` 需要的欄位）——在 `server/src/socketHandlers.js` 裡，把每一個 `{ now: Date.now(), itemCatalog: content.cards.items, omenCatalog: content.cards.omens }`（或含 `interjectionChoice`/`sourceDeckType` 的版本）都加上 `npcCatalog: content.npcs`。查證過的 6 個位置行號（Task 4 之後行號可能因為 import 改動略有偏移，用文字搜尋 `omenCatalog: content.cards.omens` 定位，逐一修改）：

```javascript
{ now: Date.now(), itemCatalog: content.cards.items, omenCatalog: content.cards.omens, npcCatalog: content.npcs }
```

（含第 1240 行那個多帶 `interjectionChoice`/`sourceDeckType` 欄位的版本，一樣加上 `npcCatalog: content.npcs`。）

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -v`
Expected: PASS，包含 Step 1 新增的 5 個測試

- [ ] **Step 5: 執行完整測試套件**

Run: `cd server && npm test`
Expected: 全綠（`moveSummon`/`selectSummonAction` 在 `turnFlow.js` 本體還沒被刪除，此時仍然存在，只是不再被 `socketHandlers.js` 引用/呼叫——`turnFlow.test.js` 裡直接測試這兩支函式的既有測試此時仍應通過，Task 6 才會刪除它們）

- [ ] **Step 6: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: wire actingAsNpcId into game:move/game:selectAction/game:lockPhase"
```

---

### Task 6: 刪除舊召喚機制（`turnFlow.js`）

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: 無
- Produces: 無新介面，純刪除。`turnFlow.js` 的 `module.exports` 少了 `moveSummon`／`selectSummonAction`／`getCurrentTurnPlayerId`。

- [ ] **Step 1: 刪除測試**

在 `server/test/game/turnFlow.test.js`，刪除以下 13 個測試（已用行號查證，實際刪除時用測試名稱比對，因為前面任務的編輯可能讓行號略有偏移）：
- `getCurrentTurnPlayerId returns the player at the current index`
- `getCurrentTurnPlayerId throws NO_TURN_ORDER when turnOrder is missing or empty`
- `useStairs throws SUMMON_ACTIVE when the player is controlling a summon`
- `moveSummon moves the summon to an already-explored neighbor room and spends 1 of its own actionPoints`
- `moveSummon never offers open_door -- throws INVALID_MOVE_DIRECTION toward unexplored territory`
- `moveSummon throws NO_ACTIVE_SUMMON when the player has no summon`
- `moveSummon throws NOT_ENOUGH_ACTION_POINTS when the summon is out of actionPoints`
- `selectSummonAction item mode:pickup picks up a dropped item at the summon's own position, not the player's`
- `selectSummonAction item mode:pickup throws SUMMON_ALREADY_CARRYING when already holding something`
- `selectSummonAction item mode:leave drops the carried item at the summon's current room`
- `selectSummonAction actionType:dissipate clears player.summons and drops the carried item where the summon stood`
- `selectSummonAction actionType:dissipate works even when the summon has 0 actionPoints left`
- `selectSummonAction throws NO_ACTIVE_SUMMON when the player has no summon`

在檔案頂端的 `require` 解構，把 `moveSummon`／`selectSummonAction`／`getCurrentTurnPlayerId` 從清單移除（`isTurnOver` 保留——它是純讀 `actionPoints` 的獨立工具函式，不屬於這次刪除範圍）。

- [ ] **Step 2: 執行測試確認這 13 個測試已經消失、其餘測試仍在**

Run: `cd server && npx jest test/game/turnFlow.test.js -v`
Expected: PASS（此時 `moveSummon`/`selectSummonAction`/`getCurrentTurnPlayerId` 函式本體都還沒刪除，測試檔案裡已經沒有測試呼叫它們，理論上這步驟本身不會 FAIL——這一步的目的是先確認測試清單改對了，下一步才動生產程式碼）

- [ ] **Step 3: 刪除生產程式碼**

在 `server/src/game/turnFlow.js`：
- 刪除 `moveSummon` 函式（第 344-371 行）
- 刪除 `SUMMON_ITEM_MODES` 常數（第 373 行）與 `selectSummonAction` 函式（第 375-421 行）
- 刪除 `useStairs` 函式（`function useStairs`）裡的 `if (player.summons) { throw new Error('SUMMON_ACTIVE'); }`（第 639-641 行）
- 刪除 `requireTurnOrder` 函式與 `getCurrentTurnPlayerId` 函式（第 608-616 行一帶，兩個函式一起刪，`getCurrentTurnPlayerId` 是唯一呼叫 `requireTurnOrder` 的地方）
- `module.exports`（第 660-673 行）移除 `moveSummon`／`selectSummonAction`／`getCurrentTurnPlayerId` 三項，其餘（`getAvailableDirections`／`moveToRoom`／`selectAction`／`isTurnOver`／`canUseStairs`／`useStairs`／`resumeCollapseCheck`／`performTeleport`／`resolveTeleportDestination`）保留不動

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/turnFlow.test.js -v`
Expected: PASS，全部通過

- [ ] **Step 5: 死代碼檢查**

Run: `cd server && grep -rn "moveSummon\|selectSummonAction\|getCurrentTurnPlayerId\|requireTurnOrder\|player\.summons\|summonUsedThisTurn" src/`

Expected: 沒有任何輸出（如果有殘留引用，是這次刪除範圍漏掉的地方，需要一併清掉才能繼續）

- [ ] **Step 6: 執行完整測試套件**

Run: `cd server && npm test`
Expected: 全綠

- [ ] **Step 7: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "chore: delete moveSummon/selectSummonAction/getCurrentTurnPlayerId, the old summon-control mechanism"
```

---

### Task 7: 前端——操控實體切換器、NPC 專屬面板、地圖視角跟隨

**Files:**
- Create: `client/src/gameplay/NpcPanel.jsx`
- Modify: `client/src/DebugGameScreen.jsx`
- Modify: `client/src/gameplay/FocusedRoomView.jsx`

**Interfaces:**
- Consumes: 後端 `game:move`／`game:selectAction`／`game:lockPhase` 的 `actingAsNpcId` 參數（Task 5）；`game:started`/`game:stateUpdate` payload 裡 `players` 陣列已經天生包含 `isNPC`/`controlledBy`/`npcID` 欄位（`serializeGameState` 沒有過濾任何 player 欄位，不需要後端改動）；`npcContent`——**這個任務需要 `game:started` payload 多帶一個 `npcContent` 欄位**（比照現有 `characterContent`），這是本任務唯一牽動的後端小改動，見 Step 1。
- Produces: `NpcPanel({ npc, roomDroppedItems, onSelectAction })` 元件

- [ ] **Step 1: 後端補一行——`game:started` payload 帶上 `npcContent`**

在 `server/src/socketHandlers.js`，找到 `io.to(roomCode).emit('game:started', {...})`（約第 1394-1399 行），在 `characterContent: content.characters,` 旁邊加一行：

```javascript
  io.to(roomCode).emit('game:started', {
    ...serializeGameState(gameState),
    roomContent: { rooms: content.rooms, startingRooms: content.startingRooms },
    cardContent: { items: content.cards.items, events: content.cards.events, omens: content.cards.omens },
    characterContent: content.characters,
    npcContent: content.npcs,
  });
```

這一行沒有獨立的後端測試（`game:started` payload 的既有測試如果有斷言完整 payload 形狀，需要一併確認補這個欄位不會讓既有斷言失敗——執行 `cd server && npm test` 確認）。

- [ ] **Step 2: `DebugGameScreen.jsx`——接住 `npcContent`，新增操控實體狀態**

找到目前 `characterContent` 從 `game:started`/`game:stateUpdate` 存進 state 的地方（搜尋 `setCharacterContent` 或類似命名），比照新增 `npcContent`/`setNpcContent` 的 state 與存值邏輯。

新增操控實體狀態（跟其他既有 `useState` 放在一起）：

```javascript
const [actingAsNpcId, setActingAsNpcId] = useState(null);
```

- [ ] **Step 3: 改 `handleMove`／`handleSelectAction`／`handleLockPhase` 帶上 `actingAsNpcId`**

```javascript
  function handleMove(direction) {
    socket.emit('game:move', { direction, ...(actingAsNpcId ? { actingAsNpcId } : {}) }, (res) => {
      if (res && res.error) {
        console.error('[game:move]', res.error);
        setActionError(res.error);
      }
    });
  }

  function handleSelectAction(actionType, options = {}) {
    socket.emit('game:selectAction', { actionType, ...options, ...(actingAsNpcId ? { actingAsNpcId } : {}) }, (res) => {
      if (res && res.error) {
        console.error('[game:selectAction]', res.error);
        setActionError(res.error);
      }
    });
  }

  function handleLockPhase() {
    socket.emit('game:lockPhase', { ...(actingAsNpcId ? { actingAsNpcId } : {}) }, (res) => {
      if (res && res.error) {
        console.error('[game:lockPhase]', res.error);
        setActionError(res.error);
      }
    });
  }
```

- [ ] **Step 4: 用「操控中的實體」取代畫面渲染裡固定用 `me` 的地方**

第 347-368 行「Precomputed once for the playing-phase render」那段，改成：

```javascript
  let me, myNpcs, activeEntity, currentRoom, hasRoomForFloor, directions, roommates, roomActions;
  if (gameState) {
    me = gameState.players.find((p) => p.playerId === playerId);
    myNpcs = gameState.players.filter((p) => p.isNPC && p.controlledBy === playerId);
    activeEntity = actingAsNpcId ? gameState.players.find((p) => p.playerId === actingAsNpcId) : me;
    currentRoom = gameState.board[activeEntity.floor].find((r) => r.x === activeEntity.x && r.y === activeEntity.y);
    hasRoomForFloor =
      activeEntity.floor === 'ground'
        ? gameState.roomDeck.hasRoomForGround
        : activeEntity.floor === 'upper'
          ? gameState.roomDeck.hasRoomForUpper
          : gameState.roomDeck.hasRoomForBasement;
    directions = getAvailableDirections(activeEntity, currentRoom, gameState.board[activeEntity.floor]).filter(
      (d) => d.kind === 'move' || (!actingAsNpcId && hasRoomForFloor)
    );
    // Same-room players (excluding self) -- CharacterPanel's item "給予"
    // option needs this to offer a target to give to. Always about `me`'s
    // own room, unaffected by which entity is currently being controlled.
    roommates = gameState.players.filter(
      (p) => p.playerId !== playerId && p.floor === me.floor && p.x === me.x && p.y === me.y
    );
    roomActions = actingAsNpcId
      ? []
      : (roomContent ? getRoomActions(findRoomInfo(currentRoom.roomId, roomContent), currentRoom) : []);
  }
```

（`directions` 的 filter：真人玩家維持原本「`move` 種類永遠可選，`open_door` 種類要看牌堆還有沒有房間可抽」；操控 NPC 時只留 `move`，NPC 永遠不能開門，即使牌堆有房間也一樣。）

- [ ] **Step 5: `FocusedRoomView` 呼叫改傳 `activeEntity` 相關 prop，新增操控實體切換器＋條件渲染 NPC 面板**

第 448-457 行 `<FocusedRoomView>` 呼叫，`roomsInSameSpot` 判斷要跟著 `activeEntity` 走：

```javascript
                const roomsInSameSpot = gameState.players.filter(
                  (p) => p.floor === activeEntity.floor && p.x === activeEntity.x && p.y === activeEntity.y
                );

                return (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FocusedRoomView
                      currentRoom={currentRoom}
                      boardRooms={gameState.board[activeEntity.floor]}
                      roomContent={roomContent}
                      roomsInSameSpot={roomsInSameSpot}
                      allPlayers={gameState.players}
                      characterContent={characterContent}
                      npcContent={npcContent}
                      directions={directions}
                      onMove={handleMove}
                    />
                  </div>
                );
```

四角按鈕（第 462-476 行）：操控 NPC 時隱藏「房間行動」／「襲擊目標」，「階段結束」按鈕文字跟著切換：

```javascript
              {!actingAsNpcId && (
                <button
                  style={cornerButtonStyle('top-left')}
                  onClick={() => (roomActions.length > 1 ? setShowRoomActionMenu(true) : handleSelectAction('room_action'))}
                >
                  {wrapLabel('房間行動', 2)}
                </button>
              )}
              <button style={cornerButtonStyle('top-right')} onClick={() => setMapMode(mapMode === 'focused' ? 'overview' : 'focused')}>
                {wrapLabel(mapMode === 'focused' ? '筆記資訊' : '目前房間', 2)}
              </button>
              {!actingAsNpcId && (
                <button style={cornerButtonStyle('bottom-left')} onClick={() => handleSelectAction('attack')}>
                  {wrapLabel('襲擊目標', 2)}
                </button>
              )}
              <button style={cornerButtonStyle('bottom-right')} onClick={handleLockPhase}>
                {wrapLabel(actingAsNpcId ? 'NPC階段結束' : '階段結束', 2)}
              </button>
```

面板區（第 479-488 行）：新增操控實體切換器，並依 `actingAsNpcId` 決定顯示 `CharacterPanel` 還是 `NpcPanel`：

```javascript
          <div className="playing-layout__panel">
            {myNpcs.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <button onClick={() => setActingAsNpcId(null)} disabled={!actingAsNpcId}>操控：自己</button>
                {myNpcs.map((npc) => (
                  <button key={npc.playerId} onClick={() => setActingAsNpcId(npc.playerId)} disabled={actingAsNpcId === npc.playerId}>
                    操控：{npc.npcID}
                  </button>
                ))}
              </div>
            )}
            {actingAsNpcId ? (
              <NpcPanel
                npc={activeEntity}
                roomDroppedItems={currentRoom.droppedItems || []}
                onSelectAction={handleSelectAction}
              />
            ) : (
              <CharacterPanel
                player={me}
                messages={messages}
                cardContent={cardContent}
                characterContent={characterContent}
                onSelectAction={handleSelectAction}
                roommates={roommates}
              />
            )}
          </div>
```

- [ ] **Step 6: 新建 `NpcPanel.jsx`**

Create `client/src/gameplay/NpcPanel.jsx`:

```jsx
export default function NpcPanel({ npc, roomDroppedItems, onSelectAction }) {
  return (
    <div>
      <p>行動力：{npc.actionPoints}</p>
      <p>背包（上限 1 件）：</p>
      <ul>
        {npc.inventory.map((item) => (
          <li key={item.id}>
            {item.id}
            <button onClick={() => onSelectAction('item', { itemId: item.id, mode: 'leave' })}>遺留</button>
          </li>
        ))}
        {npc.inventory.length === 0 && <li>（空）</li>}
      </ul>
      <p>房間掉落物：</p>
      <ul>
        {roomDroppedItems.map((item) => (
          <li key={item.id}>
            {item.id}
            <button
              onClick={() => onSelectAction('item', { itemId: item.id, mode: 'pickup' })}
              disabled={npc.inventory.length >= 1}
            >
              拾取
            </button>
          </li>
        ))}
        {roomDroppedItems.length === 0 && <li>（無）</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: `FocusedRoomView.jsx`——icon 查找與排序支援 NPC**

第 207-211 行 `findCharacterIcon`，改成接受整個 player 物件並判斷 `isNPC`：

```javascript
function findCharacterIcon(p, characterContent, npcContent) {
  if (p.isNPC) {
    if (!npcContent || !p.npcID) return null;
    const npc = npcContent.find((n) => n.npcID === p.npcID);
    return npc?.fileicon ? `/images/${npc.fileicon}` : null;
  }
  if (!characterContent || !p.characterId) return null;
  const character = characterContent.find((c) => c.id === p.characterId);
  return character?.fileicon ? `/images/${character.fileicon}` : null;
}
```

第 213-222 行元件簽名，新增 `npcContent` prop：

```javascript
export default function FocusedRoomView({
  currentRoom,
  boardRooms,
  roomContent,
  roomsInSameSpot,
  allPlayers,
  characterContent,
  npcContent,
  directions,
  onMove,
}) {
```

第 316-329 行排序與呼叫端：

```javascript
      {(roomsInSameSpot.length >= 3
        ? [...roomsInSameSpot].sort((a, b) => {
            if (a.isNPC !== b.isNPC) return a.isNPC ? 1 : -1; // NPCs sort after every real player
            if (a.isNPC) return (a.npcID || '').localeCompare(b.npcID || '');
            return (a.characterId || '').localeCompare(b.characterId || '');
          })
        : roomsInSameSpot
      ).map((p, i) => {
        const colorIndex = allPlayers.findIndex((ap) => ap.playerId === p.playerId);
        return (
          <PlayerBadge
            key={p.playerId}
            name={p.name}
            colorIndex={colorIndex === -1 ? i : colorIndex}
            iconSrc={findCharacterIcon(p, characterContent, npcContent)}
            style={roomsInSameSpot.length >= 3 ? gridBadgeStyle(i) : badgeStyle(p.enteredFromSide, i, roomsInSameSpot.length)}
          />
        );
```

（NPC 沒有 `name` 欄位——`PlayerBadge` 的 `name={p.name}` 對 NPC 會是 `undefined`，這裡不特別處理顯示文字，NPC 的名稱顯示留給 `npcs.json` 的 `codename` 欄位由開發者之後填值時再決定要不要串接，不在這個任務範圍內，只確保不會因為欄位缺失而壞掉。）

- [ ] **Step 8: 手動驗證（Browser pane）**

依 CLAUDE.md 規則，UI 改動要在瀏覽器裡實際走一次：
1. `preview_start` 啟動 `server`（3001）＋`client`（5173）
2. 建房、雙人加入、選角、開始遊戲
3. 給其中一位玩家的背包塞入 `omen_004`（可透過除錯手段或先確認一張已知會抽到它的房間流程），使用它，確認出現「操控：npc_001」切換按鈕
4. 點擊切換按鈕，確認畫面地圖跟著切到 NPC 位置、四角按鈕「房間行動」「襲擊目標」消失、「階段結束」文字變成「NPC階段結束」
5. 確認 `npc_move` 階段時能移動 NPC、能拾取/遺留房間道具；切回「自己」時原本畫面與功能完全不受影響
6. 檢查瀏覽器 console 全程無錯誤
7. 驗證完成後停止 preview server（`preview_stop`）

- [ ] **Step 9: Commit**

```bash
git add client/src/gameplay/NpcPanel.jsx client/src/DebugGameScreen.jsx client/src/gameplay/FocusedRoomView.jsx server/src/socketHandlers.js
git commit -m "feat: add NPC control switcher, NPC panel, and NPC-aware room icon layout"
```

---

## 自我審查記錄（writing-plans 流程要求）

- **spec 涵蓋**：設計文件一～四節分別對應 Task 1+4（資料模型/生命週期）、Task 2+3+5（授權與階段整合）、Task 6（舊機制刪除）、Task 7（前端）；範圍排除項目（怪物 NPC／操控者死亡移除／NPC 受考驗）皆未出現在任何任務裡，確認沒有超出範圍
- **型別一致性**：`resolveActingEntity`（Task 2 定義）在 Task 3／5／7 皆以相同簽名 `(gameState, callerId, actingAsNpcId)` 使用；`moveNpc`/`npcItemAction`（Task 3 定義）在 Task 5 的簽名與呼叫方式一致；`createNpc`（Task 1 定義）的欄位在 Task 4 的 `handleCreateNpc` 逐一對應
- **佔位掃描**：全文搜尋過 TBD/TODO/待補等字樣，僅 Task 7 Step 7 一處「NPC 名稱顯示留給之後」是明確記錄的範圍排除，不是未完成的佔位
