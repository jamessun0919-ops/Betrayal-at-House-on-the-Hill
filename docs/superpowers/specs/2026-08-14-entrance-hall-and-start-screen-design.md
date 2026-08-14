# 大門廳整合＋遊戲開始階段畫面 設計文件

## 背景與目標

開發者已用先前確認的房間美術圖 prompt 規則，生成了 4 張大門廳專屬房間圖（`img/rooms/LobbyA.webp`／`LobbyB.webp`／`LobbyC.webp`／`2Fladder.webp`，皆為 1254×1254px、合計約 1.5MB）。這次工作把這 4 張圖實際整合進遊戲：後端重新設計起始房間資料結構，前端建立玩家進入遊戲後看到的第一個畫面。

**範圍限定**：只做大門廳（進入遊戲的起始畫面），不做完整 M2D3 地圖骨架（其餘 27 間一般房間目前只有 6 張已生成，留待後續）。

## 後端：起始房間資料整合

現有 `placeFixedRoom` 把 4 個起始房間（大門廳／廊廳／梯廳／二樓平台）全部設成 `doorSides: ALL_SIDES.slice()`（四面永遠是門），是尚未真正設計過的預留寫法，可以直接重新設計不用顧慮相容性。

**完全取代**大門廳＋廊廳＋梯廳這三個舊房間，改成三個縱向排列的新房間：

| 房間 ID | 中文名 | 圖檔 | 座標（相對） | `doorSides` |
|---|---|---|---|---|
| `room_lobby_a` | 大門廳 | `LobbyA.webp` | 最下（南） | `['north','east','west']` |
| `room_lobby_b` | 大門廳 | `LobbyB.webp` | 中間 | `['north','south','east','west']` |
| `room_lobby_c` | 大門廳 | `LobbyC.webp` | 最上（北） | `['west','south']` |
| `room_upper_landing` | 二樓平台 | `2Fladder.webp` | 二樓，不變 | `['north','east','west']` |

- LobbyA 的南側（室外正門）、LobbyC 的東側（鎖死的地下室樓梯）都是**裝飾用**，不放進 `doorSides`——跟保險庫房間圖裡的裝飾性保險箱門是同一種處理方式，不需要新機制
- LobbyC 通往二樓平台走既有的 `stairsLink`／`useStairs` 機制（`gameState.board.stairsLink = {groundRoomId: 'room_lobby_c', upperRoomId: 'room_upper_landing'}`），不是 `doorSides`，完全沿用現有程式碼
- `placeFixedRoom` 需要改成可以指定 `doorSides`（不再寫死 `ALL_SIDES`）
- `starting-rooms.json` 的 4 筆資料改成上表內容，新增 `filename` 欄位（值為圖檔檔名，比照角色資料 `characters.json` 已經在用的欄位慣例）

## 前端：遊戲開始階段畫面（範圍＝大門廳）

- 玩家位於 `room_lobby_a`／`room_lobby_b`／`room_lobby_c` 任一格時，畫面**縱向完整顯示這三張圖**（不裁切、不做鄰居淡化），呈現連續大門廳的視覺效果——這三張圖本身已經設計成無縫拼接（紅地毯在開放邊緣處自然淡出/貫穿），不需要額外的裁切/淡化處理
- 門按鈕依真實 `doorSides` 顯示：LobbyA/B 的東西門、LobbyC 的西門（門的視覺樣式沿用先前確定的規則：已探索/未探索用不同圖示）
- LobbyC 的樓梯圖示對應既有的「使用樓梯」按鈕/事件（`game:useStairs`），二樓平台的南側樓梯圖示同理
- 圖檔從 `img/rooms/` 複製進 `client/public/images/`（比照角色圖片既有慣例的資料夾位置），4 張圖合計約 1.5MB，不需要縮圖
- 二樓平台目前**不在**這次範圍內顯示完整畫面（玩家開局不會站在那裡），但它的 `filename`/`doorSides` 資料這次一併補齊，供之後樓梯功能實際測試使用

## 範圍外事項

- 其餘 27 間一般房間的地圖顯示（聚焦/總覽模式、鄰居淡化裁切等）——留待後續 M2D3 前端骨架計畫，等房間美術圖陸續生成後再做
- 右側人物面板骨架——不在這次範圍
- 二樓平台的完整畫面呈現（玩家實際走上二樓後看到的畫面）——這次只補資料，不做前端渲染
