# M2D1：大廳流程（開頭頁面／建立/進入大廳／等候室）設計文件

## 背景與目標

M2d（簡易使用者介面）取代目前 JSON 傾印風格的除錯頁面。開發者把整個 M2d 拆成幾個階段依序討論：M2D1（大廳流程，本文件）、M2D2（角色選擇，等開發者補角色圖片後另外設計正式畫面）、M2D3 之後（遊戲進行中的畫面）。目標裝置是**手機橫向螢幕**，開發階段本機瀏覽器要模擬手機大小、橫向顯示。

現有 `client/src/LobbyScreen.jsx`／`server/src/lobbyManager.js` 只做到最基本的「輸入暱稱＋房號→建立/加入房間→顯示玩家名單」，本文件要設計的新流程在此基礎上新增：開頭頁面、暱稱輸入視窗、大廳列表（依房主暱稱瀏覽/選擇要加入的房間）、正式的等候室畫面（房主/一般玩家不同操作）、房主離開時的簡化解散機制。

## 畫面清單與流程

```
開頭頁面（Gate.png 全螢幕背景）
├─ 「建立大廳」→ 暱稱輸入視窗 → 確認 → 建房 API → 等候室（房主視角）
└─ 「進入大廳」→ 暱稱輸入視窗 → 確認 → 大廳列表 → 選一間 → 等候室（一般玩家視角）

等候室（一般玩家）「退出大廳」 → 大廳列表
等候室（房主）「退出大廳」（或房主斷線） → 房間解散，廣播通知房內所有人 → 大家一起回到開頭頁面
等候室（房主）「準備完成」 → 廣播 game:startCharacterSelect 觸發 → 大家一起進入「角色選擇開發中」佔位畫面
```

### 1. 開頭頁面（StartScreen）
`Gate.png`（`img/Gate.png`，開發者已準備好的素材）作滿版背景，疊加「建立大廳」「進入大廳」兩個按鈕。

### 2. 暱稱輸入視窗（NicknameModal）
點擊任一按鈕後彈出的浮層，輸入暱稱＋確認按鈕。確認後依來源分流：
- 來自「建立大廳」：呼叫既有 `lobby:create`，成功後直接進等候室（房主視角）
- 來自「進入大廳」：不呼叫任何建房/加房事件，直接進大廳列表畫面（真正的加入動作留到列表選定房間那一步才呼叫既有 `lobby:join`）

### 3. 大廳列表畫面（LobbyListScreen，僅「進入大廳」路徑會經過）
`Gate.png` 浮水印背景。中央顯示房間清單，每一項顯示「房主暱稱＋人數（例如 2/6）」。清單只在**進入這個畫面時拉一次**（呼叫新的 `lobby:list`），不即時更新，畫面上要有一個手動「重新整理」按鈕。清單為空時顯示提示文字（例如「目前沒有開放中的大廳」）。點擊某一項＝呼叫既有 `lobby:join`（用該項的 `roomCode`＋剛剛輸入的暱稱），成功後進等候室（一般玩家視角）。

### 4. 等候室（WaitingRoomScreen）
`Gate.png` 浮水印背景。中央顯示現有玩家名單（房主要有明確標記，例如「👑」或文字「（房主）」）。下方按鈕依身分不同：
- **房主**：「退出大廳」「準備完成」
- **一般玩家**：只有「退出大廳」

### 5. 角色選擇開發中佔位畫面（CharacterSelectPlaceholder）
房主按下「準備完成」後，房內所有人一起看到的靜態畫面（顯示類似「角色選擇開發中」的文字即可，不接現有除錯頁面的選角邏輯）。M2D2 正式畫面另外設計。

## 後端調整

### `server/src/lobbyManager.js`

新增一個查詢房主暱稱的方法（目前只有 `hostPlayerId`，沒有直接查 `name` 的方法）：

```js
getHostName(roomCode) {
  const room = this.rooms.get(roomCode);
  if (!room) return null;
  const host = room.players.get(room.hostPlayerId);
  return host ? host.name : null;
}
```

新增一個列出「可加入房間」的方法（給 `lobby:list` 用，過濾條件見下）：

```js
listJoinableRooms(isRoomInProgress, maxPlayers) {
  const result = [];
  for (const [roomCode, room] of this.rooms.entries()) {
    if (isRoomInProgress(roomCode)) continue;
    const playerCount = room.players.size;
    if (playerCount >= maxPlayers) continue;
    result.push({ roomCode, hostName: this.getHostName(roomCode), playerCount, maxPlayers });
  }
  return result;
}
```

（`isRoomInProgress` 由呼叫端注入，因為「是否進行中」要查 `characterSelectionManager`/`gameManager`，`lobbyManager.js` 本身不依賴這兩個模組——這是既有的模組邊界，`lobby:join` 現有的 `ROOM_IN_PROGRESS` 判斷就是用同樣的 `getCharacterSelection(characterSelectionManager, roomCode) || getGameState(gameManager, roomCode)` 邏輯，`lobby:list` 直接複用同一個判斷式，不要另外寫一份）

### `server/src/socketHandlers.js`

**新增 `lobby:list` 事件**（不需要 `socket.data.roomCode`，瀏覽列表的人本來就還沒加入任何房間）：

```js
socket.on('lobby:list', (payload, callback) => {
  const ack = typeof callback === 'function' ? callback : () => {};
  const maxPlayers = content.characters.length;
  const rooms = lobbyManager.listJoinableRooms(
    (roomCode) => Boolean(getCharacterSelection(characterSelectionManager, roomCode) || getGameState(gameManager, roomCode)),
    maxPlayers
  );
  ack({ rooms });
});
```

**新增 `lobby:leave` 事件**（明確的主動離開動作，跟現有靠 `disconnect` 被動觸發的離開分開處理）：

```js
socket.on('lobby:leave', async (payload, callback) => {
  const ack = typeof callback === 'function' ? callback : () => {};
  const { roomCode, playerId } = socket.data;
  if (!roomCode || !playerId) {
    return ack({ error: 'NOT_IN_ROOM' });
  }
  if (lobbyManager.isHost(roomCode, playerId)) {
    await closeLobbyRoom(io, lobbyManager, roomCode); // clears socket.data + leaves the io room for every socket still in it, host included
  } else {
    lobbyManager.leaveRoom(roomCode, playerId);
    socket.leave(roomCode);
    socket.data.roomCode = null;
    socket.data.playerId = null;
    broadcastPlayers(io, lobbyManager, roomCode);
  }
  ack({});
});
```

（房主分支一定要 `await closeLobbyRoom(...)` 再 `ack({})`——不能發了就不管，否則房主自己的 `socket.data` 清理跟 `lobby:closed` 廣播的先後順序不確定，`ack({})` 可能在清理完成前就先回去了）

**`disconnect` handler 補上房主判斷**（現有版本不分身分，統一呼叫 `leaveRoom`——房主斷線時要改成解散整個房間，而不是只移除自己讓房間留著一個沒有房主的殘骸）：

```js
socket.on('disconnect', async () => {
  const { roomCode, playerId } = socket.data;
  if (roomCode && playerId) {
    if (lobbyManager.isHost(roomCode, playerId)) {
      await closeLobbyRoom(io, lobbyManager, roomCode);
    } else {
      lobbyManager.leaveRoom(roomCode, playerId);
      broadcastPlayers(io, lobbyManager, roomCode);
    }
  }
});
```

（`disconnect` 事件觸發時，這個 socket 本身已經被 socket.io 自動移出所有房間，不需要也不能對它自己再呼叫 `socket.leave`/清 `socket.data`——`closeLobbyRoom` 內的 `fetchSockets()` 自然不會再抓到這個已離線的 socket，只會處理房內其餘還連著的人，行為是對的）

**新增共用函式 `closeLobbyRoom`**（`lobby:leave` 的房主分支跟 `disconnect` 的房主分支共用同一段邏輯，不要各寫一份）：

```js
async function closeLobbyRoom(io, lobbyManager, roomCode) {
  const sockets = await io.in(roomCode).fetchSockets();
  for (const s of sockets) {
    s.data.roomCode = null;
    s.data.playerId = null;
    s.leave(roomCode);
  }
  io.to(roomCode).emit('lobby:closed', {});
  lobbyManager.closeRoom(roomCode); // LobbyManager 新增：直接刪除該房間的所有資料，不用逐一 leaveRoom
}
```

`LobbyManager` 對應新增 `closeRoom(roomCode) { this.rooms.delete(roomCode); }`。

**前端行為**：房主自己的 socket 在 `closeLobbyRoom` 廣播 `lobby:closed` 的當下仍在該 io room 內（emit 發生在 leave 迴圈之前），所以房主自己的客戶端也會收到這個廣播；前端刻意依賴這個廣播（而不是 `lobby:leave` 的 ack）來驅動房主自己的畫面轉場，避免 ack 與廣播兩個轉場互相搶跑。收到 `lobby:closed` 廣播的所有客戶端一律清空本地狀態、導回開頭頁面。

## 前端

新的 5 個畫面元件取代 `LobbyScreen.jsx` 現在的內容（`DebugGameScreen.jsx` 保留不動，只是「進入除錯測試模式」這個入口的按鈕暫時拿掉，改成「角色選擇開發中」佔位畫面——除錯頁面本身作為工具還是留著，之後可能會需要，只是不再是 M2D1 之後的預設路徑）。

視覺風格：`Gate.png` 滿版背景（開頭頁）／浮水印背景（大廳列表、等候室）；其餘框線、字體大小、間距由 agent 先規劃一版初稿，開發者看過再提修改意見。響應式設計，開發階段用模擬手機橫向尺寸的瀏覽器視窗檢查。

## 範圍外事項

- M2D2 正式角色選擇畫面：等開發者提供角色圖片後另外討論設計
- 房主權限轉移：開發者已明確要求簡化為「房主離開＝整個大廳解散」，不做轉移機制
- 大廳列表即時更新：這次只做「進入時拉一次＋手動刷新」，不建立即時廣播頻道
