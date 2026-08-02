# M2b：選角色、提問協定、回合流程 — 設計文件

日期：2026-08-02
狀態：已與開發者確認，準備進入 `writing-plans` 撰寫實作計畫

## 背景

M2a（[docs/superpowers/plans/2026-08-01-m2a-board-and-player-state.md](../plans/2026-08-01-m2a-board-and-player-state.md)）已完成並合併進 `main`，建立了純邏輯的資料層：`contentLoader.js`（讀資料檔）、`doorLayout.js`（門朝向計算）、`boardGenerator.js`（版圖狀態管理）、`playerEntity.js`（玩家實體，本次會話已改為刻度制）、`gameState.js`（把版圖跟玩家綁在一起的容器）。

M2b 要在這層之上，把「選角色」「回合流程」「提問協定」接進 Socket.IO，讓一整局遊戲從「大廳」走到「玩家可以真的移動、開門、進行動作」。核心設計已經寫在 [docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md](2026-08-01-turn-flow-and-action-points.md)（回合流程、行動力、提問協定的基本形狀），這份文件補上該文件沒涵蓋、且是 M2b 才浮現的架構決定：遊戲狀態怎麼跟房間綁在一起、選角色怎麼做、房間磚牌庫怎麼管理、門的鄰接判定規則。

## 1. 遊戲狀態存放架構

新增 `server/src/game/gameManager.js`，跟既有的 `server/src/lobbyManager.js` 平行、職責分離：

- `LobbyManager`（既有，不動）：管大廳——房間裡有哪些玩家、名字、socket 綁定
- `GameManager`（新增）：管 `roomCode -> gameState`，`gameState` 由 M2a 的 `createGameState(startingRooms)` 建立。只有在該房間「選角色完成」之後才會建立對應的 `gameState`；在此之前（大廳、選角色階段）該房間沒有 `gameState`

`GameManager` 大致介面（實際簽名留給實作計畫定案）：
- `startGame(roomCode, playerCharacterAssignments)`：依每位玩家選定的角色資料呼叫 `createGameState`＋`addPlayer`，回傳建立好的 `gameState`
- `getGameState(roomCode)`：查詢
- `endGame(roomCode)`：遊戲結束後清除（M2b 不實作觸發時機，只留介面）

## 2. 選角色流程

### 觸發條件
房主在大廳人數足夠（≥ 2 人）時，可以觸發「開始選角色」（新事件，房主限定；人數不足時拒絕）。

### 角色資料
`data/characters/characters.json` 目前是 6 個佔位角色（真實刻度數值尚未由開發者填寫，會先用同一套測試假數值代替，不影響流程開發；[README](../../../data/characters/README.md) 有欄位格式說明）。角色屬性採**刻度制**（`track` 陣列 + `baseIndex`／`skullIndex`，非連續整數，可能重複），已在 `server/src/game/playerEntity.js` 實作。

### 互動流程
1. 系統產生一份隨機順序，決定「選角色的順序」——**這份順序只用在選角色，跟後續回合順序是分開各自骰的兩件事**（開發者已確認不要一次骰兩用）
2. 依序，每次只有一位玩家在「選」：透過既有提問協定廣播「XX 玩家選擇中」＋角色清單（哪些位置已被鎖定、哪些還能選）＋ **30 秒倒數**（覆寫標準 20 秒——這是提問協定既有「逾時秒數可覆寫」設計的第一個實際用例）
3. 所有玩家（不限輪到的人）隨時可以瀏覽全部 6 個角色的完整資訊——這不算「提問」的一部分，是唯讀的旁觀權限
4. 該玩家從**尚未被鎖定**的角色中選一個並**確認**——確認當下該角色立即熄滅（不可再被選），輪到下一位；瀏覽/游標移動不會有即時鎖定或預覽廣播
5. 逾時未確認 → 從當下仍可選的角色中隨機指定一個給該玩家
6. 全部玩家都選完 → 呼叫 `GameManager.startGame(roomCode, ...)`，正式建立 `gameState`，進入回合流程階段

### 給後續 Phase 2（AI 玩家）的擴充備註
**本次僅記錄設計意圖，M2b 不實作：**
- 加入 AI 玩家時，AI 的選角色順序要排在所有真人玩家之後（真人先選、AI 選剩下的）
- 但**回合行動順序**（下一節）本身是完全隨機，不因為是 AI 或真人而有順序上的差異對待
- AI 玩家數量**不可超過**真人玩家數量——這是刻意的產品定位限制，本遊戲的核心目的是「社交合作遊戲」，AI 只是補位、避免湊不到人時玩不成，不能讓遊戲變成可以整場都是 AI 的單機遊戲。這條限制之後要在「加入 AI 玩家」的事件或 `GameManager` 邏輯層做檢查

## 3. 回合順序

選角色完成、`gameState` 建立後，**另外獨立產生一份隨機順序**做為回合行動順序（跟選角色順序無關，各自隨機）。

## 4. 提問協定：補上「可覆寫的逾時秒數/預設行為」

[turn-flow-and-action-points.md](2026-08-01-turn-flow-and-action-points.md) 已定案的 `game:prompt`/`game:promptRespond`/`game:promptResolved` 協定（單一待處理提問、伺服器權威倒數、其他人唯讀可見）本身不需要改設計，M2b 要把「每種提問類型可以有自己的逾時秒數與逾時預設行為」做成程式介面，而不是寫死 20 秒。選角色的 30 秒+隨機指定就是第一個非標準案例；後續 M2c/M3 的卡片使用提問、傷害分配提問都會沿用同一套機制，各自套用自己的秒數/預設行為。

## 5. 移動與開門判定

### 移動到已探索房間
沿用開發者本次確認的門鄰接規則：**移動方向上，出發房間跟目的地房間都要在對應邊列出門，兩邊都同意才算有門可通行**（AND 邏輯）。已放置房間的 `doorSides` 資料本身不會被事後竄改（那是該房間自己的門位置紀錄），純粹是「這條邊能不能走」的判定邏輯，用兩邊資料一起檢查。這條判定邏輯是新函式（暫定放在 `boardGenerator.js`，操作對象就是它管理的 `board` Map），不需要新模組。

### 開門（走進未探索方向）
- 新增「房間磚牌庫」狀態：`rooms.json` 讀入後洗牌，依序抽、抽過不重抽，剩餘/已抽紀錄放進 `gameState`（新欄位，例如 `roomDeck`）
- 玩家開門時：從牌庫抽一張 → 呼叫 M2a 的 `placeNewRoom` 擺上板圖 → 該玩家行動力歸零 → 若該房間 `drawType` 不是 `"none"`，標記「需要抽事件/道具/預兆卡」但**不解析卡片效果**（卡片牌庫與效果解析器是 M2c 範圍，M2b 只負責留一個明確的掛勾點，例如回傳一個 `pendingCardDraw: { deck: 'item' }` 之類的訊號讓 M2c 接手）
- **牌庫抽完（全部房間磚都已探索）時的行為（開發者已定案）**：從此之後，「開門」這個動作整組跳過——所有還連接著未探索座標的門，一律視為牆（不能再選擇開門，因為已經沒有房間磚可以放）；遊戲用當下已經探索出來的固定版圖結構繼續正常進行到結束，不會卡住或報錯。判斷「牌庫是否已空」的檢查點放在玩家做「移動」選擇、列出可選動作時（開門選項若牌庫已空就不會出現在選單裡），而不是等玩家選了開門才擋下來

## 6. 遊戲狀態序列化

`gameState.board.ground`/`.upper`/`gameState.players` 都是 JS `Map`，`JSON.stringify` 會變成 `{}`（M2a 最終審查已發現這個問題，當時記錄為「M2b 要處理」）。新增 `serializeGameState(gameState)`，把 `Map` 轉成 Socket.IO 可以廣播的純物件（陣列或 plain object 皆可，實作計畫階段定案），供每次狀態變化後廣播給房間內所有 client。

## 7. 新增／擴充模組清單

| 模組 | 職責 |
|---|---|
| `server/src/game/gameManager.js`（新） | `roomCode -> gameState` 生命週期管理 |
| `server/src/game/roomDeck.js`（新，暫定檔名） | 房間磚牌庫：洗牌、依序抽、查剩餘 |
| `server/src/game/promptState.js`（新，暫定檔名） | 單一待處理提問狀態機：建立/回應/逾時，支援每種類型自訂秒數與逾時預設行為 |
| `server/src/game/turnFlow.js`（新，暫定檔名） | 回合狀態機：行動力管理、第一/二層選擇流程 |
| `server/src/game/boardGenerator.js`（M2a 既有，擴充） | 新增移動鄰接判定函式（AND 邏輯） |
| `server/src/game/gameState.js`（M2a 既有，可能擴充） | 加入 `roomDeck` 欄位；新增 `serializeGameState` |
| `server/src/socketHandlers.js`（M1 既有，擴充） | 新增事件：開始選角色／角色選擇回應／移動／道具／襲擊／操作／提問回應等 |

## 8. 測試策略

沿用 M2a 模式：`GameManager`、`roomDeck`、`promptState`、`turnFlow` 的狀態機邏輯本體都是純函式/純物件操作，不依賴 Socket.IO，用 Jest 單元測試（跟 M2a 一樣，測試用自建 fixture，不依賴 `data/` 底下的真實內容檔完整度）。`socketHandlers.js` 的事件層整合測試沿用 M1 建立的「起兩個以上 client 連線互動」測試模式。

**額外新增（開發者本次要求）**：M2b 計畫的最後一個任務，加一個**簡易除錯用測試頁面**（不是正式美術/遊戲介面，純粹是按鈕觸發各個新 Socket.IO 事件、畫面上直接顯示回傳的 JSON 狀態），讓開發者能在沒有正式遊戲介面之前，實際點選驗證選角色鎖定、提問倒數、回合流程等行為是否符合預期。正式的遊戲介面（板圖渲染、角色卡美術等）留給後續里程碑。

## 範圍外事項（記錄供後續參考）

- 卡片牌庫與效果解析器（M2c）
- AI 玩家（Phase 2）：選角色順序排真人之後、數量不可超過真人數量（見第 2 節備註）
- 正式遊戲介面美術（板圖、角色卡視覺呈現）：留給後續里程碑，M2b 只做除錯用測試頁面
