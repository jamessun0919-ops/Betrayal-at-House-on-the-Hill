# item_048/049 骰子介入新能力設計文件

## 背景與目標

`item_048`（海盜金幣）／`item_049`（賭神骰子）都是「擲骰前使用」類道具，`bonusDice`（骰子加減）／`override`（強制指定點數）／`consumesItem`（是否消耗）這些既有 `diceInterjection` 欄位已經支援大半，但各缺一個新能力：

- `item_048` 卡面：「該次考驗減少一顆骰子（`bonusDice:-1` 已支援），**如該考驗通過，則額外隨機取得一件物品**（原考驗內容與結果不受影響）」——缺「依考驗最終是否算通過，事後決定要不要額外執行效果」的能力
- `item_049` 卡面：「該次擲骰的骰子六面點數設定從`[0,0,1,1,2,2]`改為`[1,1,1,2,2,2]`，考驗完成後修改回原設定」——缺「單次擲骰暫時覆蓋骰面設定」的能力

## 能力一：`dice_check` 的 tier 明確標記 `pass`（`item_048` 的前置需求）

**現況問題**：目前系統唯一判斷「這次考驗算不算通過」的地方，是 `socketHandlers.js` 廣播 `game:checkResolved` 時的一段啟發式猜測——「這個 tier 的效果裡有沒有出現負向 `stat_change`」。這是猜測，不是卡片作者的明確宣告：`item_027`（房間演奏樂譜）失敗層的效果是空陣列（沒有負向 `stat_change`），就被這段邏輯誤判成「通過」，是上次全分支審查記錄下來的已知缺陷。`item_048` 如果沿用這個猜測法，會直接繼承同一個問題。

**解法**：`dice_check` 的每個 `tier` 物件明確加上 `"pass": true` 或 `"pass": false`，由卡片作者直接宣告，不再用效果內容猜。`handleDiceCheck`（`effectResolver.js`）解出對應 tier 後，把 `tier.pass` 一併放進回傳的 `diceCheckResult`（新增欄位）。**順便修正上述既有缺陷**：`socketHandlers.js` 的 `passed:` 欄位改成直接讀 `diceCheckResult.pass`，不再用啟發式猜測。

**需要標記的既有 8 張卡片**（`grep -c '"type": "dice_check"'` 全 repo 只有這 8 處，逐一依卡面文字語意標記）：

| 卡片 | tier | pass |
|---|---|---|
| `event_001`（腐敗惡臭） | min 5-8 | `true` |
| | min 1-4 | `false` |
| | min 0 | `false`（嚴重失敗，仍是失敗） |
| `event_005`（不起眼的櫃子） | min 3-4 | `true` |
| | min 0-2 | `false` |
| `event_009`（挑釁的幻覺） | min 4-8 | `true` |
| | min 0-3 | `false` |
| `event_010`（電話鈴聲） | min 4-8 | `true` |
| | min 0-3 | `false` |
| `event_022`（詭鏡） | min 4-8 | `true` |
| | min 0-3 | `false` |
| `item_009`（魯班盒） | min 5-8 | `true` |
| | min 0-4 | `false` |
| `item_027`（魔力樂譜） | min 6-16 | `true` |
| | min 0-5 | `false` |
| `omen_003`（命運之輪） | min 4-8 | `true` |
| | min 1-3 | `false` |
| | min 0 | `false` |

## 能力二：`item_048` 的 `bonusOnPass`

`diceInterjection` 新增可選欄位 `bonusOnPass`（效果陣列）。`handleDiceCheck` 算出 tier 之後：如果這次有使用互動道具（`interjectionChoice` 存在）、且 `tier.pass === true`、且該道具的 `diceInterjection.bonusOnPass` 非空，就把 `bonusOnPass` 併入這次要執行的效果陣列（跟 `tier.effects` 合併成一個陣列，一次 `resolveEffects` 呼叫解析，不是兩次獨立呼叫）。`draw_card`（隨機取得一件物品）本來就會透過既有的 `appliedCount`/`drawnCards` 彙整機制自然生效，`game:cardsDrawn` 通知前端也是既有機制，不需要新彈窗。

回傳的 `diceCheckResult.tierEffects` 只放原本考驗 tier 自己的效果（不含 `bonusOnPass`），確保既有的 `feedbacktextDice`／`game:checkResolved` 顯示邏輯不受影響——玩家看到的考驗成功/失敗文字，仍然只描述原本那場考驗本身。

## 能力三：`item_049` 的 `customFaces`

`rollDice`（`server/src/game/effectPipeline.js`）新增可選參數 `faces`，預設沿用既有的 `DIE_FACES = [0,0,1,1,2,2]`。`diceInterjection` 新增可選欄位 `customFaces`（六面點數陣列）。

**串接位置需要注意**：`resolveFinalRoll`（`diceInterjection.js`）只有 `override` 分支會被呼叫到；一般擲骰（`bonusDice`）分支目前是 `computeInterjectedRoll`（`effectResolver.js`）自己內聯呼叫 `rollDice`，不經過 `resolveFinalRoll`。`item_049` 走的是一般擲骰分支（不是 `override`），所以要在 `computeInterjectedRoll` 的 `bonusDice` 分支呼叫 `rollDice` 時，多帶入 `diceInterjection.customFaces`（沒設定時是 `undefined`，`rollDice` 自動 fallback 回預設骰面）。

「考驗完成後修改回原設定」不需要額外程式碼——因為根本沒有全域狀態被修改，`customFaces` 只是這一次 `rollDice` 呼叫的參數，下一次擲骰（沒有再用這張卡）自然用回預設骰面。

## 兩張卡最終定義

```json
"item_048": {
  "diceInterjection": { "consumesItem": true, "bonusDice": -1, "bonusOnPass": [{ "type": "draw_card", "deck": "item", "count": 1 }] }
}
"item_049": {
  "diceInterjection": { "consumesItem": true, "customFaces": [1, 1, 1, 2, 2, 2] }
}
```

（兩張卡的 `effects` 陣列本身維持空——`diceInterjection` 是掛在卡片頂層的獨立欄位，不是 `effects` 陣列裡的項目，跟現有其他互動道具的資料形狀一致。）

## 範圍排除（這次不處理）

- 不新增任何前端 UI——`bonusOnPass` 走既有的 `game:cardsDrawn`，`customFaces` 對玩家來說只是「這次骰得比較大」，沒有新的視覺呈現需求
- 不處理 `item_009`（魯班盒）成功後「盒子消失」目前沒有寫進 `effects`（`lose_item` 缺漏）的既有小缺口——這次只補 `pass` 欄位，不修其他既有資料缺口
- **已知限制（自我複查時發現，這次不修）**：`bonusOnPass` 是跟 `tier.effects` 合併成一個陣列一起丟給 `resolveEffects`；如果玩家在 `item_048` 剛好用在「通過分支本身是 `choice`（跳彈窗選擇）」的考驗上（例如 `event_010`），`resolveEffects` 掃到 `choice` 就會回傳 `pending:true` 提前結束，陣列裡排在 `choice` 後面的 `bonusOnPass` 這次就不會執行到。目前只有 `event_010` 一張卡的通過分支是 `choice`，機率上是罕見組合，這次不特別處理；如果之後要根治，需要讓 `bonusOnPass` 也能夠在 `choice` 恢復（`game:effectPromptRespond`）之後被接續執行，屬於另一個獨立的小工程。

## 測試重點

- `dice_check` 的 `diceCheckResult` 正確帶出對應 tier 的 `pass` 值（`true`/`false` 兩種情況都要測）
- `socketHandlers.js` 的 `game:checkResolved` 廣播 `passed` 欄位正確讀 `diceCheckResult.pass`，不再受 tier 效果內容影響（用一個「通過但效果是負向 stat_change」與「失敗但效果是空陣列」的邊界案例各測一次，證明不再誤判）
- `item_048`：使用後考驗通過 → 額外抽到一張物品卡（`appliedCount`/`drawnCards` 正確反映兩邊效果）；使用後考驗失敗 → 不會多抽卡，只有 `bonusDice:-1` 的骰數減少生效
- `item_049`：使用後這次擲骰的骰子和值分布跟自訂骰面 `[1,1,1,2,2,2]` 一致（例如用 `Math.random` mock 驗證特定 face index 對應到新骰面的值，而非預設 `[0,0,1,1,2,2]`）；下一次（沒有再用這張卡的）擲骰恢復預設骰面
- 全部既有 `dice_check` 相關測試（含跨任務的既有回歸測試）在補上 `pass` 欄位後仍全數通過，證明這是純新增欄位，不影響既有行為
