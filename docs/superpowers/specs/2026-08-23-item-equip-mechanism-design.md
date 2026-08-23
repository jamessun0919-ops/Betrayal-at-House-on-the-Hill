# 道具手持/配戴機制 設計文件

## 背景與目標

道具 `category` 已重新分類為五種（`weapon`／`gear`／`consumable`／`reusable`／`decoration`，2026-08-22 已定案），道具選單要依 category 動態決定顯示哪些選項，取代現在寫死的「使用/遺留/(給予)」邏輯。

查證後確認：`weapon` 的「手持」跟 `gear` 的「配戴」不是現有「使用」按鈕的改名，而是一個全新的**跨回合裝備狀態**——玩家選擇手持/配戴後，這件道具進入「裝備中」狀態，直到主動取下或換裝，期間持續生效；跟單純「點一下立刻觸發效果就結束」的既有道具動作（使用/給予/遺留/拿取）性質不同。

## 資料模型

`playerEntity.js` 的 `createPlayer` 新增兩個玩家欄位：
- `wieldedWeaponId: string | null`——目前手持的武器 id，最多一件，初始 `null`
- `wornGearIds: string[]`——目前配戴中的裝備 id 清單，**無上限**，初始 `[]`

這兩個欄位是 `player` 物件的一部分，隨既有的 `game:stateUpdate` 廣播自動送到前端，不需要新增廣播事件。

**跟既有「道具離開背包」動作的整合**：玩家把手持中的武器或配戴中的裝備「給予」出去、或「遺留」在房間時，該道具要同時離開手持/配戴狀態（`wieldedWeaponId` 變 `null`，或從 `wornGearIds` 移除）。這個清理邏輯要在以下三個「道具離開玩家背包」的地方都套用，抽成一個共用小函式（例如 `clearEquipStateIfNeeded(player, itemId)`，放在 `playerEntity.js`）：
1. `turnFlow.js` 的 `giveItemAction`
2. `turnFlow.js` 的 `leaveItemAction`
3. 物品攜帶上限機制（`socketHandlers.js`）的 `applyInventoryLeave`

## 伺服器動作

`turnFlow.js` 的 `selectAction`（`actionType:'item'`）新增 4 種 `mode`，跟現有 `give`/`leave`/`pickup` 平行，各自扣 1 行動力，操作前驗證道具確實在玩家背包裡：

- **`wield`**（手持，僅接受 `category:"weapon"` 的道具，否則拋錯）：把 `wieldedWeaponId` 設成這件道具 id。如果玩家原本已經手持別的武器，**自動換持**（原本那件變回「未手持」但仍在背包裡，不需要玩家先手動放下）
- **`unwield`**（取下）：只能對「目前正手持的那一件」操作，否則拋錯；`wieldedWeaponId` 設回 `null`
- **`wear`**（配戴，僅接受 `category:"gear"` 的道具，否則拋錯）：把這件道具 id 加進 `wornGearIds`（已在清單裡則不重複加）
- **`unwear`**（取下）：只能對「目前確實配戴中的那一件」操作，否則拋錯；把這件道具 id 從 `wornGearIds` 移除

**跟既有 `diceInterjection` 機制的整合**：目前擲骰介入的判斷邏輯（掃描 `player.inventory` 找 `diceInterjection` 欄位的道具）改成——如果該道具 `category` 是 `"gear"`，額外要求 `wornGearIds` 包含這件道具才算數；其他類別（`weapon`/`consumable`/`reusable`）維持現有「持有即可用」的邏輯不變。這會讓 `item_010`（油燈，目前唯一已實作 `diceInterjection` 的 gear 卡）從現在的「背包裡有就自動生效」改成「要配戴中才生效」——這是刻意的行為改變，已跟開發者確認。

**開場自動裝備**：`gameManager.js` 的 `startGame` 給角色初始道具（`characters.json` 的 `itemID`）時，如果該道具的 `category` 是 `weapon`，順便設定 `wieldedWeaponId`；是 `gear`，順便加進 `wornGearIds`。角色一開始就單著自己的初始武器/裝備，不需要玩家在第一回合手動操作。

## 前端選單（`CharacterPanel.jsx`）

取代現在寫死的「`!isMaterial` 才顯示使用／有同房玩家才顯示給予／永遠顯示遺留」邏輯，改成依 `category` 決定選項組合：

| category | 選項（依序） |
|---|---|
| `weapon` | 手持（若 `player.wieldedWeaponId === itemId` 則顯示「取下」）／給予／遺留 |
| `gear` | 配戴（若 `player.wornGearIds.includes(itemId)` 則顯示「取下」）／給予／遺留 |
| `consumable` | 使用（`isMaterial` 為 true 則不顯示）／給予／遺留 |
| `reusable` | 使用／給予／遺留 |
| `decoration` | 給予／遺留（無使用/手持/配戴選項） |

「給予」的既有規則不變（只有同房間有其他玩家時才顯示）。

預兆卡（`omen`）不在這五個 category 分類裡，現有的道具選單分支處理方式完全不動。

## 已確認的邊界情況

- **`wield`/`wear` 的合法性檢查**：只能對背包裡對應 category 的道具操作（`wield` 只認 `weapon`，`wear` 只認 `gear`），類別不符直接拋錯（例如 `INVALID_ITEM_CATEGORY`）
- **`unwield`/`unwear` 的合法性檢查**：只能對「真的處於手持/配戴中」的那件道具操作，否則拋錯（例如 `ITEM_NOT_WIELDED`/`ITEM_NOT_WORN`）
- **手持換持**：已手持武器時再手持另一件，自動換持，不需要玩家先手動取下
- **配戴無上限**：只要背包裡有，想配戴幾件都行，不需要額外檢查或自動取下舊的
- **手持/配戴/取下皆扣 1 行動力**：跟現有的給予/自願遺留/拿取一致，不特別後門

## 範圍排除

- **攻擊機制本身不在範圍內**：手持武器只是設定「目前是哪一件」，實際攻擊時要用哪項能力、擲幾顆骰、怎麼計算傷害，都是既有的 M3 待辦（`attackStat`/`attackDice` 欄位值、`actionType:'attack'` 的實際邏輯），這次不動
- **weapon/gear 各卡片自己的被動效果不在範圍內**：`item_008`（護心鏡）／`item_024`（運動鞋）／`item_031`（安全帽）／`item_037`（陰陽玉珮）這幾張的減傷/格擋效果，大多還是 `needsCustomLogic` 或空 `effects`，屬於個別卡片機制實作，這次不處理。未來實作這些效果時，自然會讀取 `wornGearIds`／`wieldedWeaponId`
- **召喚物攜帶的道具**（`player.summons.carryingItemId`）不受影響，跟這次的手持/配戴機制完全獨立

## 測試重點

- `wield`/`unwield`/`wear`/`unwear` 各自的基本行為（設定/清除對應欄位、扣 1 行動力）
- 手持換持：已手持 A，手持 B，A 自動變回未手持、B 變成手持中
- 配戴無上限：連續配戴多件，全部成功
- `wield`/`wear` 對錯誤 category 的道具操作會被拒絕
- `unwield`/`unwear` 對「沒有在手持/配戴中」的道具操作會被拒絕
- 給予/遺留（含物品攜帶上限機制的強制遺留）手持中的武器或配戴中的裝備後，裝備狀態正確清除
- `item_010`（油燈）的擲骰介入，配戴中才觸發、未配戴（僅持有）不觸發
- 開場自動裝備：角色初始道具是 weapon/gear 時，遊戲開始後 `wieldedWeaponId`/`wornGearIds` 已正確設定
- 前端選單依 category 顯示正確的選項組合，含「已裝備中→顯示取下」的切換
