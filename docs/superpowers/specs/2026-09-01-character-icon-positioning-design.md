# 角色 icon 定位機制（M2D3 細節⑥）— 設計文件

## 目標

補完角色圖示在房間內的定位規則：
1. 單一角色：定位在自己實際走進的那扇門前方（既有行為）
2. 兩位角色從同一扇門進入：沿牆左右並排（既有行為）
3. **房間內達 3 人以上（不論原因——起始房間、事件移動、正常走門等）：全部改成固定 2×3 格線置中，依 `characterId` 由小到大排序，依序填入格子 1~6（左上→右下），忽略每個人各自的 `enteredFromSide`**

規則 1、2 已經是 `FocusedRoomView.jsx` 的既有行為，不需要改動——`badgeStyle(enteredFromSide, index, total)` 對「同一房間 ≤2 人」的情況本來就正確：單人依 `enteredFromSide` 定位，兩人不管同門或不同門，各自的 switch 分支互不干擾，同門兩人的既有錯開間距（`BADGE_STAGGER_PERCENT`）視覺上就是「沿牆左右並排」（已用視覺化畫面跟開發者確認）。

真正需要新增的只有規則 3。

## 架構

純前端改動，只動 `client/src/gameplay/FocusedRoomView.jsx`；不需要新的伺服器欄位或廣播——`enteredFromSide`／`characterId` 資料都已經存在。

### 1. 新增 `gridBadgeStyle(slotIndex)` 函式

放在既有 `badgeStyle` 函式旁邊，同一份「百分比＋`transform`」定位風格（不依賴房間圖片實際像素尺寸）：

```javascript
// 3人以上置中時的固定 2x3 格線座標（左上到右下）。房間最多 6 人（
// content.characters.length 目前是 6），所以 6 個格子永遠夠用，不需要處理溢位。
const GRID_COLUMNS_PERCENT = [20, 50, 80];
const GRID_ROWS_PERCENT = [30, 70];

function gridBadgeStyle(slotIndex) {
  const col = slotIndex % 3;
  const row = Math.floor(slotIndex / 3);
  const size = { width: 'calc(var(--peek-size) * 0.75)', height: 'calc(var(--peek-size) * 0.75)' };
  return {
    position: 'absolute',
    left: `${GRID_COLUMNS_PERCENT[col]}%`,
    top: `${GRID_ROWS_PERCENT[row]}%`,
    transform: 'translate(-50%, -50%)',
    ...size,
  };
}
```

圖示尺寸沿用既有 `badgeStyle` 的 `--peek-size * 0.75` 公式，維持跟門邊定位一致的視覺大小。

### 2. 渲染分支：`roomsInSameSpot.length >= 3` 時改用格線定位

現有程式碼（`FocusedRoomView.jsx` 目前約第 295-306 行）：

```jsx
{roomsInSameSpot.map((p, i) => {
  const colorIndex = allPlayers.findIndex((ap) => ap.playerId === p.playerId);
  return (
    <PlayerBadge
      key={p.playerId}
      name={p.name}
      colorIndex={colorIndex === -1 ? i : colorIndex}
      iconSrc={findCharacterIcon(p.characterId, characterContent)}
      style={badgeStyle(p.enteredFromSide, i, roomsInSameSpot.length)}
    />
  );
})}
```

改成：

```jsx
{(roomsInSameSpot.length >= 3
  ? [...roomsInSameSpot].sort((a, b) => (a.characterId || '').localeCompare(b.characterId || ''))
  : roomsInSameSpot
).map((p, i) => {
  const colorIndex = allPlayers.findIndex((ap) => ap.playerId === p.playerId);
  return (
    <PlayerBadge
      key={p.playerId}
      name={p.name}
      colorIndex={colorIndex === -1 ? i : colorIndex}
      iconSrc={findCharacterIcon(p.characterId, characterContent)}
      style={roomsInSameSpot.length >= 3 ? gridBadgeStyle(i) : badgeStyle(p.enteredFromSide, i, roomsInSameSpot.length)}
    />
  );
})}
```

當人數 ≥3 時先依 `characterId` 排序整個陣列，map 的索引 `i` 直接就是排序後的名次／格子編號，不需要另外查表。人數 ≤2 時完全不動，走原本的 `.map(roomsInSameSpot)` 順序與 `badgeStyle` 呼叫，行為與現在完全一致。

### 3. 反應式重新定位（不需要額外程式碼，行為自然成立）

`roomsInSameSpot` 是每次渲染都從目前 `gameState` 重新算出的陣列（不是持久化的獨立狀態），所以人數跨過 2↔3 門檻時，畫面會在下一次渲染自動切換排版——第 3 人走進房間時，原本已經站在門邊的 2 人會跟著一起改成置中格線；若之後有人離開讓人數掉回 2，剩下的人會自動用各自記錄的 `enteredFromSide` 打回門邊定位。不需要額外寫「記住上一次排版」或「切換動畫過渡」的邏輯。

## 邊界情況

- **房間人數上限**：`maxPlayers = content.characters.length`，目前角色資料固定 6 個，所以單一房間最多 6 人，6 個格子永遠夠用，不用處理第 7 格。
- **`characterId` 排序**：角色 id 格式固定是 `char_001`～`char_006`（零填補三位數字），字串排序（`localeCompare`）結果等同數字排序，不需要額外剖析成數字。
- **同房間人數剛好等於 3～6 之間**：依排序依序填滿前 N 格（例如剛好 3 人時只用格子 1、2、3，格子 4、5、6 空著），不會固定對應某個角色 id 一定站在某個格子——已跟開發者確認採用此方案。

## 測試計畫

前端沒有自動化測試框架（既有慣例），比照專案一貫做法：程式碼審查 + 手動瀏覽器驗證，涵蓋：
- 單人進房間：確認門邊定位行為不變
- 兩人從同一扇門進房間：確認沿牆並排行為不變
- 兩人從不同門/其中一人樓梯進入：確認各自獨立定位行為不變
- 三人以上同房間（含起始房間開局、含逐一走門湊到第 3 人的情境）：確認全部改成 2×3 格線置中，且依 `characterId` 排序
- 三人以上其中一人離開房間、人數掉回 2：確認剩下的人自動恢復門邊定位

## 範圍排除

- 不處理格線位置的切換動畫/過渡效果（例如從門邊「滑動」到格線位置）——這次只要求最終畫面正確，沒有要求動畫
- 不改動 `badgeStyle`／`BADGE_STAGGER_PERCENT` 既有的門邊/兩人並排邏輯本身，只在人數 ≥3 時整個繞過它
- 6 個角色以上（超過目前 `characters.json` 定義的角色數量）不在範圍內，之後若角色數量增加需要調整格線佈局，屆時再另外處理
