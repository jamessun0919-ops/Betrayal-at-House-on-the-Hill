# M2D2：角色選擇畫面設計文件

## 背景與目標

M2D1（大廳流程）已完成並合併進 `main`，房主按下「準備完成」後目前顯示的是一個純靜態的「角色選擇開發中」佔位畫面（`CharacterSelectPlaceholder.jsx`）。本文件設計正式的角色選擇畫面，取代這個佔位畫面。

角色資料（`data/characters/characters.json`）已經填完真實內容，6 個角色都有 `codename`／`occupation`／`gender`／`age`／`tall`／`filename`（肖像圖檔名）／`itemID`+`itemname`（初始攜帶物品）／完整四項屬性 `stats`。

**這是一次純前端功能**：角色選擇的核心機制（輪流制、鎖定角色、逾時自動分配）在 M2b 就已經完成並沿用至今（`server/src/game/characterSelection.js`、`characterSelectionManager.js`、`socketHandlers.js` 的 `game:startCharacterSelect`/`game:promptRespond`），且既有的 `game:characterSelectUpdate` 廣播已經把角色選擇所需的全部資料（完整角色清單含 `tall`/`itemID`/`stats`、目前輪到誰、已鎖定角色 id 清單）送到前端。本次設計不需要新增或修改任何後端程式碼。

目標裝置維持 M2D1 的手機橫向螢幕，響應式設計。

## 機制：沿用輪流制，但所有人都能自由瀏覽

現有後端邏輯（`characterSelectionState`）：`order`（隨機洗牌的玩家順序）、`currentPicker`（目前輪到誰）、`lockedCharacterIds`（已被鎖定的角色 id 集合）、`assignments`（玩家→角色的對應）。`confirmCharacterChoice` 只接受 `playerId === currentPicker` 的請求，其餘一律拋 `CHARACTER_SELECT_NOT_YOUR_TURN`。

新畫面的互動規則：
- **所有玩家**（不分是否輪到自己）都能自由瀏覽 6 個角色、點開角色的屬性資料卡——這是純前端的畫面瀏覽狀態，不會呼叫任何會改變伺服器狀態的事件
- **「確定選擇」按鈕**：只有當下 `currentPicker === 自己的 playerId` 且該角色不在 `lockedCharacterIds` 裡時才啟用；否則按鈕不亮起，卡片上顯示文字「其他玩家選擇中，請稍後」
- 任一玩家的 `confirmCharacterChoice` 成功後，伺服器廣播新一輪的 `game:characterSelectUpdate`（既有機制不變），所有客戶端收到後，在該角色的圖片上疊加「已被選擇」標記；已被選擇的角色仍可點開瀏覽（唯讀），但確定選擇按鈕永遠不亮
- 玩家自己確定選擇後，畫面**不跳轉**，留在同一個角色選擇介面：自己選的角色資料卡變成唯讀狀態，疊加「等待其他玩家選擇中...」提示文字，可以繼續即時看到其他人陸續被鎖定的過程
- 全員選完（`isCharacterSelectionComplete`，伺服器端既有邏輯）→ 既有的 `game:started` 事件廣播，前端收到後轉場（目前轉去除錯頁面 `DebugGameScreen`，等 M2D3 完成正式遊戲畫面後才會換掉這個轉場目標）

**逾時**：既有的 30 秒逾時、自動隨機分配角色機制（`assignRandomCharacter`）完全不變，這次沒有改動。

## 畫面一：角色列（Character Gallery）

6 個角色的肖像圖橫向排列。

**尺寸邏輯**：找出 6 人中 `tall` 數值最高者（目前是 `char_003` 伐木工，180cm），該角色的肖像圖顯示高度＝螢幕高度的 2/3；其餘角色依 `tall` 屬性等比例縮小：

```
該角色顯示高度 = (該角色 tall / 最高角色 tall) × 螢幕高度 × (2/3)
```

寬度依圖片原始長寬比等比例換算，不單獨指定。

**寬度優先序**：優先維持這個高度比例（不因為要塞進單一螢幕而整體縮小），若 6 人排開後總寬度超出螢幕，允許橫向滑動查看，不強制一次顯示全部 6 人。

**互動**：觸控裝置沒有滑鼠 hover 狀態，所以「浮出＋加亮」效果統一在**點擊/點選當下觸發**（不分滑鼠/觸控，同一套邏輯）——點擊後圖片浮出（例如輕微放大＋陰影）＋加亮，接著開啟該角色的屬性資料卡（畫面二）。

**已被選擇的角色**：肖像圖疊加「已被選擇」標記圖層，點擊仍可開啟資料卡瀏覽（唯讀），但資料卡上的「確定選擇」按鈕不會亮起。

## 畫面二：屬性資料卡（疊層／彈出）

點擊角色列的某個角色後彈出，疊在角色列畫面上方（沿用 M2D1 已經建立的疊層視覺語言：半透明遮罩＋置中面板）。

**內容**：
- 姓名（`codename`）
- 職業（`occupation`）
- 四項能力數值（`might`/`speed`/`knowledge`/`sanity`，顯示當下的基礎數值，即 `track[baseIndex]`）
- 初始攜帶物品（`itemname`，`itemID` 為 `null` 的角色顯示「無」或不顯示這一項）

**底部四個按鈕**：
- **左翻／右翻**：在 6 個角色的資料卡之間切換，不用先退回角色列再重新點選；翻頁會跳過或包含已被選擇的角色都可以（已被選擇的角色資料卡本身仍可瀏覽，只是確定選擇按鈕不亮）
- **退出**：關閉資料卡，回到角色列（畫面一）
- **確定選擇**：只有輪到自己且該角色未被選走時才啟用；未啟用時卡片上顯示「其他玩家選擇中，請稍後」；點擊後呼叫既有的 `game:promptRespond`（`promptId`+`optionId` 為角色 id），成功後卡片與角色列一起更新為「已選擇/等待其他玩家」狀態（見上方機制說明）

## 前端實作範圍

- 取代 `client/src/lobby/CharacterSelectPlaceholder.jsx`（或在同一個 `client/src/lobby/` 資料夾新增角色選擇專屬元件，取代協調層 `LobbyScreen.jsx` 裡 `'placeholder'` 畫面狀態對應的元件）
- 新增角色肖像素材：把 `img/` 資料夾裡已有的 6 張角色圖（`oldman.png`／`nurse.png`／`Lumberjack.png`／`police.png`／`HighScholl.png`／`girl.png`，對應 `characters.json` 的 `filename` 欄位）複製進 `client/public/images/`，比照 M2D1 處理 `Gate.png` 的既有做法
- 監聽既有事件：`game:characterSelectUpdate`（角色清單/目前輪到誰/已鎖定清單）、`game:promptResolved`（確認選擇成功的廣播）、`game:started`（全員選完，轉場）
- 呼叫既有事件：`game:promptRespond`（`{promptId, optionId: characterId}`，只有輪到自己時才會實際送出）

## 範圍外事項

- 角色選擇逾時的畫面提示（既有 30 秒逾時機制不變，但要不要在畫面上顯示倒數計時，屬於「20 秒兩層計時提問 UI」這個專案性延後項目的一部分，本次不做，沿用現有除錯頁面等級的簡單處理）
- 全員選完後的正式遊戲畫面（M2D3 之後的範圍，本次轉場目標維持除錯頁面）
