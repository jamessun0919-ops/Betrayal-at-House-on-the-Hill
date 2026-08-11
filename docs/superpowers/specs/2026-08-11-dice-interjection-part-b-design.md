# 可被道具介入的擲骰 Part B（`leaveCheck` 路徑）設計文件

## 背景與目標

[Part A 設計文件](2026-08-10-dice-interjection-design.md)已經讓 `dice_check`（卡片/房間操作觸發的擲骰）支援道具介入（天使羽毛、詭異人偶、蠟燭），並刻意把純邏輯部分（`findInterjectionOptions`/`resolveFinalRoll`，`server/src/game/diceInterjection.js`）設計成無外部依賴，供另一條擲骰路徑直接沿用。

第二條路徑是 `leaveCheck`（`summon-control-and-item-drop` 之後新增的「離開房間前考驗」機制，塔橋/雜亂的房間/藤蔓糾纏的溫室）：`turnFlow.js` 的 `moveToRoom` 目前是純同步函式，遇到 `leaveCheck` 直接呼叫 `rollDice` 判定，完全沒有暫停等待玩家選擇的機制。

**目標**：讓 `leaveCheck` 的擲骰前也能跳出跟 `dice_check` 一樣的道具介入詢問視窗，天使羽毛/詭異人偶可以用在離開房間前考驗上；蠟燭因為 `scope:"eventTriggered"`（只限事件卡觸發的考驗），天生不適用於 `leaveCheck`，不需要額外排除邏輯。

**範圍**：只涵蓋後端機制。前端 UI 沿用 Part A 已經做好的除錯頁面詢問視窗（`game:diceChoicePending`/`game:diceChoiceRespond` 完全通用，不分來源），不用另外做。

## 整體方案：擴充既有 `pendingRollChoice`，不另建新機制

Part A 的 `resumeRollChoice`（`socketHandlers.js`）已經用 `resumeKind` 欄位分派恢復邏輯，目前只有 `'diceCheck'` 一種、其他值會拋 `UNSUPPORTED_ROLL_CHOICE_RESUME_KIND`——這是刻意留給未來擴充的設計。Part B 直接新增 `resumeKind: 'leaveCheck'` 分支，`pendingRollChoice`/逾時計時器（`rollChoiceTimeouts`）/`game:diceChoiceRespond`/`hasPendingRollChoice` 防呆全部原封不動沿用，不重複實作。

## 兩階段流程（跟 `dice_check` 對稱）

**階段一（`game:move` 收到移動請求）**：
1. 驗證回合/行動力/方向（既有邏輯不變）
2. 若目標房間有 `leaveCheck`：掃描玩家背包找符合條件的介入道具（`findInterjectionOptions(player, content.cards.items, null)`——第三參數 `sourceDeckType` 傳 `null`，因為 `leaveCheck` 不是任何牌庫觸發的，只要不是 `'event'` 就能正確排除蠟燭，語意上更清楚）
3. 沒有符合的道具：直接擲骰判定，行為與現在完全相同（不影響任何既有測試案例的既有斷言）
4. 有符合的道具：**不擲骰、不扣任何行動力**，開啟 `pendingRollChoice`（`resumeKind:'leaveCheck'`），`ack({kind:'leaveCheckPending'})`，廣播 `game:diceChoicePending`（沿用 Part A 事件，UI 完全共用）

**階段二（玩家回應 `game:diceChoiceRespond`，或逾時預設不使用）**：
1. 套用選中道具的代價/消耗追蹤、算出最終骰值——**完全重用 `computeInterjectedRoll`**（見下方「重用 `computeInterjectedRoll`」），跟 `dice_check` 路徑用同一份邏輯，代價（詭異人偶意志-1）、消耗追蹤、房間與玩家的 `persistent_modifier` 全部一致生效
2. 帶著已知的最終骰值再呼叫一次 `moveToRoom`，比對 `leaveCheck.min` 完成移動判定：通過則正常移動/開門（含既有的 `pendingCardDraw` 抽卡流程），沒通過扣 1 行動力、原地不動（跟現在完全一樣的失敗代價，不會因為多繞了介入流程而多扣）
3. 廣播 `game:stateUpdate`；同房間玩家的 modifier 檢查（`meetsAnotherPlayer`）等收尾邏輯，跟現在的直接移動路徑共用同一段程式碼，不重複寫

## `moveToRoom` 介面異動（破壞性變更）

現有簽章：`moveToRoom(gameState, playerId, direction, leaveCheck = null, rng = Math.random)`

新簽章：`moveToRoom(gameState, playerId, direction, leaveCheck = null, rollOptions = {})`，`rollOptions = { itemCatalog, resolvedRoll, rng }`：
- `resolvedRoll === undefined`（階段一呼叫）：跟現在一樣先做介入偵測（`itemCatalog` 有值且找得到選項 → 回傳 `{kind:'leaveCheckPending', rollChoice:true, options, leaveCheck, direction}`，不擲骰不扣行動力）；找不到選項則用 `rollDice(diceCount, rng || Math.random)` 正常擲骰，跟現在行為相同
- `resolvedRoll` 是數字（階段二呼叫）：跳過介入偵測，直接用這個數字比對 `leaveCheck.min`

這是**破壞性簽章變更**：`server/test/game/turnFlow.test.js` 裡直接把函式當第 5 個參數傳入的既有測試（用來控制骰值的假 `rng`）都要改成 `{ rng: fakeRng }` 的形式，這是計畫執行時的既有任務範圍，不是後續才發現的問題。

## 重用 `computeInterjectedRoll`（`effectResolver.js`）

`computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice, context)` 目前是 `effectResolver.js` 的內部函式，只有 `handleDiceCheck` 在用。Part B 把它加進 `module.exports`，`resumeRollChoice` 的新分支直接呼叫：

```js
const diceCount = getStatValue(player, leaveCheck.stat);
const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];
const finalRoll = computeInterjectedRoll(
  gameState, resolverEntry.promptState, playerId,
  diceCount, modifiers, interjectionChoice,
  { now: Date.now(), itemCatalog: content.cards.items, rng: Math.random }
);
```

不重新實作一份「套用代價、追蹤消耗、套用 override/bonusDice、套用 modifiers」的邏輯，兩條路徑以後要改規則只需要改一個地方。

## `pendingRollChoice.resumeContext`（`resumeKind: 'leaveCheck'`）

```js
{ direction, leaveCheck }
```

`playerId` 已經是 `pendingRollChoice` 頂層欄位，不重複存；`gameState`/`content`/`resolverEntry.promptState` 在恢復當下都能直接從房間現有狀態拿到，不需要另外存快照。

## `socketHandlers.js` 異動

- `game:move` handler：呼叫 `moveToRoom` 時帶 `{ itemCatalog: content.cards.items }`；若回傳 `kind === 'leaveCheckPending'`，建立 `pendingRollChoice`（沿用 `handleRollChoicePending` 的 prompt 建立/逾時邏輯，或視實作情況新增一個對應的建立函式），`ack({ kind: 'leaveCheckPending' })`，直接 return（不執行後續的 modifier 檢查/抽卡/廣播——那些要等階段二真的移動完成才跑）
- `resumeRollChoice`：新增 `else if (resumeKind === 'leaveCheck')` 分支，做上述「重用 `computeInterjectedRoll`」＋帶著 `resolvedRoll` 呼叫 `moveToRoom`＋收尾（modifier 檢查、`pendingCardDraw`、廣播）
- **收尾邏輯共用**：目前「同房間玩家 modifier 檢查＋`pendingCardDraw` 抽卡處理＋廣播 `game:stateUpdate`」寫在 `game:move` handler 內、緊接在 `moveToRoom` 呼叫之後。因為「直接移動成功」跟「介入詢問後才移動成功」這兩條路徑最終都要跑一樣的收尾，這段邏輯要抽成一個共用函式（例如 `finishMoveResult`），兩處呼叫

## `ack` 語意

`game:move` 的 `ack` 目前直接回傳移動結果（`{kind:'move',...}`/`{kind:'open_door',...}`）。觸發道具介入詢問時沒有這個同步結果可回，`ack` 改回傳 `{ kind: 'leaveCheckPending' }`，告知前端「移動被暫停、等待道具選擇」；真正的移動結果（成功/失敗）透過階段二結束後的 `game:stateUpdate` 廣播得知，跟既有的 `game:diceChoicePending` 事件一起解讀（開發者已確認此設計）。

## 不動的部分

- `diceInterjection.js`（`findInterjectionOptions`/`resolveFinalRoll`）維持零外部依賴，不修改
- `pendingRollChoice` 的資料結構、逾時計時器 map（`rollChoiceTimeouts`）、`game:diceChoiceRespond` 事件、`hasPendingRollChoice` 防呆（`game:move`/`game:selectAction`/`game:endTurn`/`game:useStairs`）全部原封不動
- 天使羽毛/詭異人偶/蠟燭三張卡的 `diceInterjection` 內容（`item-cards.json`）不需要修改——蠟燭天生因為 `scope` 排除，天使羽毛/詭異人偶原本就沒有限定只能用在 `dice_check`

## 範圍外事項

- 前端 UI（正式的道具選擇畫面）延後到 M2d，這次只做後端機制
- `moveSummon`（召喚物移動）不會觸發 `leaveCheck`——召喚物本來就不能開新門，`leaveCheck` 目前只掛在需要開門/移動離開的一般玩家路徑上，此設計不涉及召喚物
