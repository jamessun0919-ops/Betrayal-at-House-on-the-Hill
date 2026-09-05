# 階段倒數計時機制與伺服器基礎建設 — 設計文件（Handover 項目14 子專案7）

## 目標

讓每個回合階段（`player_move`／`npc_move`／`player_interact`／`npc_interact`／`settlement`）都有一個可設定秒數的倒數計時，逾時後自動鎖定尚未鎖定的玩家/NPC，讓階段一定能推進，不會被卡住的玩家無限期拖住。同時淘汰回合制殘留下來的4套「個別選擇逾時」系統（角色選擇除外），因為它們的資料結構是「整個房間共用一格待定選擇」，在新的並發回合制下會讓一位玩家的選擇卡住整個房間所有人。

## 現況（查證結果）

現有4套逾時系統：

| 系統 | 秒數 | 逾時預設行為 | 出現階段 |
|---|---|---|---|
| 角色選擇（`characterSelectTimeouts`） | 30s | 隨機分配角色 | **回合制開始前**，`enterPhase('player_move')` 都還沒執行 |
| 擲骰介入（`rollChoiceTimeouts`） | 20s | 自動跳過介入道具，正常擲骰繼續判定 | `player_move`／`player_interact` |
| 道具選擇（`inventoryChoiceTimeoutHandle`） | 20s | 自動丟棄剛拿到、超過上限的那件道具 | `player_move`／`player_interact` |
| 效果選擇（`effectChoiceTimeouts`） | 卡片自訂（目前皆20s） | 套用卡片宣告的 `defaultOptionId` | `player_move`／`player_interact` |

**根本問題**：擲骰介入／道具選擇／效果選擇這3套系統，底層共用同一個「每個房間只有一格」的待定選擇容器（`server/src/game/promptState.js` 的 `container.pending`，`server/src/game/effectResolverManager.js` 每個房間只建立一個 `resolverEntry.promptState`）。`server/src/socketHandlers.js` 的 `hasPendingEffectChoice`／`hasPendingRollChoice`／`hasPendingInventoryChoice`（第703-716行）guard 只吃 `roomCode`，不吃 `playerId`——玩家A的待定選擇會擋住玩家B完全無關的 `game:move`／`game:selectAction`／`game:useStairs`／`game:lockPhase`。這在舊制輪流回合下沒問題（同時間本來就只有一人能動），但在現行並發回合制下是真實的多人衝突。

`promptState.js` 的 `createPrompt` 已經帶有 `targetPlayerId` 欄位（只是容器本身沒有拿它當 key），改分玩家的轉換成本因此不高。

角色選擇逾時完全發生在回合階段系統執行之前（`finishCharacterSelection` 呼叫 `startGame` 才第一次進入 `player_move`），跟這次改動的範圍無關。

前端（`client/src/DebugGameScreen.jsx`）目前完全沒有真正的倒數UI，只有角色選擇畫面一行靜態文字「倒數至幾點幾分」，其餘3種待定選擇彈窗完全不顯示deadline。

## 已確認設計

### 一、階段倒數秒數不寫死

`gameState` 新增 `phaseTimeoutMs` 欄位，由 `createGameState`（`server/src/game/gameState.js`）以參數方式帶入，預設 `30000`（30秒）。`phaseFlow.js` 一律讀 `gameState.phaseTimeoutMs`，不寫死常數。**這是為了之後「房主在建立大廳時可調整各階段倒數秒數」的功能預留擴充點**——那個功能本身不在這次範圍內，只需要之後把房主選的值一路傳到 `gameManager.js` 呼叫 `createGameState` 的地方即可，不用改這次做的核心邏輯。已記錄為新待辦（見下方範圍排除）。

### 二、階段倒數機制（伺服器）

- `phaseFlow.js` 的 `enterPhase(gameState, phase)` 每次真正進入一個階段時，設定 `gameState.phaseDeadline = now + gameState.phaseTimeoutMs`（純資料，`phaseFlow.js` 不含計時器本體與I/O，維持既有架構原則）。
- `socketHandlers.js` 新增一個共用函式（暫定 `scheduleOrRefreshPhaseTimeout`），在任何可能觸發 `enterPhase`／`advancePhase` 的操作之後呼叫：
  - `handleLockPhase`（`game:lockPhase`／`game:endTurn` 共用實作，第461-504行一帶）鎖定完成之後
  - `handleRemoveImprint` 的 NPC 刪除連動（Handover項目8最終審查修正新增的 `allParticipantsLocked`/`advancePhase` 呼叫）之後
  - 這個函式比對「現在的 `gameState.phaseDeadline` 是不是跟上次排的那個一樣」，不一樣就清掉舊 `setTimeout`、依新的 `phaseDeadline` 排一個新的，一樣就不動（避免重複排程或不必要延長/縮短玩家看到的剩餘時間）
- `phaseDeadline` 隨 `game:stateUpdate` 一起廣播（`serializeGameState` 已經會帶 `currentPhase`，這次加一個同層欄位）。
- 逾時處理函式（暫定 `handlePhaseTimeout`）：對 `getParticipants(gameState, gameState.currentPhase)` 裡所有 `phaseLocked !== true` 的玩家/NPC，依序：
  1. 如果這位有未解決的待定選擇（roll/inventory/effect 三種之一），依下方「三、選擇類型的逾時邏輯」處理
  2. 呼叫 `lockPlayerPhase(gameState, thatPlayerId)` 強制鎖定
  - 全部處理完後，`lockPlayerPhase` 內建的 `allParticipantsLocked` 判斷會自動觸發 `advancePhase`（沿用既有機制，不用另外寫）
  - 處理完後廣播一次 `game:stateUpdate`
  - **NPC 補充說明**：查證確認 `npcFlow.js` 的 `moveNpc`／`npcItemAction` 完全不會呼叫 `resolveEffects`／`createPrompt`，NPC 目前不可能有待定選擇。所以逾時處理函式對 NPC 參與者只會執行「呼叫 `lockPlayerPhase` 強制鎖定」這一步，第1步（待定選擇處理）對 NPC 永遠是no-op，不需要額外分支。

### 三、選擇類型的逾時邏輯

**擲骰介入**：拿掉獨立的20秒 `rollChoiceTimeouts` 計時器與 handler。逾時時，等同玩家自己按了「不使用道具」——呼叫既有的 `resumeRollChoice(..., interjectionChoice: null, ...)` 路徑，讓被介入的原動作（例如離開房間的考驗）正常繼續、照樣扣原動作的行動力、通過/失敗照舊判定。介入本身不扣行動力，也不會取消被介入的動作。

**道具選擇**：拿掉獨立的20秒 `inventoryChoiceTimeoutHandle` 計時器。逾時時，沿用既有的 `pickInventoryChoiceDefault` 邏輯（丟棄最新拾取、超過上限的那件），搜索/拾取本身視為已完成（行動力已扣）。

**效果選擇**：拿掉獨立的 `effectChoiceTimeouts` 計時器。卡片資料新增 `onTimeout` 欄位（`'skip'` 或 `'random'`，預設 `'skip'`）：
- `onTimeout: 'skip'`（預設，適用大多數卡片，例如 `event_010`「電話鈴聲」選能力提升、房間烹飪選擇、`omen_003`「命運之輪」的 `preview_and_choose`）：逾時什麼都不發生，等同現有「安全牌」選項的效果（不換牌/不烹飪/不加值）
- `onTimeout: 'random'`（目前只有 `event_031`「紅藍藥丸」需要）：逾時從 `options` 陣列隨機選一項套用其效果——因為這張卡三個選項效果本來就完全相同（都觸發 50/50 意志加減），逾時不能變成比手動選還安全的漏洞
- 一般設計原則（供之後新卡片參考）：逾時是不鼓勵的行為，效果設計上要傾向對玩家不利，不能讓「什麼都不做」變成比「認真選」更划算的策略——只有選項效果本來就無法迴避時才用 `'random'`，其餘預設 `'skip'`

**角色選擇逾時維持原樣不動**，不受這次任何改動影響。

### 四、待定選擇資料結構改分玩家

- `promptState.js`：`createPromptState()` 從 `{ pending: null }` 改成 `{ pending: new Map() }`（key 為 `targetPlayerId`）。`createPrompt`／`respondToPrompt`／`resolvePromptTimeout`／`getPendingPrompt` 改成依 `playerId` 存取 Map 裡對應那一格，不再是單一物件；`PROMPT_ALREADY_PENDING` 的檢查改成「這位玩家自己」是否已經有一個待定選擇，不影響其他玩家。
- `effectResolverManager.js` 的 `resolverEntry`：`pendingChoice`／`pendingRollChoice`／`pendingInventoryChoice` 三個欄位從單一值改成以 `playerId` 為 key 的 Map；`inventoryChoiceTimeoutHandle` 這次連同其所屬的獨立計時器一併刪除（見上方「三」）。
- `socketHandlers.js` 的 `hasPendingEffectChoice`／`hasPendingRollChoice`／`hasPendingInventoryChoice` 三個 guard 改成吃 `(effectResolverManager, roomCode, playerId)`，只查「這位玩家自己」的那一格，`game:move`／`game:selectAction`／`game:useStairs`／`handleLockPhase` 四處呼叫點跟著改傳 `playerId`。
- 這是整個系統範圍最大的一塊改動，牽涉 `promptState.js`／`effectResolverManager.js`／`effectResolver.js`／`socketHandlers.js` 十幾個呼叫點，之後寫實作計畫時要逐一列出。

### 五、前端：可拖曳的階段倒數彈窗

- 新增獨立元件（暫定 `PhaseCountdownPopup`），`position: fixed`，可拖曳（pointer事件）。拖曳後的座標存 `localStorage`（每個瀏覽器/裝置各自記憶，不跟伺服器同步，符合「這是使用者的本機UI偏好」的定位），下次出現自動套用上次位置。
- 顯示內容：目前階段名稱＋倒數秒數。
- 顯示時機：只要目前 `gameState.currentPhase` 是五個階段之一、且該玩家自己（或其操控的NPC，視目前操控實體切換器選的是誰）還沒鎖定，就顯示；鎖定後可以選擇隱藏或改顯示「等待其他玩家」文字（實作計畫階段再定案細節，不影響這次架構設計）。
- 既有的三種選擇彈窗（效果/擲骰/道具）維持原樣讓玩家做選擇，不再各自顯示或依賴自己的倒數，統一由這個新彈窗顯示唯一的階段倒數。

## 範圍排除（留給後續子專案）

- **大廳建立時房主可調整各階段倒數秒數**：新增待辦，這次只確保程式碼「不寫死、留接入點」，實際的房主可調整UI與資料流不在這次範圍。
- M3 相關的傷害/戰鬥系統：不受這次改動影響。
- 角色選擇逾時：確認維持原樣，不動。

## 已知風險與影響

- 這次改動觸及的檔案範圍大（前面列的 `promptState.js`／`effectResolverManager.js`／`effectResolver.js`／`socketHandlers.js`／`phaseFlow.js`／`gameState.js`／前端多個檔案），現有測試裡大量測試直接依賴「房間共用一個pending slot」的假設（例如某些測試會用另一位玩家的視角確認被擋下），實作計畫階段需要逐一查證會受影響的既有測試範圍。
- 拿掉獨立計時器＋改成階段共用倒數之後，玩家從「觸發選擇」到「被強制套用逾時結果」的實際可用時間，會因為觸發時間點落在階段的第幾秒而不同（例如階段開始就觸發選擇的人有將近30秒可以想，階段快結束才觸發的人可能只剩幾秒）——這是這次設計已知且接受的行為變化，不是bug。
