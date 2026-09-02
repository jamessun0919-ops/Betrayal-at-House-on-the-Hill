# 既有機制歸類到各階段＋新舊回合制交接 —— 設計文件（M2E 第二子專案）

## 目標

讓 2026-09-02 完成的五階段狀態機骨架（`server/src/game/phaseFlow.js`）真正接管遊戲行為：把現有會做「回合擁有權」判斷的程式碼，逐步從舊制（`turnFlow.js` 的 `turnOrder`/`currentPlayerIndex`/`getCurrentTurnPlayerId`）換成新制（`gameState.currentPhase`/`player.phaseLocked`），最終讓舊制完全退役。行動力欄位（`actionPoints`）的重置時機，也在這個過程中正式交給新制單一擁有。

依開發者要求拆成四個階段依序實作，每個階段各自有自己的 Jest 測試驗證；過渡期間新舊兩制同時存在、判斷邏輯不完全一致，是刻意接受的中間態（開發者明確表示：在整個回合制改動全部完成之前，不會進行多人真實上線測試，只要求每個階段自己的測試邏輯正確）。

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

### 階段 C：行動力欄位所有權交接

移除 `turnFlow.js` `advanceTurn` 裡的 `resetActionPoints(nextPlayer)` 呼叫——這一步做完之後，行動力重置只剩 `phaseFlow.js` 的 `enterPhase` 這一個時機點，2026-09-02 骨架完成時發現的「連續呼叫 `game:lockPhase` 可以繞一圈把行動力提前刷新」問題會自然消失（因為屆時舊制根本不會再自己重置行動力，兩套時機點的衝突不存在了）。

### 階段 D：舊制正式退役

- `turnOrder`/`currentPlayerIndex`/`advanceTurn`/`endTurn`/`getCurrentTurnPlayerId` 移除，或視情況保留 `turnOrder` 純粹作為初始座位/UI排序用途（不再讀取來做任何行動閘門判斷）——實際保留或移除，等做到這階段、盤點清楚還有沒有其他地方依賴 `turnOrder` 的既有語意（例如角色 icon 排序、初始房間分配）再決定，這裡先不定案。
- `game:endTurn` socket 事件、對應的「結束回合」按鈕語意上被 `game:lockPhase`（鎖定目前階段）取代——UI 串接（後續子專案清單第4項）會處理實際前端改動，這裡只處理伺服器端退役。
- 現有 717 個測試裡，凡是假設嚴格輪流制（例如手動設定 `gameState.turnOrder`/`currentPlayerIndex`、依賴 `advanceTurn` 換人）的測試，需要同步改寫成新制的階段/鎖定語意。這一步不是「事後遷移」，是這個階段本身的驗收條件——階段D做完，全部測試應該只依賴新制通過，不再依賴舊制。

## 已知影響與風險

**階段A上線後，在沒有前端 UI 串接（後續子專案清單第4項）以前，`gameState.currentPhase` 實際上會永遠停在 `'player_move'`**——因為目前沒有任何客戶端會呼叫 `game:lockPhase`，階段永遠不會推進。這代表階段A上線後，`moveToRoom`/`useStairs` 的行為會變成「任何真人玩家在任何時候都能移動」，不再受舊制「只有輪到的人能動」限制。

- **對單人手動測試（開發者目前的驗收方式）沒有影響**：單人遊戲裡，「任何玩家都能動」等於「唯一那位玩家能動」，跟現在的行為完全一樣。
- **對多人遊戲是真實的行為改變**：多位真人玩家會發現彼此可以同時移動，不再需要輪流。這正是回合制改造最終想要的效果，只是提早在階段A（UI還沒做出來）就已經生效，而不是等到全部階段做完才出現。開發者已表示在整個改造完成前不會做多人真實測試，所以這個提早生效的中間態不影響驗收，這裡明確記錄下來避免之後誤以為是 bug。

## 範圍排除

- 並發安全機制（先到先得的實際程式碼）：後續子專案清單第3項，等這裡的分類/階段真正允許多人同時行動後才有意義做
- 前端 UI（每階段結束按鈕、結算彈窗）：後續子專案清單第4項
- M3 傷害/攻擊系統本身：`attack` 這裡只接對階段，不實作內容
- NPC 操控機制：Handover 項目8，等這裡跟並發機制先穩定
- 倒數計時：後續子專案清單第7項
