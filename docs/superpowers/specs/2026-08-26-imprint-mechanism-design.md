# 銘印（Imprint）機制 設計文件

## 背景與目標

`data/cards/README.md` 已定案新分類 `imprint`：「查看，omen 限定的效果，不可被偷竊、給予、遺留，可被其他物品或事件導致消除」。8 張預兆卡（利爪/古書/獵犬/鬼牌/陀螺/狂怒/面具/香菸）已改成這個分類，`event_036`（能量轉換）／`item_050`（聖水）都是「消除一個銘印」的新卡片。

查證現有程式碼後確認：預兆卡選單目前完全繞過 `category`（`CharacterPanel.jsx` 的 `isOmen` 判斷優先於 category 分支），所以「不可給予/遺留」「查看取代使用」這些規則目前沒有任何程式碼支援；「持有時+X、失去時自動-X」這種反向復原機制，目前整個專案任何卡片都沒有實作過（既有 `stat_change` 都是一次性生效，沒有「移除時反向」的概念）。這份設計文件把銘印機制的資料模型、選單規則、移除機制定案。

**銘印跟一般道具/預兆的核心差異**：跟道具一樣會對屬性產生持有期間的變動，但玩家不能透過主動「遺留」「給予」移除，只能被特定道具或事件消除。

## 資料模型

銘印**沿用現有的 `player.inventory`**，不新增欄位、不建立新的資料結構——銘印本質上還是預兆卡，儲存方式跟現有預兆完全一樣，前端顯示也維持在同一個道具欄格狀區塊（不另開專屬版位）。

「持有時的效果」直接用卡片既有的 `effects` 欄位表示（例如 `omen_002` 古書已經是 `[{type:'stat_change', stat:'knowledge', delta:2}]`）——不新增「失去時效果」欄位，失去時的反向效果由系統在移除當下自動計算（見下方「移除機制」）。

## 選單規則（`CharacterPanel.jsx`）

`category === 'imprint'` 時：

- **給予、遺留兩個按鈕完全不顯示**（目前這兩個按鈕在既有程式碼裡是不看 category、對所有道具/預兆一律顯示的，這次要讓 `imprint` 分類明確排除）
- **預設顯示「查看」**（唯讀，開啟道具選單本身已經會顯示卡片 description，「查看」按鈕點擊後直接關閉選單，不觸發任何效果）
- **如果該卡 `activatedOnUse === true`，額外顯示「使用」**，維持原本的主動觸發機制不變。目前銘印卡裡只有 `omen_004`（獵犬）符合，選單會同時顯示「使用」與「查看」兩個按鈕；`omen_008`（面具）原本也是 `activatedOnUse:true`，但這次會被改寫成純被動卡（見下方），改寫後只會顯示「查看」

## `omen_008`（面具）改寫為純被動銘印

現有效果是「以意志擲骰，4+ 才用 `toggle_active` 切換正反屬性」，改寫成跟其他被動銘印（古書/鬼牌/陀螺/狂怒）同樣的模式：拿掉 `dice_check`／`toggle_active`／`activatedOnUse`，直接照卡面文字固定給予：

```json
"effects": [
  { "type": "stat_change", "stat": "speed", "delta": 2 },
  { "type": "stat_change", "stat": "knowledge", "delta": -2 }
],
"activatedOnUse": 移除這個欄位
```

## 給予/遺留的伺服器端阻擋

前端隱藏按鈕只能防君子，`turnFlow.js` 的 `giveItemAction`／`leaveItemAction` 也要能拒絕。現有的 `wieldItemAction`／`wearItemAction` 已經有先例——`socketHandlers.js` 在 `mode:'wield'/'wear'` 時會先從 `content.cards.items` 查出 `itemCategory` 再傳進 `turnFlow.js`。這次比照辦理：

- `socketHandlers.js`：`mode === 'give'` 或 `mode === 'leave'` 時，也從 `content.cards.items.find(...) || content.cards.omens.find(...)` 查出 `itemCategory`（銘印是預兆卡，一定要查 `omens`），傳給 `giveItemAction`／`leaveItemAction`
- `turnFlow.js`：`giveItemAction`／`leaveItemAction` 新增 `itemCategory` 參數，`itemCategory === 'imprint'` 時直接拋錯（`IMPRINT_CANNOT_BE_GIVEN`／`IMPRINT_CANNOT_BE_LEFT`），不執行移動

## 移除機制：新效果類型 `remove_imprint`

`event_036`（能量轉換）／`item_050`（聖水）都需要「消除目標玩家身上一個銘印」，新增效果類型：

```json
{ "type": "remove_imprint" }
```

處理邏輯：
1. 從目標玩家（`item_050` 可對自己或同房玩家使用，走既有 `canTargetOthers`/`targetForEffects` 機制；`event_036` 只會是抽卡玩家自己）的 `inventory` 篩出 `category === 'imprint'` 的卡片
2. 沒有任何銘印時，不執行任何動作、不拋錯（`event_036` 卡面文字本身就是「如果角色身上有銘印」的條件句，沒有銘印就是無事發生）
3. 有銘印時，從中隨機選一張移除
4. 移除的同時，系統自動把該卡 `effects` 陣列裡每一個 `stat_change`（非 `restoreToBase` 的）取相反 `delta` 再執行一次——**不需要卡片資料另外寫「失去時效果」**，永遠保證持有/失去兩邊數值對稱

## 範圍排除（這次不處理）

- `omen_001`（利爪）／`omen_010`（戒指，weapon）／`omen_012`（長矛，weapon）／`omen_013`（金幣，weapon）／`omen_011`（頭骨，gear）：都卡在既有的 M3 傷害/攻擊系統缺口，這次不處理，維持 `needsCustomLogic:true`
- `omen_009`（香菸）的「不受五芒星堂/地窖/墓園考驗影響」需要新的 modifier 掛鉤類型，這次不處理，維持擱置
- `event_036`（能量轉換）的「並提升一個隨機能力的級別」——目前完全沒有「電腦自動隨機選一項屬性」的機制（現有的屬性選擇都是玩家自己選，`choice` 效果會跳視窗給玩家選）。這次先接上 `remove_imprint`（消滅銘印的部分），隨機加值部分列為後續待補的子機制，`event_036` 整張卡在這個子機制補上之前維持 `needsCustomLogic:true`
- **`偷竊`**：README 提到銘印「不可被偷竊」，但「偷竊」目前整個專案還沒有任何實作（`item_035` 皮手套等描述偷竊的卡片都卡在 M3 攻擊系統），這次不需要為此寫任何防呆code，等 M3 真的做出偷竊機制時再一併考慮銘印排除

## 測試重點

- `remove_imprint`：玩家有多張銘印時隨機移除其中一張、正確反轉該卡的 `stat_change`；玩家沒有銘印時無事發生、不拋錯；`item_050` 對同房其他玩家使用時，消除的是目標玩家的銘印不是自己的
- 給予／遺留銘印類道具會被伺服器拒絕（`IMPRINT_CANNOT_BE_GIVEN`／`IMPRINT_CANNOT_BE_LEFT`），一般道具跟其他分類的預兆卡不受影響
- 前端選單：`imprint` 分類且非 `activatedOnUse` 只顯示「查看」；`omen_004`（獵犬）同時顯示「使用」與「查看」；`omen_008`（面具）選單維持只顯示「查看」（改寫後不再是 `activatedOnUse`）
- `omen_008` 抽到時效果正確固定給予（速度+2、知識-2），不再擲骰
