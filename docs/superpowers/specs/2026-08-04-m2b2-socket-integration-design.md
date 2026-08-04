# M2b-2：Socket.IO 事件層整合＋除錯用測試頁面 — 設計文件

日期：2026-08-04
狀態：已與開發者確認，準備進入 `writing-plans` 撰寫實作計畫

## 背景

M2b-1（[docs/superpowers/plans/2026-08-02-m2b1-core-game-logic.md](../plans/2026-08-02-m2b1-core-game-logic.md)）已完成並合併進 `main`，建立了純邏輯的核心模組：`roomDeck.js`（房間磚牌庫，樓層感知）、`boardGenerator.js`（含 `canMoveBetween` 移動鄰接判定）、`gameState.js`（含 `serializeGameState`）、`promptState.js`（單一待處理提問狀態機）、`characterSelection.js`（選角色狀態機）、`gameManager.js`（`roomCode -> gameState` 生命週期）、`turnFlow.js`（移動/開門/樓梯/選動作/回合順序）。

M2b-2 要把這些模組接上 Socket.IO 事件層（`server/src/socketHandlers.js`），並新增一個簡易除錯用測試頁面，讓整條路徑（大廳 → 選角色 → 開局 → 回合行動）第一次可以被開發者實際點選操作。完整的回合流程設計已寫在 [docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md](2026-08-01-turn-flow-and-action-points.md)，本文件補上 M2b-2 才浮現的整合層決定。

## 1. 選角色階段的狀態存放（本次會話討論確認）

新增 `server/src/game/characterSelectionManager.js`，職責單一：`roomCode -> { characterSelectionState, promptState }`，**選角色完成後即整組丟棄**（呼叫 `endSelection`）。

`promptState` 只在選角色階段使用；回合流程（見第3節）暫時不套用提問系統，所以 M2b-2 不需要在 `gameState` 上另外掛一份 `promptState`——之後真的要做回合內的計時提問（例如「要不要使用道具」）時，再由當時的實作決定要不要幫 `gameState` 加這個欄位，本次不預先加（YAGNI）。

`LobbyManager`（管大廳玩家）與 `GameManager`（管已開局的 `gameState`）維持 M1/M2b-1 現狀，不修改。三者的關係：

```
大廳（LobbyManager）
  → 房主觸發 game:startCharacterSelect →
選角色階段（CharacterSelectionManager，暫存，完成後丟棄）
  → 全部選完 →
遊戲進行中（GameManager，管 gameState，含 turnFlow）
```

## 1.5 補上「房主」的資料模型（自我審查發現的缺口）

`game:startCharacterSelect` 要求「房主限定」，但檢查 M1 既有的 `server/src/lobbyManager.js`，房間資料 `{ players: Map(playerId -> {name, socketId}) }` **完全沒有記錄誰是房主**——`createRoom(hostName, hostSocketId)` 只是參數命名裡有 `host`，建立房間後這個身份沒有被存下來。

**修正（M2b-2 範圍內的小改動）**：`LobbyManager` 的房間物件新增 `hostPlayerId` 欄位，在 `createRoom` 時設為建立者的 `playerId`；新增 `isHost(roomCode, playerId): boolean` 方法供 `socketHandlers.js` 查詢。`joinRoom`/`leaveRoom`/`getPlayers` 等既有方法不受影響（不處理房主離開後轉移房主身份的情境，房主離開就跟其他玩家一樣走既有的 `leaveRoom` 邏輯，房主轉移留給之後有需要再設計，本次不處理）。

## 2. 選角色事件流程

- **`game:startCharacterSelect`**（client→server，房主限定，人數需 ≥2，房間不能已經在選角色或已開局）：伺服器讀取 `loadCharacters()`，呼叫 `createCharacterSelectionState(playerIds, characters)` 建立 session；接著建立第一個提問（`createPrompt`，`type:'character_select'`，目標＝順序第一位，`options`＝目前可選角色 id 清單，`timeoutMs: 30000`），伺服器**自己**排程一個真實的 `setTimeout`（30秒）；廣播 `game:prompt`（提問內容，目標玩家可互動+倒數，其他人唯讀）＋ `game:characterSelectUpdate`（完整選角色狀態：`order`、`currentPicker`、`lockedCharacterIds`、`assignments`、完整 `characters` 陣列——讓所有玩家隨時能瀏覽全部角色資訊，不限輪到的人）
- **`game:promptRespond`**（沿用既有通用提問協定，`{promptId, optionId}`）：伺服器驗證 `promptId`/送出者身份（`respondToPrompt`），成功後呼叫 `confirmCharacterChoice(characterSelectionState, {playerId, characterId: optionId})`，**清除**剛剛排的 `setTimeout`（避免逾時計時器晚到誤觸發），廣播 `game:promptResolved` ＋更新後的 `game:characterSelectUpdate`；若 `isCharacterSelectionComplete` 為 `false`，建立下一位玩家的提問（同樣 30 秒+排程），流程重複；為 `true` 則進入第3節的開局轉換
- **逾時**：`setTimeout` 到時 → 先呼叫 `assignRandomCharacter(characterSelectionState, playerId)` 決定實際指定的角色 → 用該結果呼叫 `resolvePromptTimeout(promptState, {promptId, defaultOptionId: 該角色id})` 收尾提問狀態 → 廣播 `game:promptResolved`（`wasTimeout:true`）＋ `game:characterSelectUpdate`，其餘流程跟正常確認完全一致（下一位或進入開局）

## 3. 開局轉換

全部玩家選完角色後：合併大廳玩家名單（`LobbyManager` 的 `playerId`/`name`）與選角色結果（`getAssignments(characterSelectionState)` 的 `playerId -> characterId`），組成 `players: Array<{playerId, name, characterId}>`；呼叫 `GameManager.startGame(gameManager, roomCode, { startingRooms: loadStartingRooms(), rooms: loadRooms(), characters: loadCharacters(), players })`；呼叫 `characterSelectionManager.endSelection(roomCode)` 丟棄暫存狀態；廣播新事件 **`game:started`**（payload：`serializeGameState(gameState)`），讓 client 從選角色畫面切到遊戲畫面。

## 4. 回合行動事件（直接事件，本次不套兩層提問流程）

**範圍決定（本次會話確認）**：[turn-flow-and-action-points.md](2026-08-01-turn-flow-and-action-points.md) 描述的完整兩層 20 秒倒數提問流程（第一層選移動/道具/襲擊/操作，第二層選具體項目，逾時放棄整回合）**本次不實作**。M2b-2 先讓 client 直接呼叫行動事件，伺服器照樣做完整的 turn ownership／行動力驗證（`turnFlow.js` 已經內建），只是不透過提問倒數包裝。兩層提問的 UX 留給之後的階段接上。

- **`game:move`** `{direction}`：呼叫 `turnFlow.moveToRoom(gameState, playerId, direction)`
- **`game:selectAction`** `{actionType}`：呼叫 `turnFlow.selectAction(gameState, playerId, actionType)`
- **`game:useStairs`**（無 payload）：呼叫 `turnFlow.useStairs(gameState, playerId)`（免費動作，不影響行動力，不檢查 `isTurnOver`）

三者共同的錯誤處理：`turnFlow.js` 拋出的錯誤（`NOT_YOUR_TURN`/`NOT_ENOUGH_ACTION_POINTS`/`INVALID_MOVE_DIRECTION`/`STAIRS_NOT_AVAILABLE`等）直接透過 ack callback 回傳 `{error: err.message}` 給呼叫端，不廣播。

成功執行後（`game:move`/`game:selectAction`，`useStairs` 例外）：檢查 `isTurnOver(player)`，為真則呼叫 `advanceTurn(gameState)`（會自動幫下一位玩家重設行動力，`turnFlow.js` 既有邏輯）；不論回合是否結束，都廣播 **`game:stateUpdate`**（payload：`serializeGameState(gameState)`）讓所有 client 同步最新狀態。

## 5. 待未來里程碑接手的「掛勾點」廣播（本次會話確認新增）

`turnFlow.js` 已經有兩處「這裡需要之後的里程碑接手處理」的訊號：開門後的 `pendingCardDraw`（`moveToRoom` 回傳值裡）、`selectAction` 的 `{kind, pending:true}`。這兩者**不要**只塞進通用的 `game:stateUpdate`裡讓 client 自己從裡面挖，改成各自對應一個獨立、明確命名的廣播事件，方便 M2c/M3 之後直接對接：

- 開門後若 `pendingCardDraw` 不是 `null`：廣播 **`game:pendingCardDraw`** `{playerId, roomId, deck}`
- `selectAction` 回傳 `pending:true`：廣播 **`game:pendingAction`** `{playerId, actionType}`

M2b-2 的除錯頁面收到這兩個事件時，只需要原樣顯示 JSON，不做任何後續處理（不模擬抽卡、不模擬戰鬥）——真正的效果解析是 M2c/M3 的範圍。

## 6. 除錯用測試頁面

`client/src/` 新增一個簡易 React 元件（暫定 `DebugGameScreen.jsx`），不是正式美術，純粹功能性：
- 觸發選角色（按鈕呼叫 `game:startCharacterSelect`）
- 顯示 `game:characterSelectUpdate`／`game:prompt`／`game:promptResolved` 收到的內容，選角色按鈕呼叫 `game:promptRespond`
- 開局後顯示 `game:started`／`game:stateUpdate` 的完整 JSON，四個方向移動按鈕、道具/襲擊/操作按鈕、樓梯按鈕
- 顯示 `game:pendingCardDraw`／`game:pendingAction` 收到的內容（純顯示，不處理）
- 共用既有的 `client/src/socket.js` 連線，不用另外走 lobby 畫面以外的路由設計，只要能從大廳畫面手動切換過來即可

## 7. 測試策略

- `characterSelectionManager.js`：延續 M2b-1 的純邏輯 Jest 模式，自建 fixture，不依賴 Socket.IO
- `socketHandlers.js` 的新事件：延續 M1 建立的「起真實 server + 多個 client 連線互動」整合測試模式
- **30 秒逾時計時器的測試方式，留給撰寫實作計畫時決定**（候選方案：Jest fake timers、或測試專用的縮短逾時秒數注入）——這是本文件唯一留給下一階段定案的技術細節，不影響架構

## 範圍外事項（記錄供後續參考）

- 兩層 20 秒倒數的回合行動提問流程（本次確認不實作，見第4節）
- 道具/襲擊/操作、開門後卡片抽取的實際效果解析（M2c/M3 範圍），M2b-2 只負責發出對應的掛勾點廣播事件
- `gameState.promptState`（回合內提問容器）——本次不需要，等真正要做回合內提問時再加
- 正式遊戲介面美術，M2b-2 只做除錯用測試頁面
