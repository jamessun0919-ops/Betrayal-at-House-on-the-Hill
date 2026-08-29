# item_038（可疑藥丸）暫時屬性置換機制 — 設計文件

## 目標

`item_038`（可疑藥丸）卡面文字：「使用後，力量降到最低級別(不致死的級別１)，速度提升到最高級別，到下一個回合開始時恢復。」

目前專案沒有任何效果具備「套用一次性的暫時數值變動，並在特定時機點自動恢復」的能力（`persistent_modifier` 的 `removeWhen` 是條件觸發，不是時間到自動觸發）。本設計新增這個能力，範圍刻意只做 item_038 需要的形狀，不做成通用的「延時效果系統」。

## 架構

### 1. `stat_change` 效果新增 `setToLevel` 欄位

現有 `stat_change` 支援 `delta`（相對變動）與 `restoreToBase`（回復到出廠 `baseIndex`）兩種模式。新增第三種互斥模式：

- `setToLevel: "min"` — 目標索引 = `statTrack.skullIndex + 1`（沿用 `changeStat` 既有的「不致死」下限規則，跟未開始邪祟前的傷害下限完全一致）
- `setToLevel: "max"` — 目標索引 = `statTrack.track.length - 1`（track 陣列最後一格）

套用方式：算出 `delta = targetIndex - statTrack.currentIndex`，交給既有的 `changeStat(player, stat, delta, hauntStarted)` 執行（沿用既有的 overflow/下限規則，不繞過）。

若 `setToLevel` 不是 `"min"` 或 `"max"`，拋出 `INVALID_SET_TO_LEVEL`。

### 2. `revertAtNextTurnStart` 欄位（只在搭配 `setToLevel` 時生效）

`stat_change` 效果若同時帶 `revertAtNextTurnStart: true`，套用當下額外做一件事：把「剛剛實際套用的 delta 的反向值」記進玩家身上的新欄位 `player.pendingStatReverts`（陣列，元素為 `{stat, delta}`）。

這個欄位刻意只在 `setToLevel` 分支內生效，不做成獨立於 `delta`/`restoreToBase` 之外的通用開關——目前唯一使用場景（item_038）只需要這個組合，避免做超出需求的彈性。

**還原精度**：套用「原本算出來的反向 delta」，不是「回到使用前的絕對數值快照」。若還原觸發前，同一項屬性又被別的效果動到，最終結果會是「反向 delta 疊加在當下數值上」，跟直覺的「回到使用前那個絕對數字」可能有落差——這跟既有銘印機制（`remove_imprint`）反向套用 `stat_change.delta` 的簡化方式一致，是已確認接受的既有簡化，不特別處理。

### 3. 觸發點：`turnFlow.js` 的 `advanceTurn`

`advanceTurn` 換人時本來就會對 `nextPlayer` 呼叫 `resetActionPoints`——這正是「這個玩家的下一輪開始」的時間點。在同一個位置追加：

```
若 nextPlayer.pendingStatReverts 非空：
  對每一筆 {stat, delta} 呼叫 changeStat(nextPlayer, stat, delta, hauntStarted)
  清空 nextPlayer.pendingStatReverts
```

其他玩家的回合開始時，讀的是「他們自己的」`pendingStatReverts`（預設空陣列），不會誤觸發別人身上的待恢復效果——天然符合「這個玩家自己的下一輪」語意，不需要額外比對是誰使用了道具。

### 4. `player.pendingStatReverts` 欄位

`playerEntity.js` 的 `createPlayer` 回傳物件新增 `pendingStatReverts: []`（初始空陣列），比照 `wornGearIds`/`visitedRooms` 等既有陣列欄位的初始化方式。

### 5. `item_038` 資料串接

```json
"effects": [
  { "type": "stat_change", "stat": "might", "setToLevel": "min", "revertAtNextTurnStart": true },
  { "type": "stat_change", "stat": "speed", "setToLevel": "max", "revertAtNextTurnStart": true }
],
"needsCustomLogic": false
```

（`needsCustomLogic` 目前已經是 `false`，不需要改動；`category:"consumable"` 維持不變，使用後照既有 `consumeItemIfApplied` 機制自動從背包移除。）

## 測試計畫

- `effectResolver.test.js`：`setToLevel:"min"`／`"max"` 各自套用到正確索引；`revertAtNextTurnStart` 正確把反向 delta 寫進 `player.pendingStatReverts`；未知的 `setToLevel` 值拋 `INVALID_SET_TO_LEVEL`
- `turnFlow.test.js`：`advanceTurn` 對 `nextPlayer` 正確套用並清空 `pendingStatReverts`；換到別的玩家回合不會誤觸發（各自 `pendingStatReverts` 互不影響）；多筆 revert 條目都會被套用
- `socketHandlers.test.js`：端對端——使用 `item_038` → 力量/速度變成極值 → 結束回合換人（此時尚未恢復）→ 再繞回原玩家的回合開始（此時才恢復到位移前的相對位置）

## 範圍排除

- 不做任何額外提示彈窗（開發者已確認，還原時單純靜默更新 `game:stateUpdate`，跟既有 `resetActionPoints` 等自動發生的回合開始流程一致）
- 不做更精確的「回到使用前絕對數值」還原邏輯（開發者已確認接受銘印機制同款簡化）
- 不做通用的「延時效果系統」，`revertAtNextTurnStart` 只在 `setToLevel` 組合下生效

## 附錄：item_044（消滅房間內其他角色）— 已確認設計，留待 M3 實作

開發者確認的機制（本次不實作，記錄供 M3 傷害系統設計時參考）：

`item_044`（有限手套）第 7 項「消滅房間內其他所有角色」效果，發動時視為一次攻擊，對房間內**除使用者本人以外**的所有其他角色（不限玩家，包含未來的怪物／NPC）各造成肉體與精神各 99 點傷害——99 點是「必定淘汰」的數值佔位，實際 M3 傷害系統設計出來後，可能改成直接的 `eliminate` 效果而非真的走一次數值傷害流程。目前整個專案完全沒有「淘汰玩家」與怪物/NPC 資料結構的概念，這兩者都是 M3 範圍，這次只記錄設計意圖。
