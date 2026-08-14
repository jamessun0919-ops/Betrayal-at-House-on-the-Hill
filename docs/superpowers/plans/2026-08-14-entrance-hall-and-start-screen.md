# 大門廳整合＋遊戲開始階段畫面 Implementation Plan

**Goal:** 用開發者已生成的 4 張大門廳美術圖（`img/rooms/LobbyA/B/C.webp`、`2Fladder.webp`），取代目前尚未真正設計過的 4 個固定起始房間（`doorSides` 全部寫死 `ALL_SIDES`），並建立玩家進入遊戲後看到的起始畫面。

**Architecture:** 後端重新設計 `boardGenerator.js` 的固定房間放置邏輯（`placeFixedRoom` 改成接受明確 `doorSides`），`starting-rooms.json` 改成新的 4 筆資料；前端新增一個條件渲染元件，玩家位於大門廳三格時顯示完整拼接畫面＋依真實 `doorSides` 產生的移動按鈕。範圍限定在大門廳，不做其餘房間的地圖骨架。

**Tech Stack:** Node.js + Jest（後端）、React（前端），沿用既有慣例。

## Global Constraints

- 完全取代大門廳／廊廳／梯廳三個舊固定房間（開發者已確認），二樓平台保留但更新 `doorSides`
- 座標配置（`DIRECTION_DELTA`：north 為 `dy:-1`，south 為 `dy:+1`）：`room_lobby_b`＝(0,0)（原大門廳位置）、`room_lobby_a`＝(0,1)（南／下方）、`room_lobby_c`＝(0,-1)（北／上方）、`room_upper_landing` 樓上 (0,0) 不變
- `doorSides`：`room_lobby_a` = `['north','east','west']`；`room_lobby_b` = `['north','south','east','west']`；`room_lobby_c` = `['west','south']`；`room_upper_landing` = `['north','east','west']`
- `stairsLink` 改成 `{groundRoomId:'room_lobby_c', upperRoomId:'room_upper_landing'}`
- 中文名稱三格大門廳統一用「大門廳」，二樓平台維持「二樓平台」
- 不新增 npm 依賴

---

### Task 1（後端）：`placeFixedRoom` 支援明確 `doorSides`，`createBoard` 改用新的 4 個房間

**Files:**
- Modify: `server/src/game/boardGenerator.js`
- Modify: `data/rooms/starting-rooms.json`
- Test: `server/test/game/boardGenerator.test.js`

**內容**：
- `placeFixedRoom(grid, roomId, x, y, doorSides)` 新增第 5 個參數，取代目前寫死的 `ALL_SIDES.slice()`
- `createBoard` 改成尋找 `room_lobby_a`/`room_lobby_b`/`room_lobby_c`/`room_upper_landing`（`MISSING_STARTING_ROOM` 檢查一併更新），依 Global Constraints 的座標與 `doorSides` 呼叫 `placeFixedRoom`
- `starting-rooms.json` 改成：
```json
[
  { "id": "room_lobby_a", "name": "大門廳", "floor": "ground", "filename": "LobbyA.webp" },
  { "id": "room_lobby_b", "name": "大門廳", "floor": "ground", "filename": "LobbyB.webp" },
  { "id": "room_lobby_c", "name": "大門廳", "floor": "ground", "stairsTo": "room_upper_landing", "filename": "LobbyC.webp" },
  { "id": "room_upper_landing", "name": "二樓平台", "floor": "upper", "filename": "2Fladder.webp" }
]
```
- 更新 `boardGenerator.test.js` 的 `STARTING_ROOMS` fixture 與座標斷言，改用新的 4 筆資料與座標

---

### Task 2（後端）：更新其餘測試檔案的 `STARTING_ROOMS`/`startingRooms` fixture

**Files:**
- Modify: `server/test/game/contentLoader.test.js`（只是 loader 通用性測試，id 可保持泛用，不強制改名，確認即可）
- Modify: `server/test/game/effectResolver.test.js`
- Modify: `server/test/game/gameManager.test.js`
- Modify: `server/test/game/gameState.test.js`
- Modify: `server/test/game/turnFlow.test.js`（含 `canUseStairs`/`useStairs` 測試裡寫死的 `player.x=-4,y=0` 等座標，要改成 `room_lobby_c` 的新座標 `x:0,y:-1`；`room_upper_landing` 相關座標不變）
- Modify: `server/test/socketHandlers.test.js`（`makeContent()` 與其他內嵌 `startingRooms` 陣列，含 `leaveCheck` 覆寫的那幾處）

**方法**：逐檔搜尋 `room_entrance_hall`/`room_foyer`/`room_grand_staircase`/`room_upper_landing`，依 Task 1 的新資料更新 fixture；凡是測試斷言依賴具體座標（例如 `player.x=-4`），改成對應新房間的座標。每改完一個檔案就跑該檔案測試確認綠燈，全部改完後跑整個 server 測試套件確認無遺漏。

---

### Task 3（前端）：複製圖檔＋新增大門廳畫面元件

**Files:**
- Create: `client/public/images/rooms/LobbyA.webp`、`LobbyB.webp`、`LobbyC.webp`、`2Fladder.webp`（從 `img/rooms/` 複製）
- Create: `client/src/gameplay/EntranceHallView.jsx`
- Modify: `client/src/DebugGameScreen.jsx`

**內容**：
- `EntranceHallView` 接收 `{ currentRoomId, doorSides, onMove, onUseStairs }`：縱向堆疊固定順序顯示 LobbyC（上）／LobbyB（中）／LobbyA（下）三張完整圖片；依 `doorSides` 產生對應方向的移動按鈕（呼叫 `onMove(direction)`）；`currentRoomId === 'room_lobby_c'` 時額外顯示「上二樓」按鈕（呼叫 `onUseStairs`）
- `DebugGameScreen.jsx`：
  - 新增獨立 state 儲存 `roomContent`（從 `initialGameState?.roomContent` 初始化一次，**不可**跟著 `gameState` 一起被 `game:stateUpdate`覆蓋掉，因為 `game:stateUpdate` 的 payload 不含 `roomContent`，這是本次要避免的一個真實陷阱）
  - `phase === 'playing'` 區塊：算出玩家目前所在房間（`gameState.board[player.floor].get(coordKey(player.x, player.y))`），若 `roomId` 是 `room_lobby_a`/`b`/`c` 其中之一，改渲染 `<EntranceHallView>`（取代目前寫死的北/東/南/西按鈕），否則維持現有按鈕不變

---

## 完成後驗證

- `cd server && npx jest --forceExit` 全數通過
- 啟動本機測試伺服器，建房→選角完成後確認畫面顯示大門廳三張圖，門按鈕依真實 `doorSides` 出現，LobbyC 顯示「上二樓」按鈕且點擊後成功換樓層
