# 既有機制歸類到各階段＋新舊回合制交接 —— 設計文件（M2E 第二子專案）

## 目標

讓 2026-09-02 完成的五階段狀態機骨架（`server/src/game/phaseFlow.js`）真正接管遊戲行為：把現有會做「回合擁有權」判斷的程式碼，逐步從舊制（`turnFlow.js` 的 `turnOrder`/`currentPlayerIndex`/`getCurrentTurnPlayerId`）換成新制（`gameState.currentPhase`/`player.phaseLocked`），最終讓舊制完全退役。行動力欄位（`actionPoints`）的重置時機，也在這個過程中正式交給新制單一擁有。

依開發者要求拆成多個階段依序實作，每個階段各自有自己的 Jest 測試驗證；過渡期間新舊兩制同時存在、判斷邏輯不完全一致，是刻意接受的中間態（開發者明確表示：在整個回合制改動全部完成之前，不會進行多人真實上線測試，只要求每個階段自己的測試邏輯正確）。原本規劃階段A→B→C→D，2026-09-03 brainstorm階段C時發現順序有問題（見下方階段C/D/UI各自的說明），最終改為 A→B→UI→D→C。

## 現況

- `turnFlow.js` 目前有 4 個函式會做回合擁有權判斷：`moveToRoom`、`useStairs`、`selectAction`、`endTurn`，判斷方式統一是 `getCurrentTurnPlayerId(gameState) !== playerId` → `throw Error('NOT_YOUR_TURN')`。另外 `moveSummon`/`selectSummonAction` 也有同款判斷，但那是既有 `switch_control` 一次性附身機制專用（Handover 項目8已確認整個要被取代），不在這次歸類範圍內。
- `socketHandlers.js` 本身完全沒有自己的回合判斷邏輯，所有判斷都委派給上述 `turnFlow.js` 函式，抓到錯誤後原樣轉成 `ack({error})`——這代表新制上線後，`socketHandlers.js` 幾乎不需要改動，改動全部集中在 `turnFlow.js`。
- `game:effectPromptRespond`／`game:diceChoiceRespond`／`game:inventoryChoiceRespond`／`game:promptRespond` 這幾個「回應待定選擇」的 handler，判斷依據是 `resolverEntry.pendingChoice` 綁定的玩家 id，跟回合擁有權完全無關，**不在這次歸類範圍內，不用改**。
- `selectAction` 是一個 dispatcher，內部依 `actionType`/`mode` 分成多個子動作，各子動作影響其他角色的程度不同，無法整支函式套用單一階段。

## 分類結果

依 2026-09-02 骨架設計文件的分類原則（會不會影響其他角色）：

**player_move（不影響其他角色）**：
- `moveToRoom`（移動、開門、進新房間、觸發房間/預兆效果、考驗）
- `useStairs`（上下樓梯）
- `selectAction` 內：`mode: 'leave'`、`'pickup'`、`'wield'`、`'unwield'`、`'wear'`、`'unwear'`、`actionType: 'room_action'`、道具使用且目標是自己（`effectTargetId === playerId`）

**player_interact（影響其他角色）**：
- `selectAction` 內：`mode: 'give'`（把道具給別人）、道具使用且鎖定別人（`itemCanTargetOthers` 為真且目標非自己）、`actionType: 'attack'`（M3 尚未實作內容，這裡只先接對階段，之後 M3 補內容不用再改這塊）

**待確認假設，目前資料下唯一已知案例（密室骰子考驗）不影響其他角色，暫歸 player_move**：`room_action` 目前只有這一種已知用途，如果之後新增會影響其他角色的 `room_action`，需要另外處理，屆時不在這份文件涵蓋範圍內。

## 技術設計：分四階段實作

### 階段 A：`moveToRoom` ＋ `useStairs`

這兩支函式判斷邏輯單純、不涉及動態分支，可以獨立完成，不需要等其他階段。

在 `phaseFlow.js` 新增一個匯出函式：

```javascript
function requirePhase(gameState, playerId, expectedPhase) {
  const player = requirePlayer(gameState, playerId);
  if (player.isNPC || gameState.currentPhase !== expectedPhase) {
    throw new Error('NOT_YOUR_PHASE');
  }
  if (player.phaseLocked) {
    throw new Error('ALREADY_LOCKED');
  }
}
```

刻意重用 `lockPlayerPhase` 已經在用的兩個錯誤代碼（`NOT_YOUR_PHASE`／`ALREADY_LOCKED`），不新增錯誤代碼——語意上都是「現在的階段狀態不允許你做這件事」，不需要為了「哪個函式丟出來的」細分不同代碼。`requirePhase` 自己呼叫 `phaseFlow.js` 既有的內部 `requirePlayer`（跟 `turnFlow.js` 自己的 `requirePlayer`是兩支獨立的函式，各自只依賴自己模組內的東西，維持骨架階段就定案的「`phaseFlow.js` 不依賴 `turnFlow.js`」原則），跟 `turnFlow.js` 函式原本自己呼叫的 `requirePlayer` 各自獨立查一次玩家物件——有一次重複查找的代價，換取兩個模組不互相依賴。

`turnFlow.js` 的改動：
- 新增 `const { requirePhase } = require('./phaseFlow');`
- `moveToRoom`：把 `if (getCurrentTurnPlayerId(gameState) !== playerId) { throw new Error('NOT_YOUR_TURN'); }` 換成 `requirePhase(gameState, playerId, 'player_move');`
- `useStairs`：同樣替換

`selectAction`／`endTurn`／`moveSummon`／`selectSummonAction` 這階段完全不動，繼續用舊制判斷。

### 階段 B：`selectAction` 整個 dispatcher

不能只做子動作的一半（見上方 brainstorm 紀錄：`give`/`attack` 如果暫時失去任何判斷會是行為倒退，不是中性的未完成狀態），這個函式的所有子動作要在同一個階段一次做完。

移除函式最上方的 `if (getCurrentTurnPlayerId(gameState) !== playerId) { throw new Error('NOT_YOUR_TURN'); }`，改成在每個子動作分支各自呼叫 `requirePhase`，用對應分類的階段名稱：

- `mode: 'leave'/'pickup'/'wield'/'unwield'/'wear'/'unwear'` 呼叫前先 `requirePhase(gameState, playerId, 'player_move')`
- `actionType: 'room_action'` 同樣 `player_move`
- `mode: 'give'` 呼叫前 `requirePhase(gameState, playerId, 'player_interact')`
- 道具使用（無 `mode`，即現有第 555-571 行的通用路徑）：先算出 `effectTargetId`（既有邏輯不變），再依 `effectTargetId === playerId ? 'player_move' : 'player_interact'` 呼叫 `requirePhase`
- `actionType: 'attack'`：`requirePhase(gameState, playerId, 'player_interact')`

`actionType`合法性檢查（`INVALID_ACTION_TYPE`）與行動力檢查（`NOT_ENOUGH_ACTION_POINTS`）維持在函式最上方、不用等到判斷完階段才檢查——這兩個是跟階段完全無關的既有驗證，維持原本檢查順序即可。

### 階段 UI：前端每階段結束按鈕、結算彈窗

**已於 2026-09-03 完成並合併**（原本排在階段D之後，brainstorm階段C時發現移除舊制行動力重置會讓單人測試也玩不下去，往下追查又發現階段D退役 `endTurn` 若沒有前端UI會讓玩家完全無法結束回合，兩次發現都指向同一個結論：UI要先做。最終順序改為 UI→D→C，詳見 Handover 項目14）。範圍：`client/src/DebugGameScreen.jsx` 唯一的「回合結束」按鈕改名「階段結束」、呼叫目標從 `game:endTurn` 改成 `game:lockPhase`；新增依 `currentPhase === 'settlement'` 條件渲染的結算確認彈窗（重用既有 `SimplePopup`，無實際結算內容）。合併後緊接著發現並修復一個真實回歸：`advanceTurn` 原本負責的 `searchedThisTurn`／`diceInterjectionUsedThisTurn`／`pendingStatReverts` 三個每回合重置，因為按鈕不再呼叫 `game:endTurn` 而完全停止運作——已搬進 `enterPhase`，詳見 Handover 項目14。

### 階段 D：舊制正式退役（2026-09-03 定案，執行順序排在階段C之前）

**範圍已確認，尚未實作**：

- **`turnOrder`／`currentPlayerIndex`／`getCurrentTurnPlayerId` 保留，作為純讀取資料**：`gameManager.js` `startGame` 依然在開局時洗牌初始化一次，之後永遠不再被任何邏輯推進（`advanceTurn` 被刪除後，沒有任何呼叫點會改變 `currentPlayerIndex`）。保留原因：`moveSummon`／`selectSummonAction`（Handover 項目8的犬靈操控機制，已知完全沒有前端UI可觸發、確定會被項目8的新NPC實體模型整個取代）仍然依賴 `getCurrentTurnPlayerId` 做擁有權判斷——與其現在花力氣改寫這兩支即將被整個換掉的函式，不如保留它們依賴的既有函式當作靜態唯讀資料的消費端，等項目8真正重寫召喚機制時一併處理。
- **`turnFlow.js` 的 `advanceTurn`／`endTurn` 刪除**：這兩支函式是真正驅動回合推進的邏輯，現在完全沒有任何路徑會呼叫到（`game:endTurn` 這個 socket 事件名稱本身保留，見下方，但內部不再呼叫這兩支函式）。`advanceTurn` 原本做的三件事：①行動力重置、②`searchedThisTurn`／`diceInterjectionUsedThisTurn`／`pendingStatReverts` 三個每回合重置——**這兩類已於 2026-09-03 搬進 `phaseFlow.js` 的 `enterPhase`**（上方「階段UI」小節記錄的回歸修復，已完成並合併，不是這個階段的工作）；③操控者結束回合時強制清空 `summons`（含掉落召喚物身上道具）——**刻意不搬，留給項目8**，這段邏輯屬於即將被整個取代的舊召喚機制，搬過去是白工。
- **`game:endTurn` socket 事件保留，內部改成呼叫 `lockPlayerPhase`（不是刪除）**：查證發現 `socketHandlers.test.js` 裡有 42 次 `game:endTurn` 引用，但大多數測試真正要測的不是 `endTurn` 本身，是借用它當「推進遊戲狀態」的工具去測試其他機制（例如 `applyRoomEndTurnBonus` 的「房間 onceOnlyPerPlayer 加成」、`grant_item` 觸發背包選擇會擋住 `endTurn`、待定的擲骰/效果選擇會擋住 `endTurn` 等）。**開發者確認：保留 `game:endTurn` 這個 socket 事件名稱當作 `game:lockPhase` 的相容別名，降低測試改寫風險**——舊制的擁有權判斷（`NOT_YOUR_TURN`）真的不存在了，只是 socket 事件名稱本身不變。具體改法：
  - `endTurn(gameState, playerId)` 呼叫改成 `lockPlayerPhase(gameState, playerId)`
  - `SUMMON_ACTIVE` 檢查（`if (player.summons) throw...`）手動保留在 `socketHandlers.js` 的 handler 裡（原本在 `endTurn` 函式內，函式被刪除後這個檢查需要留在呼叫端），維持既有測試「操控召喚物時不能結束回合」的行為不變
  - `applyRoomEndTurnBonus` 呼叫不受影響（它是依 `playerId`——執行動作的那個人——判斷，不是依 `nextPlayerId`，跟底層是舊制還是新制無關）
  - ack 回傳格式從 `{ nextPlayerId }` 改成 `{ currentPhase: gameState.currentPhase }`（比照 `game:lockPhase` 自己的 handler）——目前只有 1 個既有測試斷言 `result.nextPlayerId`，需要跟著改
- **已知風險，實作時要注意**：`game:endTurn` 保留事件名稱不代表行為完全等價。舊制下，兩位真人玩家依序呼叫 `game:endTurn` 的效果是「輪流切換誰是當前玩家」；新制下，呼叫 `game:lockPhase`（別名）的效果是「鎖定呼叫者自己的階段，等全體都鎖定才會真的推進」——多人依序呼叫的中間狀態不完全一樣（例如 p1 呼叫後 p2 呼叫，舊制會變成「換 p2 的回合」，新制是「p1、p2都鎖定，一起進下一階段」）。這代表現有測試即使**程式碼不用改**，也需要**逐一確認斷言的觀察結果在新語意下依然成立**，不能只看「有沒有編譯過/呼叫路徑還在」就當作沒問題——這個查核工作是實作階段（SDD執行）的一部分，不是這份設計文件能提前窮舉完的。
- **現有測試遷移**：`turnFlow.test.js` 裡直接測試 `advanceTurn`／`endTurn` 自身行為的測試（約15個，含 `searchedThisTurn`/`diceInterjectionUsedThisTurn` 重置測試——這兩個已經在 `phaseFlow.test.js` 有對應的新測試，刪除不會留下覆蓋率缺口）要跟著函式一起刪除；`getCurrentTurnPlayerId` 自己的測試（2個）與 `moveSummon`／`selectSummonAction` 的既有測試維持不動（函式本身沒變）。`socketHandlers.test.js` 的 42 個 `game:endTurn` 引用，只有 1 個（`nextPlayerId` 斷言）確定要改，其餘依上一點的風險說明逐一查核。

### 階段 C：行動力欄位所有權交接（2026-09-03 定案，執行順序排在階段D之後）

移除 `turnFlow.js` `advanceTurn` 裡的 `resetActionPoints(nextPlayer)` 呼叫——但階段D已經把 `advanceTurn` 整支函式刪掉了，所以階段C做到這裡時，這一步實際上已經自動完成，階段C真正剩下的工作只是**確認**沒有任何殘留路徑還在重置行動力，以及視情況清理設計文件/註解裡對「兩套重置時機點」的過時描述。這一步的原始動機（2026-09-02 骨架完成時發現的「連續呼叫 `game:lockPhase` 可以繞一圈把行動力提前刷新」問題）已經在 2026-09-03 搬移三個每回合重置到 `enterPhase` 時一併解決。

## 已知影響與風險

**階段A上線後，在沒有前端 UI 串接（後續子專案清單第4項）以前，`gameState.currentPhase` 實際上會永遠停在 `'player_move'`**——因為目前沒有任何客戶端會呼叫 `game:lockPhase`，階段永遠不會推進。這代表階段A上線後，`moveToRoom`/`useStairs` 的行為會變成「任何真人玩家在任何時候都能移動」，不再受舊制「只有輪到的人能動」限制。

- **對單人手動測試（開發者目前的驗收方式）沒有影響**：單人遊戲裡，「任何玩家都能動」等於「唯一那位玩家能動」，跟現在的行為完全一樣。
- **對多人遊戲是真實的行為改變**：多位真人玩家會發現彼此可以同時移動，不再需要輪流。這正是回合制改造最終想要的效果，只是提早在階段A（UI還沒做出來）就已經生效，而不是等到全部階段做完才出現。開發者已表示在整個改造完成前不會做多人真實測試，所以這個提早生效的中間態不影響驗收，這裡明確記錄下來避免之後誤以為是 bug。

## 範圍排除

- 並發安全機制（先到先得的實際程式碼）：後續子專案清單第3項，等這裡的分類/階段真正允許多人同時行動後才有意義做
- M3 傷害/攻擊系統本身：`attack` 這裡只接對階段，不實作內容
- 互動階段結算的實際運算規則：後續子專案清單第5項
- NPC 操控機制：Handover 項目8，等這裡跟並發機制先穩定
- 倒數計時：後續子專案清單第7項
- 召喚物（`moveSummon`／`selectSummonAction`）的既有回合擁有權判斷與 `advanceTurn` 原本的清理邏輯：留給項目8 NPC實體模型重寫時一併處理，不在這份文件任何階段的範圍內
