# 房間圖片旋轉機制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 房間第一次被放置到地圖上時，計算一個旋轉角度，讓房間圖片裡畫死的門框位置（`canonicalDoors`）對齊這個房間實例真實的門位置（`doorSides`），並在玩家自己站在裡面看的中心房間格套用這個角度。

**Architecture:** 伺服器端在 `doorLayout.js` 新增一個純函式 `computeRotation`，在 `boardGenerator.js` 的兩個放置房間的函式（`placeNewRoom`/`placeRoomAt`）呼叫它，把結果存進房間實例資料（跟 `doorSides` 一樣，透過既有的 `serializeRoom`/`game:stateUpdate` 自動傳到前端，不需要新增任何 socket 事件）。前端 `RoomTile.jsx` 新增 `rotation` prop，套用 CSS `transform:rotate()`，跟現有的縮放/拖動 transform 疊加時放在最內層。

**Tech Stack:** Node.js（伺服器，Jest 測試）／React (Vite) 前端，純 JavaScript。

## Global Constraints

- 旋轉角度只會是 **0/90/180/270** 四個值之一。
- `canonicalDoors` **缺席**（`undefined`/`null`，例如測試用的簡化房間定義）時，`rotation` 預設 **0**，不拋錯——這是為了不影響既有的 `boardGenerator.test.js`（裡面大量測試用 `{ id, doors }` 這種沒有 `canonicalDoors` 欄位的簡化房間定義），也符合「沒有旋轉資料就不旋轉」的合理預設。
- `canonicalDoors` **有提供但四個角度都對不出真實 `doorSides`**（資料本身填錯）時，拋出 `ROTATION_NOT_FOUND`。
- 固定房間（大門廳三格／二樓平台／地下平台，`placeFixedRoom` 放置）**不套用**這套機制，不產生 `rotation` 欄位，維持固定角度顯示。
- 前端只有**中心房間格**（`RoomTile`）套用旋轉；**鄰房預覽帶（`NeighborPeek`）明確排除在範圍外**，維持現有的 `background-image`+`backgroundPosition` 實作不動。
- 旋轉必須是套用在 `RoomTile` 的 transform 疊加順序中**最內層（最先套用）**，縮放/拖動包在外層，確保拖動手感永遠是螢幕座標方向，不受房間旋轉角度影響。

---

## Task 1: `computeRotation` 演算法（`doorLayout.js`）

**Files:**
- Modify: `server/src/game/doorLayout.js`
- Test: `server/test/game/doorLayout.test.js`

**Interfaces:**
- Produces: `computeRotation(canonicalDoors, doorSides)` — `canonicalDoors` 是字串陣列或 `undefined`/`null`；`doorSides` 是任何可迭代的方向字串集合（`Set` 或 `Array`）；回傳 `0`/`90`/`180`/`270`（數字），或在無法對齊時 `throw new Error('ROTATION_NOT_FOUND')`。Task 2 會呼叫這個函式。

- [ ] **Step 1: 寫失敗測試——doors:4 房間任何順序都回傳 0**

在 `server/test/game/doorLayout.test.js` 檔案最後面（`module.exports` 沒有，這個檔案沒有 export block，直接加在最後一個 `test(...)` 之後）新增：

```js
test('computeRotation returns 0 for a doors:4 room (all four sides are doors either way)', () => {
  const canonical = ['north', 'east', 'south', 'west'];
  expect(computeRotation(canonical, new Set(['north', 'east', 'south', 'west']))).toBe(0);
});

test('computeRotation finds the rotation that aligns a single canonical door (doors:1)', () => {
  // 畫死的門在 south；真實 doorSides 只有 east 有門。
  // south 順時針轉 270 度（3 步）會落在 east，所以預期是 270。
  expect(computeRotation(['south'], new Set(['east']))).toBe(270);
});

test('computeRotation finds the rotation for a doors:3 room (single wall side)', () => {
  // 畫死的門在 north/south/east（牆在 west）；真實牆在 north（門在 east/south/west）。
  const canonical = ['north', 'south', 'east'];
  const real = new Set(['east', 'south', 'west']);
  expect(computeRotation(canonical, real)).toBe(90);
});

test('computeRotation returns 0 when canonicalDoors is missing (test fixtures without the field)', () => {
  expect(computeRotation(undefined, new Set(['north']))).toBe(0);
  expect(computeRotation(null, new Set(['north']))).toBe(0);
});

test('computeRotation throws ROTATION_NOT_FOUND when no rotation can reconcile canonicalDoors with doorSides', () => {
  // canonicalDoors 只有 1 個方向，doorSides 有 2 個——數量不合，永遠對不出來。
  expect(() => computeRotation(['south'], new Set(['north', 'east']))).toThrow('ROTATION_NOT_FOUND');
});
```

在同一個檔案最上面的 import 加上 `computeRotation`：

```js
const { SIDES, OPPOSITE_SIDE, computeDoorLayout, computeRotation } = require('../../src/game/doorLayout');
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/doorLayout.test.js -t "computeRotation"`
Expected: FAIL（`computeRotation` 還不存在，`TypeError: computeRotation is not a function`）

- [ ] **Step 3: 實作 `computeRotation`**

在 `server/src/game/doorLayout.js`，找到檔案最後的 `module.exports`：

```js
module.exports = { SIDES, OPPOSITE_SIDE, computeDoorLayout };
```

在它上面新增函式，並把 export 改成包含新函式：

```js
// 把單一方向依順時針旋轉 steps 個 90 度（steps 0~3）。SIDES 本身就是順時針順序。
function rotateSide(side, steps) {
  return SIDES[(SIDES.indexOf(side) + steps) % 4];
}

// 找出讓 canonicalDoors（房間圖片畫死的門位置）旋轉幾次 90 度後，會等於這個房間實例
// 真實的 doorSides。canonicalDoors 缺席時代表沒有旋轉資料，回傳 0（不旋轉）。四個角度
// 都對不出來時代表資料填錯（例如數量不合、或跟 doorPattern 對不起來），直接拋錯，讓填錯
// 的資料在測試/實際遊玩時就爆出來，不要悄悄用錯的角度顯示。
function computeRotation(canonicalDoors, doorSides) {
  if (!Array.isArray(canonicalDoors) || canonicalDoors.length === 0) {
    return 0;
  }
  const target = new Set(doorSides);
  for (let steps = 0; steps < 4; steps++) {
    const rotated = new Set(canonicalDoors.map((side) => rotateSide(side, steps)));
    if (rotated.size === target.size && [...rotated].every((side) => target.has(side))) {
      return steps * 90;
    }
  }
  throw new Error('ROTATION_NOT_FOUND');
}

module.exports = { SIDES, OPPOSITE_SIDE, computeDoorLayout, computeRotation };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/doorLayout.test.js`
Expected: PASS，全部測試（含新增的 5 個）都綠燈

- [ ] **Step 5: Commit**

```bash
cd server
git add src/game/doorLayout.js test/game/doorLayout.test.js
git commit -m "feat: add computeRotation for aligning room art with real door positions"
```

---

## Task 2: 串接進 `boardGenerator.js`

**Files:**
- Modify: `server/src/game/boardGenerator.js`
- Test: `server/test/game/boardGenerator.test.js`

**Interfaces:**
- Consumes: Task 1 的 `computeRotation(canonicalDoors, doorSides)`。
- Produces: `placeNewRoom`/`placeRoomAt` 回傳的房間物件新增 `rotation` 欄位（數字，`0`/`90`/`180`/`270`），跟既有的 `doorSides` 並列。`placeFixedRoom` 不變，不產生 `rotation`。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/boardGenerator.test.js` 檔案最後面新增：

```js
test('placeNewRoom computes rotation from canonicalDoors and stores it on the placed room', () => {
  const board = createBoard(STARTING_ROOMS);
  // 從 (5,5) 往 east 移動，新房間的入口方向（entrySide）是 west。
  // 畫死的門在 south，south 轉 90 度（1 步）會落在 west，預期 rotation 是 90。
  const placed = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'east', {
    id: 'room_a',
    doors: 1,
    canonicalDoors: ['south'],
  });
  expect(placed.doorSides).toEqual(['west']);
  expect(placed.rotation).toBe(90);
});

test('placeNewRoom defaults rotation to 0 when the room definition has no canonicalDoors', () => {
  const board = createBoard(STARTING_ROOMS);
  const placed = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'east', { id: 'room_a', doors: 4 });
  expect(placed.rotation).toBe(0);
});

test('placeNewRoom throws ROTATION_NOT_FOUND when canonicalDoors cannot be reconciled with the real doorSides', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() =>
    placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'east', {
      id: 'room_a',
      doors: 1,
      canonicalDoors: ['north', 'south'], // 2 個方向，跟 doors:1 的真實 doorSides（1 個方向）數量不合
    })
  ).toThrow('ROTATION_NOT_FOUND');
});

test('placeRoomAt computes rotation from canonicalDoors and stores it on the placed room', () => {
  const board = createBoard(STARTING_ROOMS);
  // guaranteedSide 直接指定 west，doors:1 -> 真實 doorSides 只有 west。
  // 畫死的門在 south，south 轉 90 度會落在 west，預期 rotation 是 90。
  const placed = placeRoomAt(
    board,
    'basement',
    5,
    5,
    { id: 'room_fallen', doors: 1, canonicalDoors: ['south'] },
    'west'
  );
  expect(placed.doorSides).toEqual(['west']);
  expect(placed.rotation).toBe(90);
});

test('placeFixedRoom-placed starting rooms do not have a rotation field', () => {
  const board = createBoard(STARTING_ROOMS);
  const lobbyA = board.ground.get(coordKey(0, 1));
  expect(lobbyA.rotation).toBeUndefined();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/boardGenerator.test.js -t "rotation"`
Expected: FAIL（`placed.rotation` 是 `undefined`，不是預期的數字）

- [ ] **Step 3: 修改 `placeNewRoom`**

在 `server/src/game/boardGenerator.js`，找到檔案最上面的 import：

```js
const { SIDES, OPPOSITE_SIDE, computeDoorLayout } = require('./doorLayout');
```

改成：

```js
const { SIDES, OPPOSITE_SIDE, computeDoorLayout, computeRotation } = require('./doorLayout');
```

找到 `placeNewRoom` 函式裡的這段（目前約在第 96-114 行）：

```js
  const entrySide = OPPOSITE_SIDE[direction];
  const getNeighborRequirement = makeNeighborRequirementReader(grid, newCoord);
  const doorSides = computeDoorLayout(
    roomDefinition.doors,
    entrySide,
    getNeighborRequirement,
    roomDefinition.doorPattern || null
  );

  const placedRoom = {
    roomId: roomDefinition.id,
    x: newCoord.x,
    y: newCoord.y,
    doorSides: Array.from(doorSides),
    droppedItems: [],
    item: cloneRoomItem(roomDefinition.item),
  };
  grid.set(key, placedRoom);
  return placedRoom;
```

改成：

```js
  const entrySide = OPPOSITE_SIDE[direction];
  const getNeighborRequirement = makeNeighborRequirementReader(grid, newCoord);
  const doorSides = computeDoorLayout(
    roomDefinition.doors,
    entrySide,
    getNeighborRequirement,
    roomDefinition.doorPattern || null
  );
  const rotation = computeRotation(roomDefinition.canonicalDoors, doorSides);

  const placedRoom = {
    roomId: roomDefinition.id,
    x: newCoord.x,
    y: newCoord.y,
    doorSides: Array.from(doorSides),
    rotation,
    droppedItems: [],
    item: cloneRoomItem(roomDefinition.item),
  };
  grid.set(key, placedRoom);
  return placedRoom;
```

- [ ] **Step 4: 修改 `placeRoomAt`**

在同一個檔案，找到 `placeRoomAt` 函式裡的這段（目前約在第 146-163 行）：

```js
  const getNeighborRequirement = makeNeighborRequirementReader(grid, { x, y });
  const doorSides = computeDoorLayout(
    roomDefinition.doors,
    guaranteedSide,
    getNeighborRequirement,
    roomDefinition.doorPattern || null
  );

  const placedRoom = {
    roomId: roomDefinition.id,
    x,
    y,
    doorSides: Array.from(doorSides),
    droppedItems: [],
    item: cloneRoomItem(roomDefinition.item),
  };
  grid.set(key, placedRoom);
  return placedRoom;
```

改成：

```js
  const getNeighborRequirement = makeNeighborRequirementReader(grid, { x, y });
  const doorSides = computeDoorLayout(
    roomDefinition.doors,
    guaranteedSide,
    getNeighborRequirement,
    roomDefinition.doorPattern || null
  );
  const rotation = computeRotation(roomDefinition.canonicalDoors, doorSides);

  const placedRoom = {
    roomId: roomDefinition.id,
    x,
    y,
    doorSides: Array.from(doorSides),
    rotation,
    droppedItems: [],
    item: cloneRoomItem(roomDefinition.item),
  };
  grid.set(key, placedRoom);
  return placedRoom;
```

- [ ] **Step 5: 執行測試確認通過**

Run: `cd server && npx jest test/game/boardGenerator.test.js`
Expected: PASS，全部測試（含新增的 4 個）都綠燈

- [ ] **Step 6: 執行完整後端測試套件確認沒有回歸**

Run: `cd server && npx jest`
Expected: PASS，全部測試套件都綠燈（`rotation` 欄位是新增欄位，不影響任何既有的 `toEqual`/欄位比對，`turnFlow.js`/`socketHandlers.js` 對 `placedRoom` 的使用只讀取 `x`/`y`/`roomId`/`doorSides`/`item`，不受影響）

- [ ] **Step 7: Commit**

```bash
cd server
git add src/game/boardGenerator.js test/game/boardGenerator.test.js
git commit -m "feat: compute and store room rotation when placing new rooms"
```

---

## Task 3: 前端套用旋轉（`RoomTile.jsx` + `FocusedRoomView.jsx`）

**Files:**
- Modify: `client/src/gameplay/RoomTile.jsx`
- Modify: `client/src/gameplay/FocusedRoomView.jsx`

**Interfaces:**
- Consumes: Task 2 讓 board 資料的房間物件多出 `rotation` 欄位，透過既有的 `game:stateUpdate`/`game:started` 自動送達前端，`currentRoom.rotation` 可直接讀取（`undefined` 代表固定房間，視為 `0`）。
- Produces: `RoomTile` 新增 `rotation` prop（數字，預設 `0`）。

- [ ] **Step 1: 修改 `RoomTile.jsx`**

現有完整內容：

```jsx
export default function RoomTile({ filename, name, style }) {
  if (filename) {
    return (
      <img
        src={`/images/rooms/${filename}`}
        alt={name || ''}
        style={{ objectFit: 'cover', ...style }}
      />
    );
  }
  return (
    <div
      style={{
        backgroundColor: '#8a8a8a',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontSize: '0.85em',
        ...style,
      }}
    >
      {name || '(未知房間)'}
    </div>
  );
}
```

改成：

```jsx
export default function RoomTile({ filename, name, rotation = 0, style }) {
  if (filename) {
    // rotate() 必須是最內層（最先套用）的 transform function，讓呼叫端（例如
    // FocusedRoomView 的縮放/拖動）傳入的 transform 包在外層，套用在已經旋轉好的
    // 圖片上 -- 這樣拖動手感永遠是螢幕座標方向，不受房間旋轉角度影響。
    // 沒有畫面美術圖的下方 fallback（純色塊＋房間名稱文字）不套用旋轉，旋轉文字
    // 沒有意義，只有實際有門框圖案的圖片才需要對齊。
    const { transform: incomingTransform, ...restStyle } = style || {};
    const transform = [incomingTransform, `rotate(${rotation}deg)`].filter(Boolean).join(' ');
    return (
      <img
        src={`/images/rooms/${filename}`}
        alt={name || ''}
        style={{ objectFit: 'cover', ...restStyle, transform }}
      />
    );
  }
  return (
    <div
      style={{
        backgroundColor: '#8a8a8a',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontSize: '0.85em',
        ...style,
      }}
    >
      {name || '(未知房間)'}
    </div>
  );
}
```

- [ ] **Step 2: 修改 `FocusedRoomView.jsx` 的 `RoomTile` 呼叫點**

找到這段（目前約在第 265-276 行）：

```jsx
        <RoomTile
          filename={currentInfo?.filename}
          name={currentInfo?.name}
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel / 100})`,
            transformOrigin: 'center',
            touchAction: zoomLevel > 100 ? 'none' : 'auto',
          }}
        />
```

改成：

```jsx
        <RoomTile
          filename={currentInfo?.filename}
          name={currentInfo?.name}
          rotation={currentRoom.rotation || 0}
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel / 100})`,
            transformOrigin: 'center',
            touchAction: zoomLevel > 100 ? 'none' : 'auto',
          }}
        />
```

- [ ] **Step 3: 用一次性驗證腳本確認 transform 組合順序（client 沒有測試框架，比照先前 AP 扣點功能的作法，不為此新增）**

因為 `RoomTile.jsx` 是 JSX 檔案（需要 JSX 轉譯），沒辦法像純 `.js` 檔案一樣直接用 `node` 匯入執行；改為直接檢查編譯後的邏輯是否正確——建立暫存檔案 `client/scratch-verify-rotation-transform.mjs`：

```js
// 模擬 RoomTile.jsx 裡組合 transform 字串的邏輯，不依賴 React/JSX。
function buildTransform(incomingTransform, rotation) {
  return [incomingTransform, `rotate(${rotation}deg)`].filter(Boolean).join(' ');
}

const withPanZoom = buildTransform('translate(10px, 20px) scale(1.5)', 90);
console.assert(
  withPanZoom === 'translate(10px, 20px) scale(1.5) rotate(90deg)',
  'FAIL: rotate() should be appended after the caller-supplied transform, not before'
);

const noPanZoom = buildTransform(undefined, 180);
console.assert(noPanZoom === 'rotate(180deg)', 'FAIL: with no incoming transform, result should just be the rotate()');

const zeroRotation = buildTransform('scale(1)', 0);
console.assert(zeroRotation === 'scale(1) rotate(0deg)', 'FAIL: rotation=0 should still append rotate(0deg), harmless no-op visually');

console.log('RoomTile transform composition: all assertions passed');
```

Run: `node client/scratch-verify-rotation-transform.mjs`
Expected output: `RoomTile transform composition: all assertions passed`（前面沒有任何 `FAIL:` 開頭的行）

驗證完刪除暫存檔案，不進版控：

```bash
rm client/scratch-verify-rotation-transform.mjs
```

- [ ] **Step 4: 瀏覽器手動驗證（由執行計畫的人／controller 完成，不是必須交給 implementer）**

啟動伺服器＋前端 dev server，開一局遊戲，開幾扇門進入不同房間（盡量涵蓋 doors:1/2/3 幾種形狀），確認：
- 房間圖片能正常顯示，沒有因為新增的 `transform` 而消失或報錯
- 縮放（🔍+/🔍-）跟拖動功能仍正常運作（旋轉不應該影響這兩個既有功能的手感）
- 主觀比對房間圖片的門框位置跟角色進入的方向、跟角落的移動/開門按鈕位置，看起來是否合理對齊（不需要每個角度都精確量測，能過這關代表旋轉邏輯確實在起作用，不是恆等於 0）

- [ ] **Step 5: Commit**

```bash
git add client/src/gameplay/RoomTile.jsx client/src/gameplay/FocusedRoomView.jsx
git commit -m "feat: rotate the focused room tile's art to match its real door positions"
```
