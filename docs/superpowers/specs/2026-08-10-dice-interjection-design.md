# 可被道具介入的擲骰（Dice Interjection）設計文件

## 背景與目標

`data/cards/item-cards.json` 有 3 張卡片的效果是「在其他考驗/擲骰**即將發生前**，玩家可以選擇使用這張道具去影響那次擲骰結果」：

| 卡片 | 效果 |
|---|---|
| `item_005` 天使羽毛 | 擲骰前可用，用後玩家自選 0~8 數字取代該次擲骰結果，用一次後消失 |
| `item_006` 詭異人偶 | 擲骰前可用，多骰兩顆（骰數上限 8），代價意志下降一級，每回合限一次，不會消失 |
| `item_010` 蠟燭 | 玩家因**事件卡**需要考驗時可用，多骰一顆（上限 8） |

這三張卡的共通點：它們不是「自己觸發、自己算完」的一次性效果（不適合塞進現有的 `effects` 陣列），而是**介入另一個正在進行中的擲骰**。現有的擲骰觸發點有兩個，彼此完全獨立：

1. `effectResolver.js` 的 `dice_check` 效果（卡片/房間操作觸發，例如水晶球、面具、保險庫）——已經有 `onBeforeRoll`/`onAfterRoll` modifier 掛鉤點，但目前只給 `persistent_modifier` 用，不知道玩家手上有沒有相關道具。
2. `turnFlow.js` 的 `leaveCheck` 效果（`summon-control-and-item-drop` 之後新增的「離開房間前考驗」機制，塔橋/雜亂的房間/藤蔓糾纏的溫室）——完全沒有 modifier 支援，是最原始的 `rollDice` 呼叫。

**目標**：讓這兩條擲骰路徑都能在擲骰前自動偵測玩家手上的相關道具，跳出詢問視窗讓玩家決定要不要使用，並讓這個機制對未來新卡片（不限於這三張）可擴充。

**明確排除範圍**：`item_007`（幸運兔腳，擲骰後重骰一顆）已經依開發者指示直接從遊戲移除，不在本次設計/實作範圍內——它需要的是「擲骰後暫停」，跟本設計的「擲骰前暫停」是不同的中斷點，開發者評估後認為只為一張卡建立這個機制不划算。

## 卡片內容欄位：`diceInterjection`

新增在道具卡的頂層欄位（跟 `effects` 平行，不是塞進 `effects` 陣列裡），因為這不是「持有者自己觸發的效果」，而是「宣告自己有能力介入他人/自己正在進行的擲骰」：

```json
{
  "id": "item_006",
  "name": "詭異人偶",
  "diceInterjection": {
    "scope": "any",
    "bonusDice": 2,
    "cost": [{ "type": "stat_change", "stat": "sanity", "delta": -1 }],
    "consumesItem": false
  }
}
```

欄位說明：
- `scope`：`"any"`（任何擲骰都能介入）或 `"eventTriggered"`（只有事件卡觸發的考驗才能介入，蠟燭用）
- `bonusDice`：擲骰前多骰幾顆（受現有的 `[1,8]` 上下限夾值保護，沿用 `dice_check` 既有的 `Math.max(1, Math.min(8, ...))` 邏輯）
- `override`：布林值，`true` 代表「玩家自選數字直接取代擲骰結果，不用真的擲骰」（天使羽毛專用，跟 `bonusDice` 互斥，不會同時出現）
- `cost`：使用這個介入時要付出的代價，格式沿用既有的 `effects` schema（陣列），套用時機是「玩家選擇使用後，真正擲骰/套用 override 之前」
- `consumesItem`：`true`＝用一次後從背包移除（天使羽毛），`false`＝保留在背包，但**這回合已經用過的話當回合不能再用**（詭異人偶「每回合限一次」）——用一個新的每人欄位 `player.diceInterjectionUsedThisTurn`（道具 id 陣列，`advanceTurn` 時對離開玩家重置，做法比照今天剛做的 `summonUsedThisTurn`/`roomBonusesReceived`）追蹤

三張卡片的實際內容：

```json
// item_005 天使羽毛
"diceInterjection": { "scope": "any", "override": true, "consumesItem": true }

// item_006 詭異人偶
"diceInterjection": {
  "scope": "any",
  "bonusDice": 2,
  "cost": [{ "type": "stat_change", "stat": "sanity", "delta": -1 }],
  "consumesItem": false
}

// item_010 蠟燭
"diceInterjection": { "scope": "eventTriggered", "bonusDice": 1, "consumesItem": false }
```

（蠟燭卡面文字沒有寫「每回合限一次」，維持不限次數；`consumesItem:false` 但因為沒有限制文字，也不需要 `diceInterjectionUsedThisTurn` 追蹤——只有明確寫「每回合限一次」的詭異人偶需要）

## 兩階段擲骰流程

**階段一（發起擲骰，偵測介入機會）**：
1. 算出基礎骰數（`stat` 對應的屬性值，或固定 `diceCount`）
2. 掃描玩家背包，過濾出 `diceInterjection.scope` 符合這次擲骰類型、且未達每回合限制的道具
3. 沒有符合的道具：直接擲骰，行為跟現在完全一樣（不影響任何既有測試）
4. 有符合的道具：**不擲骰**，把繼續所需的狀態存進新的 `pendingRollChoice`（見下方），跳出詢問視窗，回傳 pending 狀態給呼叫端

**詢問視窗**：每個符合條件的道具是一個選項（不分兩層問「要不要用」再問「用哪個」），一定包含「不使用道具」選項。天使羽毛這種需要玩家額外輸入數值的，選擇的同時就要附上數值（`{promptId, optionId:'item_005', overrideValue:5}`），不用第二層視窗。沿用既有的 `promptState`/`createPrompt`/20 秒逾時機制，逾時預設「不使用道具」。

**階段二（玩家回應或逾時後）**：
1. 若選了某個道具：套用 `cost`（若有）、`consumesItem` 為真則移除道具／為假且有限制則記錄 `diceInterjectionUsedThisTurn`
2. 算出最終骰值：`override` 為真則直接用玩家給的數字；否則用（基礎骰數＋`bonusDice`，若有選道具）擲骰
3. 把最終骰值交還給發起端，讓發起端接續原本的邏輯

## `pendingRollChoice`（新的暫停狀態，`effectResolverManager` 的房間 entry 新增欄位，跟既有 `pendingChoice` 平行、互不干擾）

```js
{
  playerId,
  promptId,
  deadline,
  options: [ /* 同 promptState 既有格式 */ ],
  resumeKind: 'diceCheck' | 'leaveCheck',
  resumeContext: { /* 見下方，依 resumeKind 不同 */ },
}
```

**`resumeKind: 'diceCheck'` 的 `resumeContext`**：`{ effect, sourceId, consumeItemIfApplied }`——`effect` 是整個 `dice_check` 效果物件（含 `tiers`），`gameState`/`promptState`（透過 `resolverEntry.promptState`）在恢復當下都能直接從房間現有狀態拿到，不需要另外存快照；擲骰／道具背包歸屬的玩家就是 `pendingRollChoice` 頂層的 `playerId`，不需要在 `resumeContext` 裡重複一份。這些欄位合起來足夠讓 `handleDiceCheck` 從「已經知道最終骰值」這一步接續原本邏輯（比對 `tiers`、解析該層 `effects`、呼叫 `handleEffectResolveResult`）。

**`resumeKind: 'leaveCheck'` 的 `resumeContext`**：`{ direction, leaveCheckConfig }`——足夠讓 `game:move` handler 在拿到最終骰值後，直接比對 `leaveCheckConfig.min` 決定成功/失敗，成功則呼叫 `moveToRoom`（帶著已經算好的骰值，`moveToRoom` 不用再自己擲骰一次）。

## 兩條路的串接方式

**`dice_check`（`effectResolver.js`）**：`handleDiceCheck` 執行階段一；有道具可選時，`resolveEffects` 往上回傳一個新的 pending 結果（用一個欄位如 `rollChoice: true` 跟既有的 `choice`-effect pending 區分開，兩者外觀都是 `{pending:true, ...}` 但內容不同）。`socketHandlers.js` 收到後改建立 `pendingRollChoice`（不是現有的 `pendingChoice`）。玩家回應後，`handleDiceCheck` 用最終骰值繼續跑 `evaluateTiers`＋解析該層 `effects`，其餘流程（`handleEffectResolveResult`、`game:cardsDrawn` 等）不變。

**`leaveCheck`（`turnFlow.js` + `game:move`）**：`game:move` handler 在呼叫 `moveToRoom` 之前先做階段一；有道具可選時，不呼叫 `moveToRoom`，改建立 `pendingRollChoice` 並回傳 pending，`ack` 給玩家「等待選擇」。玩家回應後，用最終骰值直接呼叫 `moveToRoom`（新增一個參數讓它接受「已經算好的骰值」而不必自己擲骰，跟今天已經做的 `leaveCheck` 參數是同一個位置的擴充，不是另開一條路）。

**新的 socket 事件**：`game:diceChoiceRespond`（沿用 `game:effectPromptRespond` 的 payload 形狀 `{promptId, optionId}`，天使羽毛額外帶 `overrideValue`），獨立於既有的 `game:effectPromptRespond`（那個只認得 `pendingChoice`，不該混著處理兩種不同的暫停）。同樣需要逾時計時器（沿用既有 `effectChoiceTimeouts` 的做法，或另開一個 `rollChoiceTimeouts` map，比照既有模式）。

**其他 handler 的防呆**：`hasPendingEffectChoice` 目前只檢查 `pendingChoice`；需要新增 `hasPendingRollChoice` 或擴充既有防呆函式一起檢查兩個欄位，讓 `game:move`/`game:selectAction`/`game:endTurn`/`game:useStairs` 在有 `pendingRollChoice` 時一樣拒絕（回傳新的 `ROLL_CHOICE_IN_PROGRESS` 錯誤，跟既有 `EFFECT_CHOICE_IN_PROGRESS` 平行）。

## 補充：`eventTriggered` scope 怎麼判斷

`蠟燭` 的 `scope:"eventTriggered"` 需要「這次擲骰是不是事件卡觸發的」這個資訊，但 `resolveEffects` 目前的 `context` 參數（呼叫時傳入 `{now: Date.now()}`）完全沒有攜帶「觸發來源是哪個牌庫」這個資料，這不是自動就會篩掉，需要顯式補上：`resolveCardDraw`（`socketHandlers.js`）呼叫 `resolveEffects` 時，`context` 多帶一個 `sourceDeckType: deckType`（`'item'|'event'|'omen'`）。`dice_check` 掃描道具時，`scope:"eventTriggered"` 只在 `context.sourceDeckType === 'event'` 時才把蠟燭列入選項；房間操作（`room_action`）、道具主動使用（`game:selectAction actionType:'item'`）觸發的 `dice_check` 呼叫點沒有帶這個欄位，`context.sourceDeckType` 是 `undefined`，蠟燭天生就不會出現在選項裡，不需要額外的排除判斷。`leaveCheck` 這條路完全不經過 `resolveEffects`，同樣沒有 `sourceDeckType`，蠟燭一樣不適用。

## 範圍外事項

- 幸運兔腳（`item_007`）已從遊戲移除，不在此設計範圍內
- 前端 UI（跳出詢問視窗、選擇道具的畫面）延後到 M2d，這次只做後端機制
