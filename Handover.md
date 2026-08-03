# 交接文檔 Handover

最後更新：2026-08-03（第 1 次工作階段）

## 專案目標 (Project Goal)
將實體桌遊「山中小屋」(Betrayal at House on the Hill) 移植為可供多位使用者同時連線遊玩的網頁遊戲，兼具技術學習與朋友圈實際遊玩用途，並保留未來擴充原創劇本與 AI 玩家的彈性。

## 已完成進度 (Completed)
- 設計文件、MVP 里程碑拆分（M1-M4）、選定的兩個原版劇本，皆已確認（[spec 文件](docs/superpowers/specs/2026-07-31-web-multiplayer-design.md)）
- **M1（伺服器與大廳骨架）已全部完成並合併進 `main`**：[docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md](docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md)（PR [#1](https://github.com/jamessun0919-ops/Betrayal-at-House-on-the-Hill/pull/1)，已 merge）
- **M2（探索引擎）內容範圍已確認**：M2/M3 邊界＝M2 房間拼圖/移動/屬性/卡片抽取/預兆計數，M3 鬼屋降臨＋劇本外掛＋劇本1/10；內容資料已全部由開發者填完（[data/rooms/rooms.json](data/rooms/rooms.json) 31筆含 `doors`、[data/cards/](data/cards/) 三類卡片）；兩份核心設計參考文件（[card-mechanics-reference.md](docs/superpowers/specs/2026-08-01-card-mechanics-reference.md)、[turn-flow-and-action-points.md](docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md)）
- **M2 拆成三個子計畫依序執行**（M2a/M2b/M2c，是 M2 內部分階段）：
  - **M2a：遊戲核心狀態＋房間版圖系統 —— 已完成並合併進 `main`**（commit range `fa7f493..559884d`）：`contentLoader.js`、`doorLayout.js`、`boardGenerator.js`、`playerEntity.js`（刻度制屬性）、`gameState.js`
  - **M2b：提問協定＋回合流程 —— 拆成 M2b-1/M2b-2 兩份計畫**：
    - 設計文件：[docs/superpowers/specs/2026-08-02-m2b-turn-flow-design.md](docs/superpowers/specs/2026-08-02-m2b-turn-flow-design.md)
    - **M2b-1（核心邏輯模組）已完成並合併進 `main`**（commit range `2aa45df..0dd7b22`）：[docs/superpowers/plans/2026-08-02-m2b1-core-game-logic.md](docs/superpowers/plans/2026-08-02-m2b1-core-game-logic.md)，8 個任務全數完成，用 `subagent-driven-development` 執行：
      - `server/src/game/contentLoader.js`：新增 `loadCharacters()`；錯誤代碼 `ROOM_DATA_LOAD_FAILED` 改名 `CONTENT_DATA_LOAD_FAILED`
      - `server/src/game/roomDeck.js`（新）：房間磚牌庫，**樓層感知**——`drawRoom(deck, floor)`，抽到不符樓層的房間放回牌庫最底重抽（不是分兩副牌庫），`hasRoomForFloor(deck, floor)` 唯讀查詢；`INVALID_ROOM_LIST`/`INVALID_FLOOR`/`ROOM_DECK_EMPTY`
      - `server/src/game/boardGenerator.js`（擴充）：新增 `canMoveBetween(board, floor, fromCoord, direction)`——雙向門判定（出發房間跟目的地房間都要有門才算通行），匯出 `DIRECTION_DELTA`
      - `server/src/game/gameState.js`（擴充）：`createGameState(startingRooms, rooms)` 簽名變更（新增 `rooms` 參數建牌庫）；新增 `serializeGameState(gameState)`（Map轉陣列，供 Socket.IO 廣播；`roomDeck` 只暴露 `{remainingCount, isEmpty}`；`turnOrder`/`currentPlayerIndex` 未設定時安全回傳 `null`）
      - `server/src/game/promptState.js`（新）：單一待處理提問狀態機，`createPrompt`/`respondToPrompt`/`resolvePromptTimeout`/`getPendingPrompt`；純邏輯不含真實計時器（`now` 由呼叫端注入），逾時計時器由未來的 Socket.IO 層自己排程呼叫 `resolvePromptTimeout`
      - `server/src/game/characterSelection.js`（新）：選角色狀態機，隨機順序、確認才鎖定、`assignRandomCharacter`（逾時代選，含 turn ownership 檢查）
      - `server/src/game/gameManager.js`（新）：`roomCode -> gameState` 生命週期（`createGameManager`/`startGame`/`getGameState`/`endGame`），`startGame` 會依角色 ID 查表取得玩家屬性，並**獨立**產生一份跟選角色順序無關的隨機 `turnOrder`
      - `server/src/game/turnFlow.js`（新）：`getAvailableDirections`（列出可移動/可開門方向，牌庫抽完或該樓層無牌時開門選項自動消失）、`moveToRoom`（移動/開門，含 turn ownership 檢查，行動力/方向合法性檢查順序：先AP後方向）、`selectAction`（道具/襲擊/操作的殼子，扣行動力+回傳 `{kind, pending:true}`，實際效果留給 M2c/M3）、`canUseStairs`/`useStairs`（**樓梯移動是不耗行動力的免費動作**）、`getCurrentTurnPlayerId`/`advanceTurn`（**`advanceTurn` 會直接幫下一位玩家重設行動力**，這是唯一負責「回合開始行動力歸速度值」的地方）
      - Jest 全過（13 suites / 160 tests，含 M1/M2a 既有測試）
    - **M2b-2（Socket.IO 事件層整合＋除錯用測試頁面）尚未撰寫**，要等以 M2b-1 實際完成的程式碼介面為基礎才能寫
  - **M2c：卡牌牌庫＋效果解析器 —— 尚未撰寫**
- **角色資料範本**：[data/characters/characters.json](data/characters/characters.json)（6 個佔位角色位置）＋ [README](data/characters/README.md)，欄位含 `id`/`codename`/`gender`/`age`/`occupation`/`stats`（四項屬性各含 `track`/`baseIndex`/`skullIndex`，刻度制，非連續整數，開發者尚未填寫真實內容）
- **M2b-1 過程中發現、由開發者裁定的架構決策（重要，供 M2b-2 延續）**：
  - 樓層維度：單一房間磚牌庫，抽到跟目前樓層不符的房間**放回牌庫最底重抽**（不是拆成兩副牌庫）
  - 樓梯移動（梯廳↔二樓平台）是**不耗行動力的免費動作**，跟一般移動分開，不是 `getAvailableDirections` 清單裡的一個方向選項
  - 回合開始時的行動力重設**由 `advanceTurn` 直接負責**（不是另外一個 `startTurn` 函式）
  - `turnFlow` 的所有動作（移動/開門/選動作/樓梯）都要驗證 `getCurrentTurnPlayerId(gameState) === playerId`，不是自己輪到的玩家會被 `NOT_YOUR_TURN` 擋下
- **最終審查發現、留給 M2b-2 處理的架構問題（尚未解決）**：
  - **選角色階段的狀態沒有任何模組持有**：`gameManager` 只管已建立好的 `gameState`（選角色完成後才建立），但 `characterSelection` 的 state 與 `promptState` 的容器目前沒有地方存放——M2b-2 撰寫計畫時要先解決這個「選角色階段的容器放在哪裡」的架構問題
  - `serializeGameState` 目前不含待處理提問（pending prompt）資訊，M2b-2 廣播 `game:prompt` 時需要另外處理，或考慮擴充序列化函式
- **M2b 設計要點**（完整內容見設計文件）：移動鄰接判定（AND邏輯）、選角色流程（隨機順序/30秒逾時/確認才鎖定）、房間磚牌庫歸屬M2b、Phase 2 AI玩家的預留設計（選角色排真人之後、數量不可超過真人）、實測時機（M2b-2 最後加簡易除錯測試頁面）
- **已評估過、不採用的外部資源**：`Claude-Code-Game-Studios`——技術棧/規模都跟本專案不符，已確認不採用

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無設計層面阻塞。M2b-1 已完整合併進 `main`（160/160 測試通過）。`data/rooms/rooms.json` 的 `doors` 欄位已確認填完，不用再提醒。`data/characters/characters.json` 仍是 6 個佔位角色，等開發者填寫，不影響開發進度。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 只需讀 2026-08-03（今日）+ 2026-08-02（前一日，含當天兩次階段）範圍
2. **撰寫 M2b-2（Socket.IO 事件層整合＋除錯用測試頁面）詳細實作計畫**：
   - 必須先讀 M2b-1 實際完成的程式碼（`gameManager.js`/`promptState.js`/`characterSelection.js`/`turnFlow.js`/`roomDeck.js`/`gameState.js` 的實際函式簽名），不要用假設的介面
   - 撰寫前要先跟開發者討論解決「選角色階段狀態放哪裡」的架構問題（見上方「留給 M2b-2 處理的架構問題」）
   - 計畫確認後，比照 M2a/M2b-1 的做法：`using-git-worktrees` 建獨立 worktree → `subagent-driven-development` 逐任務執行 → 最終整分支審查 → 合併回 `main`
3. M2b-2 完成、合併後，才開始 M2c（卡牌牌庫＋效果解析器）的設計與計畫

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；純 JavaScript，不使用 TypeScript；單一程式碼庫同時支援區網與雲端部署
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**（本次階段 Task 8 實際發生過一次，agent 正確停下分析根因後才動手修正）
- **內容擴充架構**：房間/卡牌效果採宣告式資料驅動；鬼屋劇本與角色能力透過「劇本模組」/「角色模組」外掛介面擴充，詳見 spec 第 4、8、9 節
- **輸入驗證慣例（M2a 確立，M2b/M2c 沿用）**：所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串，不可靜默失敗或回傳 `undefined`；優先於計畫文件裡附的參考程式碼，不需要每次都重新跟開發者確認
- **角色屬性是刻度制，不是連續整數**：`track`/`currentIndex`/`baseIndex`/`skullIndex`，之後任何觸碰玩家屬性的程式碼（M2c 卡片效果、M3 戰鬥）都要延用這個模型，UI 呈現要用長條圖+刻度
- **回合機制關鍵慣例（M2b-1 確立）**：樓梯移動免費、`advanceTurn` 自動重設行動力、所有回合內動作都要驗證 turn ownership——這些不是計畫原本寫的，是最終審查發現缺口、開發者當場裁定補上的，M2b-2/M2c 接續開發時要延用
- **MVP 兩個劇本**：劇本1〈神鬼痴漢 The Mummy Walks〉、劇本10〈闔家團圓 Family Gathering〉
- **未來階段**：Phase 2 為 AI 玩家（呼叫 Claude API 決策，選角色順序排真人之後、數量不可超過真人數量）；Phase 3+ 為原創劇本，且需要把 M2 的地下室簡化、內容抽取範圍縮減都復原成完整版
- **PDF 內容抽取**：用 `pymupdf`（`import fitz`），不要用 `pypdf`。抽取結果不進版控，只有結構化 JSON 遊戲資料（`data/` 資料夾）才進版控
- **版權**：規則書/卡牌內容屬 Hasbro/Avalon Hill 版權，僅供私人非商業用途，PDF 原檔已列入 `.gitignore`
- **語言偏好**：與開發者對話一律使用繁體中文
- **Worktree 慣例**：`subagent-driven-development` 執行每個里程碑（M1、M2a、M2b-1...）都應該開獨立 worktree/分支，完成後合併回 `main`；`main` 分支保持乾淨可執行
- **資料檔案編輯注意事項**：開發者有時會直接編輯工作目錄裡的 `data/` 檔案而不透過 git commit——如果在 worktree 外的主目錄工作，記得檢查 `git status` 是否有未提交的內容資料變更，跟功能程式碼分開單獨 commit
- **大型計畫拆分**：單一里程碑若預估任務數明顯超過前一個里程碑，要主動跟開發者確認是否拆成多份計畫，拆分後的後續計畫要等前一份完成、以其實際程式碼介面為基礎撰寫
- **最終審查發現「計畫本身的架構缺口」時的處理方式（本次階段的實際案例）**：如果缺口只是輸入驗證/防呆類（有明確既有慣例可套用），可以直接排進修正輪不用問；但如果缺口牽涉新的遊戲規則設計（本次是樓層機制、行動力重設歸屬），必須先跟開發者確認設計方向，不能自己決定
- **收工流程**：每階段收工前需生成/更新 worklog、chatlog、Handover，並推送至 GitHub repo；chatlog 同一天多次工作階段要併在同一個日期檔案裡（用「## 第 N 次工作階段」分節，段落用三級標題），不同天則各自開新檔；需確認本次 session 自行啟動的本機伺服器已關閉——**本階段未啟動任何伺服器，無需處理**
