# 房間圖片旋轉機制 設計文件

> **狀態：設計討論進行中，尚未核准、尚未實作**。目前卡在 `rooms.json` 需要開發者逐間房間填入 `canonicalDoors` 資料，填完後才能繼續完成設計並轉入 `writing-plans`。

## 背景與目標
房間美術圖風格從一開始就是為了「單張圖旋轉對應任意真實門位置」設計的完全平面俯視圖（見 [2026-08-13-m2d3-gameplay-screen-design.md](2026-08-13-m2d3-gameplay-screen-design.md) 的「門型變體策略」），但實際的旋轉渲染邏輯從未寫過——目前房間圖固定角度顯示，跟玩家實際進入方向、跟這局遊戲隨機出來的真實門位置都無關。

目標：房間第一次被抽到並放置到地圖上時，計算一個旋轉角度，讓房間圖片裡畫死的門框位置對齊這個房間實例真實的門位置（`doorSides`），之後這個房間顯示的角度就固定下來（不管是玩家站在裡面看、還是被顯示為其他房間的鄰房）。

## 關鍵發現：畫死方向不是全類別統一，是逐間房間各自決定

最初設計假設「同一種門數/門型類別的房間，共用同一組畫死方向」（例如所有 `doors:3` 房間的唯一牆都固定畫在同一側）。開發者以實際圖片（`room_dining`，`doors:3`）核對後推翻這個假設：

- **`doors:1`**：門固定畫在同一側（開發者確認影響不大，可視為全類別統一）
- **`doors:4`**：四面都是門，不需要旋轉邏輯
- **`doors:3`**：唯一的牆可能在上/下/左/右任一側，依每間房室內家具的擺設方式各自決定，**不是全類別統一**
- **`doors:2`（`doorPattern:"opposite"`）**：門可能是上下、也可能是左右，同樣依各房決定
- **`doors:2`（`doorPattern:"adjacent"`）**：門可能開在上左、也可能是上右，同樣依各房決定

結論：**畫死方向無法用「門數/門型」推算，必須逐間房間記錄實際生成的圖片方向。**

## 資料模型：`rooms.json` 新增 `canonicalDoors` 欄位

`data/rooms/rooms.json` 的每一間房間新增 `canonicalDoors` 欄位（已完成，見下方「目前進度」），記錄這張圖片在未旋轉狀態下，門框實際畫在哪幾側。

- **型別**：字串陣列，值域跟現有 `doorSides`（`server/src/game/doorLayout.js` 的 `SIDES`）共用同一套詞彙：`"north"`/`"east"`/`"south"`/`"west"`（不用 `up`/`down`/`left`/`right`，避免額外的詞彙轉換層，直接跟旋轉演算法比對）
- **範例**（`room_dining`，`doors:3`，圖片門在上/下/右）：
  ```json
  "canonicalDoors": ["north", "south", "east"]
  ```
- **由開發者手動填入**：這個資訊只有實際看過每張生成圖片才能判斷，agent 無法從既有資料推算。`doors:4` 的房間可以直接填 `["north","east","south","west"]`（四面都是門，不需要真的看圖判斷）；`doors:1` 的房間開發者確認統一在下方，可以直接填 `["south"]`（如果逐一核對後方向確實一致的話）。

## 旋轉角度計算（設計方向，尚未寫入計畫細節）

伺服器端房間放置時（`server/src/game/boardGenerator.js`，跟現有 `computeDoorLayout` 算出真實 `doorSides`的同一個地方）：

1. 讀取這間房間定義的 `canonicalDoors`（畫死方向）
2. 依序嘗試 0°／90°／180°／270° 四種旋轉：把 `canonicalDoors` 的每一側依旋轉角度做循環位移（`SIDES` 陣列本身就是順時針順序 `['north','east','south','west']`，旋轉 90° 等於陣列索引 `+1`），看旋轉後的集合是否等於這間房間實例真實的 `doorSides`
3. 找到吻合的角度即為這個房間實例的 `rotation`（0/90/180/270），跟 `doorSides` 一樣存進這個房間的放置實例資料，一路傳到前端（沿用既有 `game:stateUpdate` 的資料流，不需要新增 socket 事件）
4. `doors:4` 的房間固定 `rotation:0`（旋轉沒有視覺意義）；大門廳三格／二樓平台／地下平台等固定房間（`placeFixedRoom` 放置、`doorSides` 是寫死的）不套用這套機制，維持固定顯示不旋轉

## 前端套用範圍

- **中心房間格**（`FocusedRoomView.jsx` 的 `RoomTile`）：新增 `rotation` prop，套用 CSS `transform:rotate(Xdeg)`
- **鄰房預覽帶**（`NeighborPeek`）：目前用 `background-image` + `backgroundPosition` 定位裁切一小段邊緣畫面；要讓鄰房預覽也旋轉一致，需要改成跟主房間一樣用 `<img>` + `transform:rotate()` + 外層裁切容器（`overflow:hidden`）的做法——這是這次改動裡範圍較大的一塊，還沒細部設計

## 目前進度
- ✅ 已跟開發者確認範例房間（`room_dining`）並定案 `canonicalDoors` 欄位格式（陣列＋north/east/south/west）
- ✅ 已在 `rooms.json` 全部 52 間房間加上 `"canonicalDoors": null` 佔位欄位（2026-08-20），等開發者逐間填入真實資料
- ⏸️ **暫停中**：等開發者補完 52 間房間的 `canonicalDoors` 資料後，才能繼續往下定案旋轉角度計算的實作細節與 `NeighborPeek` 改版方案，再轉入 `writing-plans`
