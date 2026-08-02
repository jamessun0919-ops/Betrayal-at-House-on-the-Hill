# 交接文檔 Handover

最後更新：2026-08-02（第 1 次工作階段）

## 專案目標 (Project Goal)
將實體桌遊「山中小屋」(Betrayal at House on the Hill) 移植為可供多位使用者同時連線遊玩的網頁遊戲，兼具技術學習與朋友圈實際遊玩用途，並保留未來擴充原創劇本與 AI 玩家的彈性。

## 已完成進度 (Completed)
- 設計文件、MVP 里程碑拆分（M1-M4）、選定的兩個原版劇本，皆已確認（[spec 文件](docs/superpowers/specs/2026-07-31-web-multiplayer-design.md)）
- **M1（伺服器與大廳骨架）已全部完成並合併進 `main`**：[docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md](docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md)（PR [#1](https://github.com/jamessun0919-ops/Betrayal-at-House-on-the-Hill/pull/1)，已 merge）。已知非阻塞事項：`server/` 有一個 devDependency（Jest 依賴鏈上的 `brace-expansion`）npm audit high severity 漏洞，不影響正式環境，留給開發者決定是否處理。
- **M2（探索引擎）內容範圍已確認**：
  1. M2/M3 邊界：M2＝房間拼圖、移動、屬性、事件/道具/預兆卡抽取與效果解析器、**預兆計數**；M3＝鬼屋降臨觸發＋劇本外掛系統＋實作劇本1/10
  2. 內容範圍：只收錄劇本1〈神鬼痴漢〉、劇本10〈闔家團圓〉必須用到的房間/卡片，另外每類（事件卡/道具卡/預兆卡各+10，房間磚+10）加真實遊戲內容增加隨機性，不做全套內容抽取
  3. **地下室簡化（暫時性，完整版需復原）**：MVP 測試版不含地下室樓層；劇本需要的房間若原本是地下室房間，樓層屬性改為一樓
  4. 額外房間磚已排除「跟地下室有跨樓層互動關聯」的：地下湖、地底深淵、地下墓穴、來自地下室的樓梯、酒窖
- **內容資料檔已全部由開發者填完**：
  - [data/rooms/rooms.json](data/rooms/rooms.json)：31 筆房間，`id`/`name`/`floor`/`drawType`/`description`/`doors` 全部填完（**`doors` 欄位已於本次階段補齊，門數分布 2扇×17、4扇×6、3扇×5、1扇×3**）
  - [data/cards/omen-cards.json](data/cards/omen-cards.json)：13 張已全部填完真實內容，每張效果各不相同
  - [data/cards/item-cards.json](data/cards/item-cards.json)：12 張已填完真實內容（另有 2 筆刻意保留的空白項目，方便開發者之後複製貼上格式繼續填）
  - [data/cards/event-cards.json](data/cards/event-cards.json)：11 張已填完真實內容（含 1 筆刻意保留的空白項目）
  - **全部 36 張已填內容的卡片目前都標記 `needsCustomLogic: true`**：因為幾乎每張都涉及傷害系統、全域效果、持續性標記、多階骰結果等機制，詳見下方參考文件
  - **用詞已全專案統一**（`data/` 資料夾 + spec 文件，不含歷史 worklog/chatlog）：「作祟」→「邪祟」、「奸徒」→「叛徒」、「神智/神志/理智」→「意志」、「檢定」→「考驗」
  - **卡牌/房間文字的人稱慣例**：內文一律用「玩家」不用「你」；若代換後語意會混淆，要先跟開發者確認怎麼改寫，不要自己決定
- **兩份核心設計參考文件已完成，M2/M3 需要的規則設計大致齊全**：
  - [docs/superpowers/specs/2026-08-01-card-mechanics-reference.md](docs/superpowers/specs/2026-08-01-card-mechanics-reference.md)：卡片機制模式、傷害系統定案、M3 戰鬥規則、觸發時機分類表、多階骰結果格式、buff/debuff 通用機制
  - [docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md](docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md)：回合流程狀態機、Socket.IO 提問協定（`game:prompt`/`game:promptRespond`/`game:promptResolved`）
  - 房間門/連接系統：`doors` 欄位（1~4）已由開發者填完；門的實際朝向由引擎在放置當下動態計算（進入方向必有門＋剩餘隨機＋衝突則整體重試＋全部衝突時強制對齊、其餘當牆）——**此演算法已在 M2a 實作並修正過一個統計性 bug（見下方）**
- **起始房間與樓層連接**：4 塊固定起始房間（大門廳/廊廳/梯廳＠一樓、二樓平台＠二樓），梯廳固定連接二樓平台，是一二樓之間**唯一**的連接方式（一樓/二樓是兩個獨立座標網格）。資料檔：[data/rooms/starting-rooms.json](data/rooms/starting-rooms.json)
- **M2 拆成三個子計畫依序執行**（M2a/M2b/M2c，是 M2 內部分階段，不是另開新里程碑編號）：
  - **M2a：遊戲核心狀態＋房間版圖系統 —— 已完成並合併進 `main`**（commit range `fa7f493..559884d`）。5 個模組全部完成，用 `subagent-driven-development` 執行（每任務獨立實作者+審查者，最終整分支審查用 opus）：
    - [server/src/game/contentLoader.js](server/src/game/contentLoader.js)：`loadRooms(dataDir?)`、`loadStartingRooms(dataDir?)`，讀取失敗拋 `ROOM_DATA_LOAD_FAILED`
    - [server/src/game/doorLayout.js](server/src/game/doorLayout.js)：`SIDES`、`OPPOSITE_SIDE`、`computeDoorLayout(doorCount, entrySide, getNeighborRequirement)`，純函式。**最終審查修正一個統計性 bug**：原本「隨機重試4次（可重複取樣）」在 doorCount=2/3 時約 20% 機率漏掉本可成立的門配置，已改為窮舉所有組合（最多3種）後才 fallback。無效輸入拋 `INVALID_DOOR_COUNT`/`INVALID_ENTRY_SIDE`/`INVALID_NEIGHBOR_REQUIREMENT_FN`/`INVALID_NEIGHBOR_REQUIREMENT_VALUE`
    - [server/src/game/boardGenerator.js](server/src/game/boardGenerator.js)：`coordKey(x,y)`、`createBoard(startingRooms)`、`placeNewRoom(board, floor, fromCoord, direction, roomDefinition)`。無效輸入拋 `INVALID_ROOM_DOORS`/`ROOM_ALREADY_PLACED`/`INVALID_DIRECTION`/`INVALID_FLOOR`/`INVALID_ROOM_ID`/`INVALID_FROM_COORD`/`MISSING_STARTING_ROOM`
    - [server/src/game/playerEntity.js](server/src/game/playerEntity.js)：`STATS`、`createPlayer({...})`、`changeStat(player, stat, delta, hauntStarted)`（正值累加溢出、負值優先扣溢出、邪祟前不死下限）、`resetActionPoints(player)`、`movePlayerTo(player, floor, x, y)`。無效輸入拋 `UNKNOWN_STAT`/`INVALID_STAT_DELTA`/`INVALID_HAUNT_FLAG`/`MISSING_STAT_DEFINITION`
    - [server/src/game/gameState.js](server/src/game/gameState.js)：`createGameState(startingRooms)`、`addPlayer(gameState, {...})`（固定放大門廳(0,0)）、`getPlayer(gameState, playerId)`。重複 `playerId` 拋 `DUPLICATE_PLAYER_ID`
    - Jest 70/70 全過（含 M1 既有 26 個）
    - **已知記錄但未在 M2a 處理的設計缺口（留給 M2b）**：`boardGenerator.js` 的 fallback 路徑（衝突時新房間放棄非入口側的門）會造成「單向門」——新房間認為那側是牆，但已放置的鄰居可能仍認為那側是門。M2a 本身不做移動/鄰接判定，這個不一致要在 M2b 設計移動邏輯時明確定義規則（例如：兩邊都要同意才算有門／或用其中一方為準）
  - **M2b：提問協定＋回合流程 —— 尚未撰寫**，是下一步要做的事
  - **M2c：卡牌牌庫＋效果解析器 —— 尚未撰寫**，依賴 M2b 完成後的實際程式介面
  - 已知範圍外事項：角色屬性實際數值（各角色力量/速度/知識/意志的起始值與上限）還沒蒐集，之後需要開發者提供實體角色卡內容，做法比照事件/道具/預兆卡
- **已評估過、不採用的外部資源**：`Claude-Code-Game-Studios`（GitHub: donchitos/claude-code-game-studios）——技術棧/規模都跟本專案不符，已確認不採用

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無設計層面阻塞。M2a 已完整合併進 `main`，`rooms.json` 的 `doors` 欄位已補齊（**這項標準檢查項目本次已達成，之後不需要再每階段開場提醒**）。唯一待決的設計問題是上面提到的「單向門」鄰接判定規則，需要在撰寫 M2b 計畫時跟開發者討論定案。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 只需讀 2026-08-02（今日）+ 2026-08-01（前一日）範圍
2. `data/rooms/rooms.json` 的 `doors` 欄位已確認填完，**不用再檢查提醒**（`description` 欄位原本就不用提醒）
3. **撰寫 M2b（提問協定＋回合流程）詳細實作計畫**：
   - 必須先讀 M2a 實際完成的程式碼（`server/src/game/gameState.js`/`playerEntity.js`/`boardGenerator.js`/`doorLayout.js`/`contentLoader.js`）取得真實函式簽名與已定案的自訂錯誤代碼，不要用計畫文件裡假設的介面
   - 撰寫前要跟開發者討論定案「單向門」的鄰接判定規則（見上方已知設計缺口）
   - 計畫確認後，比照 M2a 的做法：`using-git-worktrees` 建獨立 worktree → `subagent-driven-development` 逐任務執行 → 最終整分支審查 → 合併回 `main`

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；純 JavaScript，不使用 TypeScript；單一程式碼庫同時支援區網與雲端部署
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**
- **內容擴充架構**：房間/卡牌效果採宣告式資料驅動；鬼屋劇本與角色能力透過「劇本模組」/「角色模組」外掛介面擴充（`manifest.json` + `logic.js` 掛勾函式），詳見 spec 第 4、8、9 節
- **輸入驗證慣例（M2a 確立，M2b/M2c 沿用）**：所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串，不可靜默失敗或回傳 `undefined`；這條規則優先於計畫文件裡附的參考程式碼——如果計畫程式碼本身沒做到，以這條規則為準直接補上，不需要每次都重新跟開發者確認（第一次已由開發者在 M2a Task 1 明確裁定）
- **MVP 兩個劇本**：劇本1〈神鬼痴漢 The Mummy Walks〉、劇本10〈闔家團圓 Family Gathering〉
- **未來階段**：Phase 2 為 AI 玩家（呼叫 Claude API 決策）；Phase 3+ 為原創劇本（兇案解謎/密室逃脫主題），**且需要把 M2 的地下室簡化、內容抽取範圍縮減都復原成完整版**
- **PDF 內容抽取**：用 `pymupdf`（`import fitz`），不要用 `pypdf`（會產生亂碼）。抽取結果不進版控，只有結構化 JSON 遊戲資料（`data/` 資料夾）才進版控
- **版權**：規則書/卡牌內容屬 Hasbro/Avalon Hill 版權，僅供私人非商業用途，PDF 原檔已列入 `.gitignore`
- **語言偏好**：與開發者對話一律使用繁體中文
- **Worktree 慣例**：`subagent-driven-development` 執行每個里程碑（M1、M2a...）都應該開獨立 worktree/分支，完成後合併回 `main`；`main` 分支保持乾淨可執行
- **資料檔案編輯注意事項**：開發者有時會直接編輯工作目錄裡的 `data/` 檔案而不透過 git commit（本次階段就發生過，`rooms.json` 的 doors 填寫在 worktree 合併後才發現是未提交狀態）——如果在 worktree 外的主目錄工作，記得檢查 `git status` 是否有未提交的內容資料變更，跟功能程式碼分開單獨 commit
- **收工流程**：每階段收工前需生成/更新 worklog、chatlog、Handover，並推送至 GitHub repo；需確認本次 session 自行啟動的本機伺服器已關閉——**本階段未啟動任何伺服器，無需處理**
