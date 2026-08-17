# 統一考驗彈窗機制與可讀訊息欄設計文件

## 背景與目標

目前遊戲有三個各自獨立、互不相通的擲骰考驗觸發點：

1. `turnFlow.js` 的 `leaveCheck`（離開目前房間前的考驗，塔橋/雜亂的房間/藤蔓糾纏的溫室等）
2. `turnFlow.js` 的崩塌房間速度考驗（`COLLAPSE_CHECK_STAT`/`COLLAPSE_CHECK_MIN` 常數，`applyCollapseCheck`）
3. `effectResolver.js` 的 `dice_check` 效果（event/item/omen 卡片內建的考驗，`handleDiceCheck`）

三者都是「伺服器一次算完」（含既有的道具介入擲骰機制，[`2026-08-10-dice-interjection-design.md`](2026-08-10-dice-interjection-design.md)，本次不動），但目前完全沒有統一、結構化地把「考驗結果」送到前端——leaveCheck 失敗只透過 `ack` 回給當事人自己（`{kind:'leaveCheckFailed', rolled, required}`），房間其他人看不到；卡片內建考驗的骰值/命中哪一層 `tiers` 甚至完全沒有被回傳，`game:effectResolved` 只有 `{playerId, sourceId}`。

同時，前端訊息欄目前是把整包 socket 事件 `JSON.stringify` 硬塞進字串（例如「抽到的卡：{"playerId":"p1",...}」），完全沒有「進入房間」這則訊息，字體只有約 10.4px（`CharacterPanel.jsx` 的 `fontSize:'0.8em'`，基準 13px）。

**目標**：
1. 把三個考驗觸發點統一成同一套「考驗彈窗」使用者體驗：考驗前彈窗（描述＋擲骰按鈕）→ 關窗＋骰子動畫（開發者後續自行設計補上，本次僅預留掛載點）→ 考驗結果彈窗，全部依序播放，一次只處理一個考驗。這個機制做完之後，未來任何新的考驗行為（例如尚未實作的襲擊/攻擊）都直接掛上同一套佇列，不必再另開一套 UI。
2. 訊息欄字體改為 24px，內容從 JSON 傾印改為人類可讀句子（含玩家署名），並新增目前完全不存在的「進入房間」訊息。

## 範圍界定

**這次要做**：leaveCheck、崩塌房間速度考驗、卡片內建 `dice_check` 效果，三者的考驗彈窗與訊息欄整合。

**這次不動**：
- 既有的道具介入擲骰流程（`pendingRollChoice`／「要不要用道具影響這次擲骰」的詢問視窗）——它發生在考驗結果算出來**之前**，新機制的佇列只接在它之後，UI 本身不改。
- 崩塌房間、leaveCheck 的判定邏輯本身（門檻、是否掉入地下室等）——只新增「把已經算出的結果，用結構化格式廣播出去」，不碰判定。
- 襲擊／攻擊——`turnFlow.js` 的 `ACTION_TYPES` 雖然列了 `'attack'`，但 `selectAction` 完全沒有對應分支，伺服器根本沒實作，這次不處理。
- `needsCustomLogic: true` 且 `effects` 是空陣列的卡片（例如 `event_002` 駭人尖叫）——它們的考驗目前**沒有任何結構化資料**（`effects: []`），伺服器實際上什麼都不會發生，抽到這類卡只會走「無考驗卡片」的收尾（顯示 `text` 欄位＋確認鍵），跟現況一致，不算退步。

## 資料流：考驗佇列＋兩階段彈窗

已用 mockup 與開發者確認版面（`.superpowers/brainstorm/1706-1786953251/content/check-modal-flow.html`）：

```
[考驗觸發，伺服器已算出完整結果] → 廣播 game:checkResolved
        ↓（前端收到後，推進 pendingCheckQueue，不立刻顯示結果）
彈窗1：考驗前（標題＋描述文字＋考驗屬性/骰數/門檻摘要框＋擲骰按鈕）
        ↓ 玩家按「擲骰」
關閉彈窗1 → 播放骰子動畫（2-3 秒，開發者後續設計，本次先用固定時長的佔位動畫掛好時機點）
        ↓ 動畫播完
彈窗2：考驗結果（綠色「成功！」／紅色「失敗...」大字標題＋一句話結果敘述＋確認鍵）
        ↓ 玩家按「確認」
pendingCheckQueue 取下一筆 → 有的話重複上述流程；沒有的話恢復正常遊戲畫面
```

一次移動若連續觸發多個考驗（例如 leaveCheck 通過後，新房間又抽到有考驗的卡），是兩輪各自完整跑完，不合併在同一個彈窗——這是開發者明確要求的順序化行為。

無考驗的房間/卡片（`drawType` 有值但抽到的卡沒有 `dice_check` 效果，或 `needsCustomLogic` 的空效果卡）走簡化版：只有「彈窗：描述文字＋確認鍵」一段，不進骰子動畫，直接關窗恢復遊戲。

## 統一考驗結果事件：`game:checkResolved`

新增一個 broadcast 給整個房間的事件（跟 `game:cardDrawn` 一樣 `io.to(roomCode).emit`，讓其他玩家也看得到誰通過/沒通過），取代目前分散在 ack／完全沒送出的做法。三個觸發點都改發這個事件：

```js
{
  playerId,
  checkKind: 'leaveCheck' | 'collapseCheck' | 'cardCheck',
  sourceKind: 'room' | 'event' | 'item' | 'omen',
  sourceId,              // roomId 或 cardId，前端用既有的 roomContent/cardContent 查名稱與 text
  stat,                  // 'might' | 'speed' | 'sanity' | 'knowledge'
  diceCount,
  rolled,
  threshold,             // leaveCheck/collapseCheck 是 min；cardCheck 沒有單一門檻，此欄位為 null
  tierEffects,           // cardCheck 命中的那一層 tiers[].effects 原始陣列（stat_change 列表），leaveCheck/collapseCheck 為 null
  passed,                // 見下方判定規則
}
```

**為什麼不做成伺服器直接組好的句子**：訊息欄跟彈窗要顯示的文字，都可以用前端已經有的 `roomContent`/`cardContent`（既有的一次性靜態資料模式，`characterContent` 沿用的同一套）配合 `sourceId` 查到房間/卡片的 `name`／`text` 欄位組出來，不需要伺服器另外維護一套中文句型——沿用這次 session 稍早幫角色圖示查表（`findCharacterIcon`）的同一個做法，維持「伺服器給結構化資料、前端組顯示文字」的既有分工。

**`passed` 判定規則**：
- `leaveCheck`／`collapseCheck`：`rolled >= threshold`，跟現有判定邏輯完全一致，只是把結果也送出來。
- `cardCheck`：卡片的 `tiers` 不是單純二元成功/失敗（例如 `event_001` 有 3 層，最好/中間/最差），沒有現成欄位可用。**這裡我採用一個不需要改動任何卡片 JSON 資料的判定規則**：命中那一層的 `tierEffects` 裡如果有任何 `stat_change` 的 `delta < 0`，判定 `passed:false`（紅色「失敗」）；否則 `passed:true`（綠色「成功」）。這是啟發式規則，不是資料裡明確定義的——如果之後遇到「有負面數值變化但劇情上其實算成功」這類卡片，需要再回頭調整規則或幫卡片資料加專屬欄位，屆時再討論。

## 各觸發點需要的程式改動

**`turnFlow.js` `moveToRoom`**：
- leaveCheck 目前只有失敗時把 `rolled`／`required` 放進回傳值（`{kind:'leaveCheckFailed', rolled, required}`），**成功時 `rolled` 直接被丟掉**，落入後續移動邏輯的回傳值完全沒有考驗資訊。需要在 leaveCheck 成功分支也把 `{rolled, required: leaveCheck.min}` 附加到最終回傳的 `move`/`open_door` 結果上，讓 `socketHandlers.js` 能組出 `game:checkResolved`。
- 崩塌房間：`applyCollapseCheck` 已經回傳 `{fell, rolled, ...}`，資料齊全，不用改判定，只需要在 `socketHandlers.js` 端讀取並廣播。

**`effectResolver.js` `handleDiceCheck`**：目前算出 `finalSum`／`tier` 後只回傳 `resolveEffects(tier.effects)` 的結果（單純的 `{pending:false}`，沒帶骰值或命中哪層），**`finalSum` 和 `tier.effects` 完全沒有被回傳出去**。需要讓這個函式額外把 `{diceCheckResult: {stat: effect.stat, diceCount: baseCount, rolled: finalSum, tierEffects: tier.effects}}` 附加到回傳值上，讓呼叫端（`resolveCardDraw`／`handleEffectResolveResult`）拿得到。

**`socketHandlers.js`**：
- `game:move` handler／`finishMoveResult`：leaveCheck、崩塌房間兩種情況都改成建構並 `io.to(roomCode).emit('game:checkResolved', ...)`，取代/補充目前只給當事人的 ack 資訊（ack 保留，不刪除既有欄位，避免動到依賴它的既有測試與前端邏輯，新事件是額外補上的廣播）。
- `resolveCardDraw`／`handleEffectResolveResult`：卡片內建考驗若有 `diceCheckResult`（見上），一樣組出 `game:checkResolved` 廣播；沒有的話（卡片沒有 `dice_check` 效果、或 `needsCustomLogic` 空效果）維持現況，只有 `game:cardDrawn`，前端走「無考驗」收尾。

## 前端改動

**新元件 `CheckModal.jsx`**（`client/src/gameplay/`）：兩階段彈窗，比照現有 gameplay 畫面的 inline-style overlay 慣例（`rgba(0,0,0,0.6)` 背景、置中卡片），依 mockup 確認的版面：考驗前有「考驗屬性/骰數/門檻」摘要框＋`text` 欄位原文＋擲骰按鈕；結果畫面用綠/紅大字「成功！」/「失敗...」＋一句話敘述＋確認鍵。內文 16px、標題 20px（mockup 已確認），骰子動畫本次只做「2-3 秒的佔位延遲＋預留一個之後可以替換成真正動畫元件的掛載點」，不做視覺效果本身。

**`DebugGameScreen.jsx`**：
- 新增 `pendingCheckQueue` 狀態，監聽 `game:checkResolved`，推入佇列；同時也要監聽「無考驗」情境（房間 `drawType` 有值但沒有考驗結果，或抽到 `needsCustomLogic` 空效果卡）以觸發簡化版彈窗——這部分沿用既有 `game:cardDrawn` 事件即可判斷，不需要新事件。
- 佇列非空時渲染 `CheckModal`，播放完一筆換下一筆。
- 訊息欄文字生成整個重寫：拿掉現有的 `JSON.stringify` 拼字串（`抽到的卡：...`／`待處理動作：...`等），改成用 `roomContent`/`cardContent`/`characterContent`（已經是 M2d3 建立的既有一次性靜態資料）查名稱組人類可讀句子，範例對照使用者給的格式：
  - 房間進入（目前完全沒有這則訊息，新增）：`「{玩家名} 進入了『{房間名}』」`
  - 事件卡：`「{玩家名}：發生了 {卡片名}」`
  - 道具卡：`「{玩家名} 在房間裡找到了 {卡片名}」`
  - 預兆卡：`「{玩家名}看到了一個怪異的現象（{卡片名}）」`
  - 考驗結果：從 `game:checkResolved` 組，例如 `「{玩家名}：{sourceName} {stat中文} 考驗{成功/失敗}（擲出 {rolled} 點）」`
  - 全部訊息都加玩家名稱（開發者已確認，因為訊息欄是整房間共用廣播）。

**`CharacterPanel.jsx`**：訊息列 `fontSize` 從 `'0.8em'` 改成 `24px`（含無訊息時的佔位文字，維持視覺一致）。

## 測試考量

- `turnFlow.test.js`：leaveCheck 成功分支需要新增/調整測試，斷言回傳值帶有 `rolled`/`required`。
- `effectResolver.test.js`：`handleDiceCheck` 的回傳值需要新增測試，斷言 `diceCheckResult` 內容（`stat`/`diceCount`/`rolled`/`tierEffects`）正確附帶。
- `socketHandlers.test.js`：三個觸發點都需要新增測試，斷言 `game:checkResolved` 有正確 broadcast 給整個房間（不只是當事人），且欄位齊全；同時要涵蓋「無考驗」情境不誤發這個事件。
- 前端目前沒有自動化測試（純手動瀏覽器驗證，沿用這次 session 稍早的驗證方式：雙分頁模擬兩位玩家，走一次完整流程），沒有既有前端測試框架可沿用，不新增。

## 範圍外事項

- 骰子動畫視覺效果本身——開發者後續自行設計補充，本次只做佔位掛載點。
- 襲擊／攻擊考驗——伺服器尚未實作，這次不處理；機制設計上未來接上時直接複用 `game:checkResolved`／`CheckModal`，不需要另開一套。
- `needsCustomLogic` 卡片的實際效果補完（例如 `event_002` 駭人尖叫需要的「同房間所有人各自考驗」邏輯）——不在本次範圍，這次只確保這類卡目前的行為（無結構化考驗）能正確走「無考驗」收尾，不會顯示錯誤的擲骰按鈕。
- 卡片 `tiers` 資料新增明確的 `outcome` 欄位（取代本文件的啟發式 `passed` 判定）——如果啟發式規則之後被發現不準確，屆時再討論是否要做這個資料遷移。
