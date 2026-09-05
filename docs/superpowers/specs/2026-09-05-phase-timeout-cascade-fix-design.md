# handlePhaseTimeout 擲骰選擇 cascade 缺口修正 — 設計文件（Handover 項目14子專案7 後續待辦①）

## 背景

倒數計時機制上線後的全分支審查（2026-09-04）發現：`handlePhaseTimeout`（`server/src/socketHandlers.js`）處理逾時玩家時，對每個人固定依序呼叫一次「擲骰選擇→道具選擇→效果選擇」三個`resolveXByTimeout`函式。但解決一個逾時的擲骰介入選擇時，繼續解析原本被中斷的動作，途中可能因為抽到新的卡片、又冒出一個**全新的**擲骰介入選擇——這筆新選擇不在這一輪原本排定的處理清單裡，不會被清掉，玩家會被強制鎖進下一階段、卻背著一筆沒人回應過的待定選擇，下次行動會被`ROLL_CHOICE_IN_PROGRESS`擋下，直到玩家自己回應或等到下一次階段逾時才會被動清除。

**具體例子**：玩家持有「天使羽毛」（`item_005`，`diceInterjection.scope:"any"`，可介入任何考驗）。玩家嘗試離開房間觸發`leaveCheck`，因持有介入道具開出第一筆擲骰選擇彈窗，逾時沒人回應。`handlePhaseTimeout`介入處理：判定「不使用道具」，讓考驗照常進行、通過、進入新房間。進新房間自動抽卡，若玩家身上還有另一件`scope:"any"`介入道具，這張新卡的考驗又立刻開出**第二筆**全新的擲骰選擇彈窗——這一筆就是漏掉的那筆。

**查證確認的範圍**：道具選擇的cascade已經被現有機制自然接住（`handlePhaseTimeout`本來就是「擲骰→道具→效果」照順序執行，擲骰選擇解決過程中冒出的新道具選擇，會被同一輪緊接著的道具選擇解析抓到，不需要額外處理）。「效果選擇（`random`）又冒出新選擇」目前沒有任何卡片資料會觸發，純理論路徑，不在這次範圍內。**只有「擲骰選擇冒出新擲骰選擇」這一條路徑需要修正。**

## 設計

### 判斷「現在是逾時處理中」的方式：明確標記，不用時間比對

不用「`Date.now()`是否超過`gameState.phaseDeadline`」這種隱含判斷——伺服器忙碌時`setTimeout`可能晚幾毫秒才真正執行，這段空檔內如果玩家自己真的手動操作、剛好也落在「技術上已超過deadline」的時間點，用時間判斷會把玩家真實的操作誤判成逾時處理、沒詢問就直接套用預設值。改用一個明確的布林參數`isTimeoutCascade`（預設`false`），只沿著逾時處理本來就會呼叫的那一條函式鏈路往下傳，不影響其他呼叫路徑。

### 需要修改的呼叫鏈（全部在 `server/src/socketHandlers.js`）

```
resolveRollChoiceByTimeout（逾時入口，呼叫時固定帶 isTimeoutCascade:true）
  → resumeRollChoice(..., isTimeoutCascade)
    → resumeLeaveCheckRollChoice(..., isTimeoutCascade) 或 resumeCollapseCheckRollChoice(..., isTimeoutCascade)
      → finishMoveResult(..., isTimeoutCascade)
        → resolveCardDraw(..., isTimeoutCascade)（進新房間抽卡）
          → handleEffectResolveResult(..., isTimeoutCascade)
            → handleRollChoicePending(..., isTimeoutCascade)  ← 問題發生點
```

8個函式都加一個新的**選填**參數`isTimeoutCascade = false`，只有`resolveRollChoiceByTimeout`呼叫`resumeRollChoice`時明確帶`true`，其餘全部維持預設值`false`——不影響任何其他既有呼叫這幾個函式的路徑（例如正常的`game:move`/`game:selectAction`流程完全不受影響）。

### 核心行為變更：`handleRollChoicePending`

目前這個函式收到一個新的擲骰考驗（`effectResult.pending && effectResult.rollChoice`）時，一律建立新的`prompt`、寫入`pendingRollChoice`、廣播`game:diceChoicePending`給玩家。

**修改後**：如果`isTimeoutCascade === true`，跳過上述建立彈窗的步驟，直接視同玩家選擇「不介入」，呼叫：
```js
resumeRollChoice(io, effectResolverManager, gameState, roomCode, playerId, 'diceCheck',
  { effect: effectResult.effect, sourceId, consumeItemIfApplied, sourceDeckType: effectResult.sourceDeckType },
  null, content, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, true /* isTimeoutCascade */);
```
這跟`resolveRollChoiceByTimeout`本來處理「真的有玩家逾時未回應」時的做法完全一樣（`interjectionChoice: null`），差別只在於這裡沒有一個真的被建立過的`prompt`需要先結束。因為是遞迴呼叫、`isTimeoutCascade`會一路帶著往下傳，如果這次解析又冒出下一層新選擇，一樣會被同一套邏輯接住，不需要額外設遞迴次數上限——介入道具使用後會被標記為已消耗/已使用，遊戲機制本身就保證這條鏈不會無限延伸。

### 不做的部分

- 不處理「道具選擇」「效果選擇（`random`）」的cascade——前者已被現有順序自然接住，後者目前無資料會觸發，屬於推測性/尚不需要的防禦程式碼，等未來真的有卡片會踩到再處理。
- 不改變任何一般（非逾時）流程下`handleRollChoicePending`的行為——`isTimeoutCascade`預設`false`，正常玩家操作路徑完全不受影響。

## 測試

需要新增至少一個測試，模擬「兩件`scope:"any"`介入道具、連續兩次考驗、`handlePhaseTimeout`一次處理」的完整情境，驗證：
1. 逾時處理完成後，該玩家不會殘留任何`pendingRollChoice`/待定的`promptState`項目
2. 玩家最終正確被鎖定進下一階段（沒有被殘留選擇卡住）
3. 過程中沒有廣播`game:diceChoicePending`給這第二筆本應被自動處理掉的選擇（確認彈窗真的沒有跳出來，不只是跳出來又馬上消失）

## 範圍排除

角色選擇逾時、階段倒數機制本身、道具/效果選擇的既有逾時邏輯，皆不受這次改動影響。
