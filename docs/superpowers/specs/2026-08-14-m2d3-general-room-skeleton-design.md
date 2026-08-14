# M2D3 一般房間地圖骨架＋人物面板 設計文件（追加確認）

依 [2026-08-13 M2D3 設計文件](2026-08-13-m2d3-gameplay-screen-design.md) 原本的規劃為主，本文件記錄這次實作前額外確認的細節。

## 範圍

大門廳三格（`room_lobby_a/b/c`）已有專屬的 `EntranceHallView`（無縫堆疊顯示），維持不變。這次做**其餘一般房間**的地圖骨架：聚焦模式（目前房間＋鄰居裁切預覽）、總覽模式、人物面板骨架。

## 資料現況

- `rooms.json` 31 筆已全數補上 `filename` 欄位：16 筆有實際檔名，15 筆為 `null`（尚未生成美術圖）
- 後端資料已就緒（M2D3 後端計畫已合併）：`roomContent:{rooms, startingRooms}`、`serializeGameState().roomDeck.hasRoomForGround/hasRoomForUpper`、`player.visitedRooms`

## 這次確認的細節

- **鄰居預覽**：裁切目前房間對應那一側的鄰居圖片一小塊（寬/高 20~30%），疊加透明度漸層朝外淡出
- **門狀態樣式**：已探索移動＝開啟的門框樣式；開新門＝關閉/問號樣式，兩者視覺明顯不同
- **無美術圖房間**：純色塊＋房間名稱文字佔位（總覽模式本來就一律用色塊，這條規則額外適用於聚焦模式沒圖的情況）
- **人物徽章**：圖檔尚未提供，先用實心圓點（各玩家固定顏色，依 `gameState.players` 陣列順序分配）＋名字首字佔位
- **道具清單**：這階段顯示原始 `item.id`，友善名稱需要新的後端內容管道（卡牌內容目前從未廣播給前端），列為後續工作，這次不做
- **前端沒有測試框架**：延續本專案所有前端工作的既有做法，靠瀏覽器手動驗證，不新增 Jest/Vitest 等依賴

## 技術決策：門狀態前端推算需要比對照 `blocksOpenDoor` 修正效果

複查 `server/src/game/turnFlow.js` 的 `getAvailableDirections` 後發現，除了門/鄰居資料外，還會檢查 `hasModifierEffect(player, 'blocksOpenDoor')`（電池耗盡效果）——玩家身上有這個修正時，即使還有房卡可抽，也不會提供「開新門」選項。前端推算邏輯必須把這個條件也納入，否則玩家會看到一個實際點了會被伺服器拒絕的按鈕。`player.modifiers` 已經整包廣播（比照 `inventory` 現有慣例），前端可以直接讀取。
