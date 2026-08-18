# 搜索機制設計文件（取代 item 類型房間的自動抽卡）

**日期**：2026-08-18
**範圍**：把目前「進入 item 類型房間自動抽卡」機制，改成「玩家主動選擇搜索行動才取得道具」。**event／omen 類型房間維持現有的自動觸發機制，完全不動**。道具合成機制（已完成）、LobbyC 新增地下室樓梯（另外討論，不在本文件範圍）皆不涵蓋。

## 背景與現況問題

現有 `resolveCardDraw`（`server/src/socketHandlers.js`）對三種牌堆的處理方式不同：
- **omen**：抽到會 `addItem` 放進玩家背包（持有後可之後主動使用）
- **item／event**：抽到後只會**立即解析卡面 `effects`**，卡片本身不會進背包，也不會被追蹤

這代表**目前玩家探索時進入 item 類型房間抽到卡，實際上多半沒有任何效果**：大部分道具卡（左輪手槍、天使羽毛等）的 `effects` 是空陣列或是設計給「背包裡主動使用」的效果，不是「抽到當下」的效果——卡片形同憑空消失，沒有真正進入玩家背包。這是本次改動要一併修正的既有缺口，不是新引入的問題。

## 資料變更

**`data/rooms/rooms.json`**：目前 `drawType:"item"` 的 10 間房間：
- `drawType` 改為 `null`
- 新增 `"actions": ["搜索"]`
- 新增 `"item": "random_one"`

**其餘房間（含 5 間起始房間、29 間 event、10 間 omen）完全不動資料**。程式碼層級預設：房間定義缺少 `actions` 欄位時視為 `["搜索"]`；缺少 `item` 欄位時視為 `null`。也就是說，**所有房間（包含起始房間、event/omen 房間）在「行動」選單裡都會出現「搜索」，只是大多數房間搜索結果固定是「沒有找到任何東西」**（已跟開發者確認這是期望行為，範例：event 類型的「腐敗惡臭」房間也會有搜索選項，只是搜不到東西）。

**`item` 欄位語意（三選一）**：
- `["item_003", "item_009"]`（陣列）：固定候選清單，每次搜索從清單中隨機選一個嘗試取得
- `null`：這間房間搜不到任何東西
- `"random_one"`：從共用道具牌堆 `gameState.itemDeck` 隨機抽一張

**共用牌堆的關係（已跟開發者確認）**：所有道具卡集中在 `gameState.itemDeck` 這一份共用牌堆裡，**不會**因為某張卡被寫進某房間的固定清單就預先從牌堆移除。固定清單裡的 id，只是「這間房**如果**共用牌堆裡還有這張卡，搜索時可以取得」；如果那張卡已經被別的房間的 `random_one` 搜索先抽走，這間房固定清單裡的那個 id 就再也搜不到，視為沒找到（清單本身可以保留，不用主動清掉那個已經抽不到的 id，反正牌堆裡沒有就是沒有）。

**架構修正（技術查證，非產品決策，已跟開發者確認）**：`item` 欄位在遊戲進行中會變動（`random_one` 抽到後變 `null`；固定清單被搜索過的 id 會被移除），但 `rooms.json` 是所有同時進行中的遊戲共用的靜態內容資料，直接修改會互相污染。正確做法：房間被放置到地圖上時（`boardGenerator.js` 的 `placeNewRoom`/`placeRoomAt`），把房間定義的 `item` 初始值複製一份到**這個房間的地圖實體物件**上（新增欄位，跟現有 `droppedItems` 欄位同樣的做法——陣列型態要用 `.slice()` 複製，不能直接指派參照，否則陣列內容變動一樣會污染靜態資料）。之後搜索只讀寫這個地圖實體上的副本，不觸碰 `content.rooms` 的靜態資料。

## 伺服器搜索邏輯

**`player.searchedThisTurn`**：新增布林旗標，`advanceTurn`（`server/src/game/turnFlow.js`）離開玩家身上重置為 `false`（比照既有 `summonUsedThisTurn`/`diceInterjectionUsedThisTurn` 的寫法）。

`game:selectAction actionType:'room_action'`（`server/src/socketHandlers.js`）在既有的 `craftRecipes` 分支之後，新增第三個分支——當房間**沒有** `craftRecipes`、也**沒有**非空的 `effects` 時，走搜索邏輯（這是預設的兜底行為）：

1. `player.searchedThisTurn === true` → 拋 `ALREADY_SEARCHED_THIS_TURN`（在呼叫 `selectAction` 之前拋出，**不扣行動力**，跟合成機制的 `MISSING_CRAFT_MATERIALS` 是同一種「先檢查、不符合就不進入正常扣行動力流程」寫法）
2. 否則：比照現有 `room_action` 慣例扣 1 點行動力（這些房間沒有 `freeAction`），設定 `player.searchedThisTurn = true`（不論最後搜到搜不到，都算「這回合搜索過了」）
3. 依這個房間地圖實體的 `item` 副本判斷結果：
   - `null` 或空陣列 → 沒找到
   - 陣列 → 篩選出目前仍存在於 `gameState.itemDeck` 的 id，有剩的隨機選一個；都不在牌堆裡了 → 沒找到（清單本身這次搜索不變動，因為沒有真的抽到東西）
   - `"random_one"` → 從 `gameState.itemDeck` 隨機抽一張（牌堆空了 → 沒找到，`item` 欄位維持 `"random_one"` 不變，因為狀態沒有真的改變）
4. **找到東西**：從 `gameState.itemDeck` 移除該卡、若是固定清單來源則從房間實體的 `item` 陣列移除該 id、若是 `random_one` 來源則把房間實體的 `item` 改成 `null`、`addItem` 進玩家背包、廣播既有的 `game:cardDrawn`（`deckType:'item'`，沿用前端既有的「XX 在房間裡找到了 YY」訊息樣板，不需要新前端邏輯）
5. **沒找到**：廣播新事件 `game:searchEmpty`（payload `{playerId, roomId}`）

## 前端變更（`client/src/DebugGameScreen.jsx`）

新增 `game:searchEmpty` 監聽器，推一則訊息「{玩家名稱} 搜索了房間，但沒有找到任何東西」進訊息欄（跟現有 `onRoomEntered`/`onCardDrawn` 的訊息推入寫法一致）。`ALREADY_SEARCHED_THIS_TURN` 沿用既有 `actionError` 顯示機制，不特別另外處理。「行動」按鈕本身不用改，已經是通用觸發 `room_action` 的既有按鈕。

## 測試計畫

`server/test/socketHandlers.test.js`：
- `random_one` 抽中一張卡 → `addItem`、牌堆減少、房間實體 `item` 變 `null`
- `random_one` 但牌堆已空 → 廣播 `game:searchEmpty`，不扣行動力**之外**的狀態不變（`item` 仍是 `"random_one"`）
- 固定清單抽中 → `addItem`、牌堆減少、房間實體清單移除該 id
- 固定清單裡的 id 已經被別的房間 `random_one` 搶先抽走 → 視為沒找到，廣播 `game:searchEmpty`
- 一回合只能搜索一次：同回合第二次搜索（換房間也一樣）→ `ALREADY_SEARCHED_THIS_TURN`，行動力不變；下一回合重置後可以再搜索一次
- 既有 `craftRecipes`／`effects` 房間的 `room_action` 行為不受影響（回歸測試）
- **既有測試需要更新**：`game:selectAction room_action: throws NO_ROOM_ACTION_AVAILABLE when the current room has no effects` 這個測試斷言的行為（大門廳沒有 `effects` 時回傳錯誤）在新設計下不再成立——大門廳現在會走搜索分支（`item` 預設 `null`，回應「沒找到東西」而不是拋錯）。這是預期中的行為變更，需要把這個測試改寫成「大門廳的 `room_action` 觸發搜索，廣播 `game:searchEmpty`」，而不是刪掉不驗證

## 自我檢查

- 無佔位符／TBD
- 資料變更、伺服器邏輯、前端變更、測試計畫四段互相一致（`item` 欄位語意、`searchedThisTurn` 旗標、`game:searchEmpty` 事件名稱在各段落引用一致）
- 範圍單一（只處理 item 類型房間的自動抽卡→搜索轉換），不涉及 event/omen 房間、LobbyC 樓梯、道具合成機制
