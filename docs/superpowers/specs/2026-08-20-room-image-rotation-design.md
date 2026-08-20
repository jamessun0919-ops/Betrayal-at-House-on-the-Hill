# 房間圖片旋轉機制 設計文件

> **狀態：已實作並合併進 `main`。**

## 背景與目標

房間美術圖風格從一開始就是為了「單張圖旋轉對應任意真實門位置」設計的完全平面俯視圖（見 [2026-08-13-m2d3-gameplay-screen-design.md](2026-08-13-m2d3-gameplay-screen-design.md) 的「門型變體策略」），但實際的旋轉渲染邏輯從未寫過——目前房間圖固定角度顯示，跟玩家實際進入方向、跟這局遊戲隨機出來的真實門位置都無關。

目標：房間第一次被抽到並放置到地圖上時，計算一個旋轉角度，讓房間圖片裡畫死的門框位置對齊這個房間實例真實的門位置（`doorSides`），之後這個房間顯示的角度就固定下來。**範圍已確定只套用在玩家自己站在裡面看的中心房間格，不套用在鄰房預覽帶（見下方「範圍排除」）。**

## 關鍵發現：畫死方向不是全類別統一，是逐間房間各自決定

最初設計假設「同一種門數/門型類別的房間，共用同一組畫死方向」（例如所有 `doors:3` 房間的唯一牆都固定畫在同一側）。開發者以實際圖片（`room_dining`，`doors:3`）核對後推翻這個假設：

- **`doors:1`**：門固定畫在同一側（開發者確認影響不大，可視為全類別統一）
- **`doors:4`**：四面都是門，旋轉演算法自然算出 0°（見下方，不需要特殊判斷）
- **`doors:3`**：唯一的牆可能在上/下/左/右任一側，依每間房室內家具的擺設方式各自決定，**不是全類別統一**
- **`doors:2`（`doorPattern:"opposite"`）**：門可能是上下、也可能是左右，同樣依各房決定
- **`doors:2`（`doorPattern:"adjacent"`）**：門可能開在上左、也可能是上右，同樣依各房決定

結論：**畫死方向無法用「門數/門型」推算，必須逐間房間記錄實際生成的圖片方向。**

## 資料模型：`rooms.json` 的 `canonicalDoors` 欄位（已完成）

`data/rooms/rooms.json` 每一間房間都有 `canonicalDoors` 欄位，記錄這張圖片在未旋轉狀態下，門框實際畫在哪幾側。

- **型別**：字串陣列，值域跟現有 `doorSides`（`server/src/game/doorLayout.js` 的 `SIDES`）共用同一套詞彙：`"north"`/`"east"`/`"south"`/`"west"`
- **範例**（`room_dining`，`doors:3`，圖片門在上/下/右）：`["north", "south", "east"]`
- **已由開發者逐間填完（2026-08-20）**：全部 52 間房間皆已核對，包含填值過程中發現並修正的 2 項缺口——`room_kitchen` 補上 `["west","east","south"]`；`room_gallery` 的門數從 3 改為 2（`canonicalDoors:["east","west"]`，並補上對應的 `doorPattern:"opposite"`）。

## 旋轉角度計算（伺服器端）

**新增函式**：`server/src/game/doorLayout.js` 新增 `computeRotation(canonicalDoors, doorSides)`（跟現有 `SIDES`/`computeDoorLayout` 同檔案，都是處理門方位的邏輯）。

演算法：依序嘗試 0°／90°／180°／270° 四種旋轉，把 `canonicalDoors` 陣列的每一側依 `SIDES`（`['north','east','south','west']`，順時針）做循環位移，比對旋轉後的集合是否等於這個房間實例真實的 `doorSides` 集合（`Set` 比較，不管順序）。找到吻合的角度即回傳（`0`/`90`/`180`/`270`）。

**`doors:4` 不需要特殊判斷**：`canonicalDoors` 是全部 4 側時，任何旋轉角度算出來的集合都相同，演算法在第一次嘗試（0°）就會吻合，自然得到 `rotation:0`，不需要另外寫 `if (doors === 4)` 的特殊分支。

**找不到吻合角度時，先分辨兩種情況（全分支審查後修正，見下方「已知限制」）**：`computeDoorLayout` 有一條既有的、刻意設計的 fallback——當所有候選門位置組合都跟已放置的鄰房衝突時，會放棄湊出宣告的門數，把房間強制退化成只剩入口那一扇門，不管這間房原本宣告幾扇門。這種情況下真實 `doorSides` 的數量會比 `canonicalDoors` 少，這是引擎既有的合法行為，不是資料填錯，`computeRotation` 回傳 `0`（不旋轉），不拋錯。只有**門數相同、但四個角度都對不出真實 `doorSides` 形狀**時，才是真的資料填錯（例如 `doors:2 opposite` 的房間，`canonicalDoors` 卻填成相鄰的兩側），這時才拋出 `ROTATION_NOT_FOUND`，跟這個檔案既有的 `INVALID_DOOR_COUNT` 等錯誤風格一致，讓真正填錯的資料在測試/實際遊玩時立刻爆出來。

**已知限制（開發者已確認接受）**：房間因為上述 fallback 被退化成只剩入口一扇門時，房間美術圖仍會畫出原本宣告的門數（例如仍畫出 4 個門框），但只有入口方向的行動按鈕真的可以互動。玩家主要依賴方向按鈕辨認可走方向，不是靠美術圖數門，暫不處理這個視覺落差。「先判斷合理房型再抽房間卡」（讓抽卡結果從一開始就符合鄰房限制，減少甚至消除退化情況）列為新待辦，另外討論。

**呼叫點**：`server/src/game/boardGenerator.js` 的 `placeNewRoom`／`placeRoomAt`（兩個用 `roomDefinition` 建立新房間實例的地方），算完 `doorSides` 後立刻呼叫 `computeRotation(roomDefinition.canonicalDoors, doorSides)`，結果存進 `placedRoom.rotation`，跟 `doorSides` 一樣是房間實例資料的一部分。`placeFixedRoom`（大門廳三格／二樓平台／地下平台，`doorSides` 是寫死的固定房間）維持不變，不產生 `rotation` 欄位，繼續固定角度顯示。

**資料如何傳到前端**：`gameState.js` 的 `serializeRoom()` 目前是 `const { item, ...rest } = room`（只剔除 `item`，其餘欄位原樣傳出），`placedRoom` 多了 `rotation` 欄位後會自動隨既有的 `game:stateUpdate`／`game:started` 廣播送到前端，**不需要修改 `gameState.js`／`socketHandlers.js`**。

## 前端套用：中心房間格（`RoomTile`／`FocusedRoomView`）

`RoomTile.jsx` 新增 `rotation` prop，套用到 `<img>` 的 CSS `transform`。

**跟現有縮放/拖動功能的疊加順序**：`FocusedRoomView.jsx` 目前把縮放/拖動的 transform 寫在傳給 `RoomTile` 的 `style.transform`（`translate(pan) scale(zoom)`）。旋轉必須放在**最內層**（離圖片本身最近，最先套用）：

```
transform: translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)
```

原因：旋轉是房間固定屬性，縮放/拖動是玩家當下操作。如果旋轉包在最外層，拖動方向會跟著房間旋轉角度歪掉（例如房間轉 180°，玩家往右拖手指，畫面內容卻往左移，違反直覺）。用上面這個順序，拖動/縮放永遠是「螢幕座標」上的直覺方向，跟房間旋轉多少度無關。

**資料來源**：`currentRoom.rotation` 直接從 board 資料讀（隨 `game:stateUpdate` 自動送達），`FocusedRoomView` 傳給 `RoomTile`。固定房間讀到 `undefined` 時預設當作 `0`（不旋轉），符合它們既有的「固定角度顯示」設計。

## 範圍排除：鄰房預覽帶（`NeighborPeek`）不套用旋轉

**這是本次設計討論後確定縮小的範圍**：原本設計方向規劃鄰房預覽帶（`NeighborPeek`）也要跟著旋轉一致，改版方案是把目前 `background-image`+`backgroundPosition` 的做法換成 `<img>`+`transform:rotate()`+外層裁切容器。

**開發者實測後決定不做**：鄰房預覽帶本來就窄（`--peek-size`，房間格的 15% 寬），移動/開門按鈕本來就蓋在門框位置上，鄰房角度不對、門框對不上，在實際遊玩畫面上不會造成明顯的視覺問題。**這個限制列為已知、刻意不處理**，`NeighborPeek` 維持現有的 `background-image`+`backgroundPosition` 實作，不套用 `rotation`，也不需要任何前端改動。**前端套用範圍最終只有中心房間格一處。**

## 範圍註記：本機制假設房間都是正方形（1x1）

目前 `rooms.json` 全部 52 間房間 `size` 都是 `"1x1"`（已核對）。旋轉演算法與 `RoomTile` 的 CSS `transform:rotate()` 都仰賴「正方形旋轉 90°/180°/270° 後外框大小不變」這個前提。如果未來新增非正方形（例如 `2x1`）的多格房間，這套機制需要重新設計，本次不處理。

## 目前進度
- ✅ `canonicalDoors` 欄位格式定案並填完全部 52 間房間（含填值過程中修正的 `room_kitchen`／`room_gallery` 2 項資料缺口）
- ✅ 旋轉角度計算演算法、伺服器端呼叫點、資料傳輸方式已定案並實作完成
- ✅ 前端 `RoomTile` 套用旋轉的做法（含跟縮放/拖動的疊加順序）已定案並實作完成，瀏覽器實測通過
- ✅ 鄰房預覽帶範圍已確定排除，不套用旋轉
- ✅ **已完成並合併進 `main`**：走完整 `brainstorming`→`writing-plans`→`subagent-driven-development` 流程（3 任務＋全分支審查）。全分支審查抓到 1 個 Critical（`computeRotation` 跟 `computeDoorLayout` 既有的「退化成單門」fallback 衝突，會讓多數遊戲局中途拋錯），已修復並複審通過，見上方「已知限制」。509/509 測試全綠。
