# 筆記資訊（私人資訊區塊）— 設計文件

## 目標

把 M2D3 待辦「私人資訊區塊」併入既有的地圖總覽畫面：右上角按鈕文字從「總覽地圖」改成「筆記資訊」，點開後除了原本的房間格子地圖，額外顯示三段私人資訊——所在陣營、勝利條件、特殊房間紀錄。前兩段這次先做邪祟降臨前的固定顯示（邪祟後的實際內容留給 M3），第三段是真正有內容的新功能：玩家去過的房間，只要是「特殊機制」房間（加成/離開限制/特殊 action，不含純搜索），就把該房間的效果說明列出來供玩家回顧。

## 架構

### 1. `data/rooms/rooms.json` 新增 `effectDescription` 欄位（15 間房）

範圍（已跟開發者逐一確認）：禮拜堂／圖書室／塔橋／廚房／食品儲藏室／健身房／保險庫／雜亂的房間／藤蔓糾纏的溫室／天花板上閣樓／五芒星室／墓園／髒亂的房間／包廂房／崩塌的房間。排除純搜索房間（例如客房/浴廁/武器室這類只有預設搜索行動的房間）。

```json
{ "id": "room_chapel", "name": "禮拜堂", ..., "effectDescription": null }
```

每間房加一個 `effectDescription: null`（開發者之後自行填入文字，內容留白）。欄位命名比照既有 `feedbacktextOccur`／`needsCustomLogic` 的 camelCase 慣例。

**不需要另外維護一份「特殊房間清單」**：前端判斷「這間房算不算特殊房間紀錄」直接看 `room.effectDescription` 是不是非空字串即可——只有這 15 間房會有這個欄位，資料本身就是唯一真實來源（single source of truth），不用在前端程式碼裡再寫一份重複的 15 間房 id 清單，避免兩邊之後不同步。

### 2. 前端按鈕文字

`client/src/DebugGameScreen.jsx` 第 463 行附近：

```javascript
// 現在
{wrapLabel(mapMode === 'focused' ? '總覽地圖' : '目前房間', 2)}
```

`'總覽地圖'` 改成 `'筆記資訊'`；`'目前房間'`（返回聚焦房間畫面用）維持不變。

### 3. `OverviewMap.jsx` 新增三段私人資訊

現有 `OverviewMap` 元件（`client/src/gameplay/OverviewMap.jsx`）已經有 `visitedRooms`／`boardRooms`／`roomContent` 三個 prop，足以推導出玩家去過哪些房間、每間房的真實定義（含新的 `effectDescription`）——不需要新增任何 prop，也不需要後端新增任何廣播欄位（`roomContent` 本來就是整份房間原始資料，`effectDescription` 加進 `rooms.json` 後會自動透過既有的 `game:started` 廣播送到前端，跟 `item_040` 那次 `feedbacktextOccur` 陣列化是同一個道理）。

在現有的樓層切換按鈕與地圖格子之後，依序疊加三個區塊（同一畫面上下排列，不分頁籤）：

```jsx
<div>
  <h4>所在陣營</h4>
  <p>冒險陣營</p>
</div>
<div>
  <h4>勝利條件</h4>
  <p>未揭露</p>
</div>
<div>
  <h4>特殊房間紀錄</h4>
  {specialRoomEntries.length === 0 ? (
    <p>尚未發現任何特殊房間效果</p>
  ) : (
    <ul>
      {specialRoomEntries.map(({ roomId, name, effectDescription }) => (
        <li key={roomId}>
          <strong>{name}</strong>：{effectDescription}
        </li>
      ))}
    </ul>
  )}
</div>
```

`所在陣營`／`勝利條件` 這次只做邪祟降臨前的固定文字，不寫任何依 `gameState.hauntStarted` 切換的分支邏輯（YAGNI——沒有邪祟後的真實資料可以顯示，寫一個永遠走不到、或走到也只能顯示假資料的分支沒有意義）。等 M3 設計出「誰是邪祟」「劇本勝利條件」的資料模型後，再回頭在這兩個區塊補上條件判斷。

`specialRoomEntries` 的推導邏輯（新增到 `OverviewMap.jsx` 或抽成 `mapUtils.js` 的小函式，視實作時哪個位置更清楚）：

```javascript
function getSpecialRoomEntries(visitedRooms, roomContentAllFloors, roomContent) {
  const entries = [];
  const seenRoomIds = new Set();
  for (const v of visitedRooms) {
    const boardRoom = roomContentAllFloors[v.floor]?.find((r) => r.x === v.x && r.y === v.y);
    if (!boardRoom || seenRoomIds.has(boardRoom.roomId)) continue;
    const info = findRoomInfo(boardRoom.roomId, roomContent);
    if (info && info.effectDescription) {
      seenRoomIds.add(boardRoom.roomId);
      entries.push({ roomId: boardRoom.roomId, name: info.name, effectDescription: info.effectDescription });
    }
  }
  return entries;
}
```

**跨樓層問題**：`visitedRooms` 是 `{floor,x,y}` 陣列，涵蓋玩家去過的所有樓層，不只目前 `overviewFloor` 選中的那個樓層——`OverviewMap` 現有的 `boardRooms` prop 只帶目前樓層那份（`gameState.board[overviewFloor]`），不夠用來查全部樓層的房間定義。需要改傳整個 `gameState.board`（三個樓層都在裡面）進來，或是在 `DebugGameScreen.jsx` 把三個樓層都準備好一起傳。特殊房間紀錄要橫跨玩家去過的所有樓層顯示，不能只看目前選中的樓層（跟樓層切換按鈕本身要控制的「格子地圖顯示哪個樓層」是兩件事，不要混在一起）。

**同一間房重複出現**：`visitedRooms` 只要離開又回來就會有多筆同座標紀錄（`movePlayerTo` 的 `alreadyVisited` 邏輯只影響要不要 push 新紀錄，不會去重複房間 id），需要用 `roomId` 去重複，同一間特殊房間只列一次。

## 測試計畫

- 前端沒有自動化測試框架（既有慣例），這次比照專案一貫做法：程式碼審查 + 手動瀏覽器驗證（進一間清單內的特殊房間、開啟筆記資訊確認正確列出；進一間非特殊房間確認不會誤列；跨樓層去過的特殊房間確認也會列出）
- `data/rooms/rooms.json` 修改後跑一次後端全套測試（`cd server && npx jest`），確認純資料新增欄位不影響任何既有邏輯（`effectDescription` 沒有任何伺服器端程式碼讀取，只有前端消費）

## 範圍排除

- 邪祟降臨後「所在陣營」/「勝利條件」的實際內容——M3 範圍，這次不寫任何相關分支
- 特殊房間紀錄不記錄「純搜索」房間（客房/浴廁/武器室等），也不記錄玩家自己看過但沒有 `effectDescription` 內容的房間（`effectDescription` 是 `null` 就直接跳過，不顯示「待補充」——這是玩家的個人筆記／回顧功能，還沒填的內容沒有顯示的必要，不像卡片使用彈窗那樣一定要給玩家即時回饋）
- 15 間房清單以外的房間，即使日後也加上某種新機制，這次不主動預留欄位——之後真的有新房間需要記錄時，直接照這次的模式補 `effectDescription` 欄位即可，不需要改動這裡新增的任何程式碼
