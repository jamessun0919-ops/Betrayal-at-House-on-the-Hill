# 大廳階段秒數可調整設計文件

**日期**：2026-09-05
**範圍**：房主建立房間當下可設定一個秒數（20~90，預設30），套用到既有的「一回合5階段」機制（`gameState.phaseTimeoutMs`），取代目前寫死的30秒。同時清除3個已經不再有實際作用的舊逾時常數（擲骰介入／道具遺留／卡片效果選擇），角色選擇逾時維持完全不動。不涉及房間/遊戲生命週期清理、M3戰鬥系統等其他待辦。

## 背景

`phaseFlow.js` 的 `PHASE_ORDER = ['player_move','npc_move','player_interact','npc_interact','settlement']` 是既有機制：一回合分5個階段循環，`enterPhase()` 每次進入任一階段都用 `gameState.phaseTimeoutMs` 重設 `phaseDeadline`（目前寫死30000ms，來自 `gameState.js` 的 `options.phaseTimeoutMs || 30000`）。逾時後 `socketHandlers.js` 的 `handlePhaseTimeout` 強制鎖定還沒完成的玩家、推進到下一階段。**這個機制本身已經是單一數值，只是不能讓房主設定**——這是這次唯一需要新增行為的地方。

探查過程中發現另外4個「看起來獨立」的逾時常數，逐一查證後結論分歧：

- **角色選擇逾時**（`characterSelectTimeoutMs`，30000ms）：發生在遊戲開始前、`gameState`/階段概念都還不存在的選角階段。有自己獨立的 `setTimeout`（`advanceCharacterSelection` 內建立，`server/src/socketHandlers.js`），逾時會準時觸發 `handleCharacterSelectTimeout`——**真實運作的機制，跟這次改動的範圍無關，完全不動**。
- **擲骰介入逾時**（`rollChoiceTimeoutMs`，20000ms）／**道具遺留逾時**（`inventoryChoiceTimeoutMs`，20000ms）／**卡片效果選擇逾時**（含烹飪彈窗，事件卡/預兆卡JSON裡寫死的`timeoutMs`，及`socketHandlers.js`烹飪效果內建的`20000`）：三者共用同一個缺陷——全伺服器只有2個`setTimeout`（角色選擇一個、`scheduleOrRefreshPhaseTimeout`一個），這三種彈窗的`timeoutMs`只是拿去算一個`prompt.deadline`欄位存起來，**沒有任何獨立計時器會在這個時間點做任何事**；真正執行強制決議的`resolveRollChoiceByTimeout`／`resolveEffectChoiceByTimeout`（只在`handlePhaseTimeout`裡被呼叫）也完全不檢查這個`deadline`，被呼叫就直接強制決議。前端（`DebugGameScreen.jsx`）這三種彈窗也沒有渲染任何倒數/進度條。**這個數值100%是死資料，唯一存在理由是`createPrompt()`的參數驗證要求必須給一個正整數。**

## 資料流

```
房主填秒數（20~90）
  → lobby:create payload { playerName, phaseTimeoutSeconds }
  → socketHandlers.js 的 lobby:create handler
  → LobbyManager.createRoom(name, socketId, phaseTimeoutSeconds)　// 內部驗證＋轉存ms
  → finishCharacterSelection 讀 lobbyManager.getPhaseTimeoutMs(roomCode)
  → gameManager.startGame({ ..., phaseTimeoutMs })
  → createGameState({ ..., phaseTimeoutMs })
  → gameState.phaseTimeoutMs　// phaseFlow.js 既有邏輯原封不動套用
```

## 伺服器變更

**`lobbyManager.js`**：
- 新增常數 `MIN_PHASE_TIMEOUT_SECONDS=20`、`MAX_PHASE_TIMEOUT_SECONDS=90`、`DEFAULT_PHASE_TIMEOUT_SECONDS=30`
- 新增 `normalizePhaseTimeoutSeconds(seconds)`（仿照既有`normalizePlayerName`）：`undefined`→回傳預設30；否則必須是20~90的整數，不符合拋`INVALID_PHASE_TIMEOUT`
- `createRoom(hostName, hostSocketId, phaseTimeoutSeconds)`：**驗證放在這裡**，房間記錄新增欄位`phaseTimeoutMs: normalizePhaseTimeoutSeconds(phaseTimeoutSeconds) * 1000`
- 新增 `getPhaseTimeoutMs(roomCode)`（仿照既有`getHostName`模式）：回傳該房間的`phaseTimeoutMs`，房間不存在回傳`null`

> 驗證放在`LobbyManager.createRoom()`內部而不是只在socket handler層，是因為這是唯一接觸不受信任輸入的入口——`lobby:create`直接把payload轉呼叫這個函式，兩者本來就是同一個信任邊界，沒有必要分兩層。

**`socketHandlers.js`**：
- `lobby:create` handler：從payload解構`phaseTimeoutSeconds`，傳給`lobbyManager.createRoom`；驗證失敗會拋`INVALID_PHASE_TIMEOUT`，既有的try/catch會自動透過`ack({error: err.message})`回傳給前端，不需要額外處理
- 移除`registerSocketHandlers`裡的`phaseTimeoutMs`／`rollChoiceTimeoutMs`／`inventoryChoiceTimeoutMs`三個閉包常數（`characterSelectTimeoutMs`保留不動）
- `finishCharacterSelection`改為內部直接呼叫`lobbyManager.getPhaseTimeoutMs(roomCode)`，不再從參數接收`phaseTimeoutMs`；連帶從`advanceCharacterSelection`、`handleCharacterSelectTimeout`的參數簽名移除這個已經不需要轉手的值
- 所有目前傳入`rollChoiceTimeoutMs`／`inventoryChoiceTimeoutMs`的`createPrompt`呼叫（`handleLeaveCheckRollPending`、`handleCollapseCheckRollPending`、`openInventoryChoiceIfNeeded`、`effectResolver.js`的`handleChoice`／`handlePreviewAndChoose`、烹飪選擇的`timeoutMs:20000`），改成直接讀取當下已在作用域內的`gameState.phaseTimeoutMs`
- 這兩個參數涉及約18個函式簽名（`scheduleOrRefreshPhaseTimeout`、`handlePhaseTimeout`、`finishMoveResult`、`resolveCardDraw`、`handleEffectResolveResult`、`handleRollChoicePending`、`resumeRollChoice`及其兩個變體、`resolveRollChoiceByTimeout`、`resolveEffectChoiceByTimeout`、`applyRoomEndTurnBonus`等）與約30處呼叫點的參數傳遞，全部移除——這是單純刪除死參數的機械式改動，不改變任何執行順序或分支邏輯

**`effectResolver.js`**：
- `handleChoice`、`handlePreviewAndChoose`不再讀`effect.timeoutMs`，改用`gameState.phaseTimeoutMs`（兩個函式都已經有`gameState`參數）

**資料檔案**：
- `data/cards/event-cards.json`（2處）、`data/cards/omen-cards.json`（1處）移除`"timeoutMs"`欄位——程式碼改動後這個欄位不會再被讀取，留著會誤導之後維護的人以為它有作用

## 為什麼這樣修不會產生新錯誤

沒有採用「即時計算階段剩餘時間」的做法（例如`gameState.phaseDeadline - Date.now()`），因為那樣可能算出0或負數，導致`createPrompt()`的`timeoutMs<=0`驗證拋出全新的`INVALID_TIMEOUT`錯誤。改用`gameState.phaseTimeoutMs`本身（固定20000~90000的正整數）沒有這個風險，且由於這三種逾時數值原本就是死資料（不影響任何實際執行流程、不影響任何畫面渲染），這次改動在行為層面等同於「刪除從未生效的程式碼」，不是「改變現有行為」。

## 前端變更

- `client/src/lobby/NicknameModal.jsx`：新增`phaseTimeoutSeconds` state，`nicknameFlow==='create'`時額外顯示一個`type="number"`輸入框（`min=20 max=90`，預設值30，`onConfirm`多回傳這個值），加入房間流程不顯示
- `client/src/LobbyScreen.jsx`：`handleNicknameConfirm`接收秒數，`lobby:create`的payload加上`phaseTimeoutSeconds`
- `client/src/lobby/errorMessages.js`：新增`INVALID_PHASE_TIMEOUT`的中文錯誤訊息翻譯

**不需要改動**：`PhaseCountdownPopup.jsx`／`DebugGameScreen.jsx`的階段倒數顯示已經是讀`gameState.phaseDeadline`動態算秒數，沒有任何寫死的持續時間假設，房主設定不同秒數會自動正確反映。

## 測試影響

既有測試裡，`socketHandlers.test.js`有3處（約2890/2918/2973行）透過`registerSocketHandlers(..., { phaseTimeoutMs: 100 })`設定極短的階段逾時來加速測試——這個路徑會隨著閉包常數移除而失效，需要改成透過`lobbyManager.createRoom`直接建房間時帶入短秒數（因為驗證只在`lobby:create`socket handler層，直接呼叫`LobbyManager.createRoom()`不受20~90秒範圍限制）。`gameState.test.js:181`直接呼叫`createGameState(..., {phaseTimeoutMs:5000})`不受影響（`createGameState`本身的參數介面沒有變動）。

**新增測試**：
- `lobbyManager.test.js`：`createRoom`不帶秒數→預設30000ms；帶合法值（20/90/中間值）→正確存儲；帶超出範圍或非整數→拋`INVALID_PHASE_TIMEOUT`；既有不帶第三參數的呼叫維持通過（回歸）；新增`getPhaseTimeoutMs`的測試
- `socketHandlers.test.js`：`lobby:create`帶合法/不合法`phaseTimeoutSeconds`的整合測試；一場遊戲從房主設定的秒數開始，驗證`gameState.phaseTimeoutMs`確實等於該值
- 回歸驗證：擲骰介入／道具遺留／卡片效果選擇彈窗在改用`gameState.phaseTimeoutMs`後，既有功能測試（非逾時路徑，即玩家正常回應的情境）應該完全不受影響，逾時cascade的既有測試（上一階段PR#3/#4修的部分）也要確認全綠

## 自我檢查

- 無占位符／待定事項
- 資料流、伺服器變更、前端變更三段的欄位名稱（`phaseTimeoutSeconds`、`phaseTimeoutMs`、`getPhaseTimeoutMs`）互相一致
- 範圍單一：只做「房主可設定的單一階段秒數」＋「清除3個死掉的舊逾時常數」，角色選擇逾時、房間生命週期清理、M3戰鬥系統均不在範圍內
