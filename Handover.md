# 交接文檔 Handover

最後更新：2026-08-02（第 2 次工作階段）

## 專案目標 (Project Goal)
將實體桌遊「山中小屋」(Betrayal at House on the Hill) 移植為可供多位使用者同時連線遊玩的網頁遊戲，兼具技術學習與朋友圈實際遊玩用途，並保留未來擴充原創劇本與 AI 玩家的彈性。

## 已完成進度 (Completed)
- 設計文件、MVP 里程碑拆分（M1-M4）、選定的兩個原版劇本，皆已確認（[spec 文件](docs/superpowers/specs/2026-07-31-web-multiplayer-design.md)）
- **M1（伺服器與大廳骨架）已全部完成並合併進 `main`**：[docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md](docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md)（PR [#1](https://github.com/jamessun0919-ops/Betrayal-at-House-on-the-Hill/pull/1)，已 merge）
- **M2（探索引擎）內容範圍已確認**：M2/M3 邊界＝M2 房間拼圖/移動/屬性/卡片抽取/預兆計數，M3 鬼屋降臨＋劇本外掛＋劇本1/10；地下室簡化（測試版不含，完整版需復原）；內容資料已全部由開發者填完（[data/rooms/rooms.json](data/rooms/rooms.json) 31筆含 `doors`、[data/cards/](data/cards/) 三類卡片）；兩份核心設計參考文件（[card-mechanics-reference.md](docs/superpowers/specs/2026-08-01-card-mechanics-reference.md)、[turn-flow-and-action-points.md](docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md)）
- **M2 拆成三個子計畫依序執行**（M2a/M2b/M2c，是 M2 內部分階段）：
  - **M2a：遊戲核心狀態＋房間版圖系統 —— 已完成並合併進 `main`**（commit range `fa7f493..559884d`）。5 個模組：`contentLoader.js`、`doorLayout.js`（含窮舉搜尋修正）、`boardGenerator.js`、`playerEntity.js`（**本次階段已改寫為刻度制，見下方**）、`gameState.js`。Jest 全過
  - **M2b：提問協定＋回合流程 —— 設計文件已完成並提交，實作拆成 M2b-1/M2b-2 兩份計畫**：
    - 設計文件：[docs/superpowers/specs/2026-08-02-m2b-turn-flow-design.md](docs/superpowers/specs/2026-08-02-m2b-turn-flow-design.md)
    - **M2b-1（核心邏輯模組）計畫已寫完並自我審查，尚未執行**：[docs/superpowers/plans/2026-08-02-m2b1-core-game-logic.md](docs/superpowers/plans/2026-08-02-m2b1-core-game-logic.md)，8 個任務：`contentLoader.loadCharacters`、`roomDeck.js`（房間磚牌庫）、`boardGenerator.canMoveBetween`（移動鄰接判定）、`gameState` 擴充（房間磚牌庫＋序列化＋回合順序欄位）、`promptState.js`（提問狀態機）、`characterSelection.js`（選角色狀態機）、`gameManager.js`（`roomCode -> gameState` 生命週期＋生成回合順序）、`turnFlow.js`（移動/開門/行動力記帳/回合順序推進）。**開發者已選定 Subagent-Driven 執行，本階段尚未開始執行**
    - **M2b-2（Socket.IO 事件層整合＋除錯用測試頁面）尚未撰寫**，要等 M2b-1 完成、以其實際程式碼介面為基礎才能寫
  - **M2c：卡牌牌庫＋效果解析器 —— 尚未撰寫**
- **本次階段（2026-08-02 第 2 次）重大設計修正：角色屬性改為刻度制**
  - 發現實體遊戲的角色屬性不是連續整數（線性 current/max），而是**一整排可能重複的刻度數值**（例如力量 `3 3 4 5 6 6 7 7 7 8`），玩家目前位置是**索引**，上升/下降一級＝索引加減 1，數值可能因為刻度重複而不變
  - `server/src/game/playerEntity.js` 已回頭改寫：`player.stats[stat] = { track, currentIndex, baseIndex, skullIndex, overflow }`；`changeStat(player, stat, delta, hauntStarted)` 的 `delta` 現在是「移動幾格索引」不是「加減多少數值」；新增 `getStatValue(player, stat)`（讀目前刻度對應的數值＋overflow）、`isBelowBase(player, stat)`（給藥膏/嗅鹽這類「低於基本值」卡片效果判斷用，比較 `currentIndex < baseIndex`）
  - `baseIndex` 是角色卡上標示的固定起始位置，**遊戲過程中永遠不變**（跟會變動的 `currentIndex`是兩個獨立欄位），不能只在建立玩家時用一次就丟
  - `createPlayer` 會檢查 `track` 陣列必須「由小到大或相等」（非嚴格遞增），不符合直接拋 `INVALID_STAT_TRACK`
  - 這個改動已通過測試（`server/test/game/playerEntity.test.js`、`gameState.test.js` 同步更新）並提交
- **新增 `data/characters/` 角色資料範本**：[characters.json](data/characters/characters.json)（6 個佔位角色位置，對應遊戲畫面預留的選角色格數）＋ [README](data/characters/README.md)（欄位格式：`id`/`codename`/`gender`/`age`/`occupation`/`stats`，`stats` 四項各含 `track`/`baseIndex`/`skullIndex`）。**目前全部是空白佔位資料**，開發者會陸續對照實體角色卡填寫；填之前 M2b/M2c 開發測試都用假數值跑，不受影響
- **M2b 設計要點**（完整內容見設計文件，這裡列關鍵決定）：
  - **移動鄰接判定（AND 邏輯）**：兩間已探索房間之間能不能通行，出發房間跟目的地房間都要在共用邊列出門，兩邊都同意才算通行；已放置房間的 `doorSides` 資料不會因此被竄改，純粹是判定邏輯
  - **遊戲狀態存放架構**：新增 `GameManager`（跟 `LobbyManager` 平行），管 `roomCode -> gameState`
  - **選角色流程**：房主人數足夠（≥2）觸發；隨機順序（跟回合順序分開各自骰）；30秒逾時覆寫（標準是20秒）；逾時隨機指定；確認才鎖定角色（不即時預覽鎖定）；所有玩家隨時可瀏覽全部角色資訊
  - **房間磚牌庫歸屬 M2b**（不是留給 M2c）：`rooms.json` 洗牌後依序抽、抽過不重抽
  - **房間磚牌庫抽完後的規則（已定案）**：開門選項直接從可選動作清單消失，所有連接未探索座標的門視為牆，遊戲用現有版圖繼續進行到結束，不報錯不卡住
  - **Phase 2 AI 玩家的預留設計（僅記錄，M2b 不實作）**：AI 選角色順序排在真人玩家之後；回合行動順序仍完全隨機（不因真人/AI 而不同）；AI 玩家數量不可超過真人玩家數量（維持遊戲的社交合作定位，避免變成單機遊戲）
  - **實測時機**：M2b-1 只有 Jest 測試；M2b-2 計畫最後會加一個簡易除錯用測試頁面（按鈕觸發事件+看JSON回傳，非正式美術），讓開發者能在正式遊戲介面完成前就實際點選驗證流程
- **已評估過、不採用的外部資源**：`Claude-Code-Game-Studios`——技術棧/規模都跟本專案不符，已確認不採用

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無設計層面阻塞。M2b-1 計畫已寫完、自我審查過，**尚未開始執行**（開發者已選定 Subagent-Driven，本階段先收工）。`data/rooms/rooms.json` 的 `doors` 欄位已確認填完，不用再檢查提醒。`data/characters/characters.json` 仍是 6 個佔位角色，等開發者填寫，不影響開發進度。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 只需讀 2026-08-02（今日，含第1、2次階段）+ 2026-08-01（前一日）範圍
2. **用 `subagent-driven-development` skill 執行 [M2b-1 計畫](docs/superpowers/plans/2026-08-02-m2b1-core-game-logic.md)**（開發者已選定此方式）：
   - 先用 `using-git-worktrees` skill 建獨立 worktree（跟 M1/M2a 一樣的流程），不要直接在 `main` 上動工
   - 8 個任務跑完、通過 final review、合併回 `main` 後，才開始撰寫 **M2b-2**（Socket.IO 事件層整合＋除錯用測試頁面）的詳細實作計畫，要以 M2b-1 實際完成的程式碼介面（`gameManager`/`promptState`/`characterSelection`/`turnFlow`/`gameState` 的實際函式簽名）為基礎延伸，不要用計畫文件裡假設的介面
3. M2b-2 完成、合併後，才開始 M2c（卡牌牌庫＋效果解析器）的設計與計畫

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；純 JavaScript，不使用 TypeScript；單一程式碼庫同時支援區網與雲端部署
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**
- **內容擴充架構**：房間/卡牌效果採宣告式資料驅動；鬼屋劇本與角色能力透過「劇本模組」/「角色模組」外掛介面擴充，詳見 spec 第 4、8、9 節
- **輸入驗證慣例（M2a 確立，M2b/M2c 沿用）**：所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串，不可靜默失敗或回傳 `undefined`；這條規則優先於計畫文件裡附的參考程式碼，不需要每次都重新跟開發者確認
- **角色屬性是刻度制，不是連續整數**（本次階段確立，見上方）：`track`/`currentIndex`/`baseIndex`/`skullIndex`，之後任何觸碰玩家屬性的程式碼（M2c 卡片效果、M3 戰鬥）都要延用這個模型，UI 呈現要用長條圖+刻度，不能簡化成單一數字
- **MVP 兩個劇本**：劇本1〈神鬼痴漢 The Mummy Walks〉、劇本10〈闔家團圓 Family Gathering〉
- **未來階段**：Phase 2 為 AI 玩家（呼叫 Claude API 決策，選角色順序排真人之後、數量不可超過真人數量——見上方備註）；Phase 3+ 為原創劇本，且需要把 M2 的地下室簡化、內容抽取範圍縮減都復原成完整版
- **PDF 內容抽取**：用 `pymupdf`（`import fitz`），不要用 `pypdf`。抽取結果不進版控，只有結構化 JSON 遊戲資料（`data/` 資料夾）才進版控
- **版權**：規則書/卡牌內容屬 Hasbro/Avalon Hill 版權，僅供私人非商業用途，PDF 原檔已列入 `.gitignore`
- **語言偏好**：與開發者對話一律使用繁體中文
- **Worktree 慣例**：`subagent-driven-development` 執行每個里程碑（M1、M2a、M2b-1...）都應該開獨立 worktree/分支，完成後合併回 `main`；`main` 分支保持乾淨可執行
- **資料檔案編輯注意事項**：開發者有時會直接編輯工作目錄裡的 `data/` 檔案而不透過 git commit——如果在 worktree 外的主目錄工作，記得檢查 `git status` 是否有未提交的內容資料變更，跟功能程式碼分開單獨 commit
- **大型計畫拆分**：單一里程碑若預估任務數明顯超過前一個里程碑（例如 M2a 5個任務，M2b 若整份會到10個），要主動跟開發者確認是否拆成多份計畫（例如 M2b-1 純邏輯 + M2b-2 Socket.IO整合），拆分後的後續計畫要等前一份完成、以其實際程式碼介面為基礎撰寫
- **收工流程**：每階段收工前需生成/更新 worklog、chatlog、Handover，並推送至 GitHub repo；chatlog 同一天多次工作階段要併在同一個日期檔案裡（用「## 第 N 次工作階段」分節，段落用三級標題），不要另開新檔；需確認本次 session 自行啟動的本機伺服器已關閉——**本階段未啟動任何伺服器，無需處理**
