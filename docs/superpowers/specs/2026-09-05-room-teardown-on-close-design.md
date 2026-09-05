# 房間清空時資源回收設計文件

**日期**：2026-09-05
**範圍**：房間真正清空（`closeLobbyRoom`執行完畢）的那一刻，把該房間在4個Map裡累積的資源全部清乾淨——`gameManager.games`、`effectResolverManager.resolvers`、階段逾時計時器（`phaseTimeouts`）、角色選擇逾時計時器（`characterSelectTimeouts`）。不處理房間/遊戲生命週期清理的其餘子項目（房主中途斷線會粗暴踢出所有人、非房主斷線留下幽靈玩家、缺乏重連機制、遊戲何時算「結束」的判定邏輯），這些留給未來個別討論。

## 背景

現有程式碼裡，`gameManager.js`的`endGame`跟`effectResolverManager.js`的`endResolver`都只是簡單的`Map.delete(roomCode)`，兩者都已經正常匯出且各自有單元測試涵蓋自身行為（`gameManager.test.js`/`effectResolverManager.test.js`皆有「刪除+對未知房號安全no-op」的測試），**但整個`server/src`裡除了定義本身，沒有任何地方呼叫它們**。`gameManager.games`（每局遊戲的完整`gameState`）跟`effectResolverManager.resolvers`（每局的道具/擲骰/道具遺留待定選擇狀態）這兩個Map，從伺服器啟動以來玩過幾局就累積幾個entry，永遠不會減少。

更嚴重的是`socketHandlers.js`裡管理階段逾時的`scheduleOrRefreshPhaseTimeout`（[socketHandlers.js:704](../../../server/src/socketHandlers.js)）：它的`finally`區塊會在每次`handlePhaseTimeout`執行完之後無條件重新排程下一次（這是刻意設計，避免單次錯誤讓房間永久卡死），代價是**只要一個房間開始遊戲，這個計時器就會每20~90秒執行一次、永遠執行下去**，沒有任何「房間已經沒人了，別再排」的出場機制。伺服器跑得越久、玩過的對局越多，背景就累積越多個永遠不會停止的計時器，持續佔用CPU、持續對一個可能早就沒有任何socket的io房間發廣播。

這個Map洩漏還有一個具體的衍生bug：房號是隨機4碼英文字母（`generateRoomCode()`，26^4≈45.7萬種可能），建房時只檢查跟`lobbyManager.rooms`撞號（[lobbyManager.js:34-37](../../../server/src/lobbyManager.js)），不會檢查`gameManager.games`。`lobbyManager`的房間記錄會在房主離開時被刪除（房號因此可以被重複生成），但`gameManager.games`裡對應的`gameState`永遠不會被刪——如果之後隨機生出同一個房號給一個全新房間，`startGame`會因為`manager.games.has(roomCode)`仍是true而拋出`GAME_ALREADY_STARTED`（[gameManager.js:21-23](../../../server/src/game/gameManager.js)），讓一個完全無關的新房間莫名其妙開不了局。

## 觸發時機：只掛在`closeLobbyRoom`

`closeLobbyRoom`（[socketHandlers.js:1460](../../../server/src/socketHandlers.js)）目前的行為：抓出`io.in(roomCode)`裡當下所有的socket、廣播`lobby:closed`、把每個socket踢出房間（`s.leave(roomCode)`）、清掉`lobbyManager`自己的房間記錄。**這個函式執行完之後，該房間在io層級保證是空的**（不管執行前有幾個socket、是不是房主自己)。

`closeLobbyRoom`目前只會在`lobby:leave`／`disconnect`這兩個handler判斷`lobbyManager.isHost(roomCode, playerId)`為true時被呼叫（[socketHandlers.js:633-634](../../../server/src/socketHandlers.js)、[socketHandlers.js:648-649](../../../server/src/socketHandlers.js)）——也就是說，**房間會變成「io層級真正清空」的唯一時刻，就是房主自己離開/斷線、觸發`closeLobbyRoom`的那一刻**。非房主玩家一個一個離開（`else`分支的`lobbyManager.leaveRoom`）不會清空io房間，因為只要房主還連著，房主的socket就還在房間裡。

**因此不需要在非房主的離開/斷線分支額外檢查「房間是否已清空」**——這個檢查在目前架構下永遠不會為真（房主一定還在，除非房主自己也走了，但那會走另一條已經無條件觸發`closeLobbyRoom`的分支），加上去會是測不到、也用不到的死分支，違反YAGNI。清理邏輯只需要掛在`closeLobbyRoom`這一個函式的尾端即可涵蓋所有「房間真正清空」的情境。

## 需要驗證、不能只憑假設的技術細節

`disconnect`事件觸發時，斷線中的那個socket本身是否還會被算進`io.in(roomCode).fetchSockets()`的回傳結果——這跟socket.io內部把斷線socket移出room的時機有關。**這一點對這次的設計本身沒有影響**（因為`closeLobbyRoom`是靠自己主動`s.leave(roomCode)`把每個socket踢出去，不是靠讀取「目前還剩幾個」來判斷空還是不空），但既有測試「host disconnecting also closes the room for everyone else」（[socketHandlers.test.js:399](../../../server/test/socketHandlers.test.js)）已經證明現有的`disconnect`→`closeLobbyRoom`路徑本來就正常運作，這次只是在它尾端多掛清理動作，不改變它原本的觸發判斷，因此沒有新的時序風險需要另外驗證。

## 程式碼變更

**`server/src/socketHandlers.js`**：

1. 新增import：`endGame`（來自`./game/gameManager`，該模組已匯出，這次只是接上呼叫）、`endResolver`（來自`./game/effectResolverManager`，同樣已匯出）。
2. 仿照既有`clearCharacterSelectTimeout`（[socketHandlers.js:696](../../../server/src/socketHandlers.js)）的寫法，新增`clearPhaseTimeout(roomCode, phaseTimeouts)`：

```javascript
function clearPhaseTimeout(roomCode, phaseTimeouts) {
  const existing = phaseTimeouts.get(roomCode);
  if (existing) {
    clearTimeout(existing.handle);
    phaseTimeouts.delete(roomCode);
  }
}
```

3. 新增`teardownRoom(gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts, roomCode)`，把4個清理動作收斂成一次呼叫（全部是Map操作，對不存在的roomCode安全no-op，呼叫順序不影響結果）：

```javascript
function teardownRoom(gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts, roomCode) {
  endGame(gameManager, roomCode);
  endResolver(effectResolverManager, roomCode);
  clearPhaseTimeout(roomCode, phaseTimeouts);
  clearCharacterSelectTimeout(roomCode, characterSelectTimeouts);
}
```

4. `closeLobbyRoom`簽名增加4個參數，尾端呼叫`teardownRoom`：

```javascript
async function closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts) {
  const sockets = await io.in(roomCode).fetchSockets();
  io.to(roomCode).emit('lobby:closed', {});
  for (const s of sockets) {
    s.data.roomCode = null;
    s.data.playerId = null;
    s.leave(roomCode);
  }
  lobbyManager.closeRoom(roomCode);
  teardownRoom(gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts, roomCode);
}
```

5. 兩處呼叫點（`lobby:leave`的[socketHandlers.js:634](../../../server/src/socketHandlers.js)、`disconnect`的[socketHandlers.js:649](../../../server/src/socketHandlers.js)）補上新增的4個引數——這兩處都在`registerSocketHandlers`的閉包內，`gameManager`／`effectResolverManager`／`phaseTimeouts`／`characterSelectTimeouts`皆已在作用域內，不需要新增任何外部傳遞路徑。

**不需要修改**：`gameManager.js`、`effectResolverManager.js`（`endGame`/`endResolver`已經匯出且已有測試涵蓋自身行為）、`lobbyManager.js`、任何前端檔案（這次改動完全是伺服器內部資源清理，不影響任何client可見的行為或事件）。

## 測試計畫

**新增測試（`server/test/socketHandlers.test.js`）**：
- 房主在遊戲已經開始（`game:started`之後）離開/斷線，驗證`getGameState(gameManager, roomCode)`跟`getResolver(effectResolverManager, roomCode)`在`closeLobbyRoom`完成後都變成`undefined`——這是目前完全沒有測試覆蓋的情境（既有的host-leave/disconnect測試都只測到大廳階段，遊戲還沒開始）
- 房主在大廳階段（遊戲還沒開始）離開/斷線，驗證`getGameState`/`getResolver`本來就是`undefined`（因為遊戲還沒開始），呼叫`teardownRoom`不會拋錯（確認Map操作對不存在的roomCode是安全的no-op，這點雖然`gameManager.test.js`/`effectResolverManager.test.js`已經個別驗證過，這裡是整合層級的回歸確認）
- 衍生bug的回歸測試：房主離開已開始的遊戲後，用同一個（或human-forced相同的）房號重新開一場新遊戲，驗證`startGame`不會拋出`GAME_ALREADY_STARTED`——由於房號是隨機的，測試不能真的等隨機碰撞，而是直接呼叫`gameManager.startGame`與`endGame`驗證這組API本身的行為（在`gameManager.test.js`層級新增，而不是在`socketHandlers.test.js`裡賭運氣）：先`startGame`＋`endGame`同一個`roomCode`，再對同一個`roomCode`呼叫第二次`startGame`，確認不會拋錯

**既有測試需要確認的回歸範圍**：`server/test/socketHandlers.test.js`裡既有的4個`lobby:leave`/`disconnect`測試（[socketHandlers.test.js:331](../../../server/test/socketHandlers.test.js)起）都停留在大廳階段，`closeLobbyRoom`新增的4個參數屬於函式內部簽名變更，不影響這些既有測試的外部可觀察行為（`lobby:closed`廣播、`rejoin`成功與否），預期全部維持通過、不需要修改斷言，只是要跑過一次確認。

## 自我檢查

- 無占位符／待定事項
- 背景、觸發時機、程式碼變更三段對「只掛`closeLobbyRoom`、不碰非房主分支」的理由前後一致
- 範圍單一：只解決「資源永遠不會被回收」這一件事，房主中途斷線的踢人行為（現有既定行為，這次不動）、非房主斷線留下幽靈玩家、重連機制、遊戲結束判定，均明確排除在外
