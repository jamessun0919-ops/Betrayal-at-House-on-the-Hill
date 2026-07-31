# 交接文檔 Handover

最後更新：2026-07-31（第 4 次工作階段）

## 專案目標 (Project Goal)
將實體桌遊「山中小屋」(Betrayal at House on the Hill) 移植為可供多位使用者同時連線遊玩的網頁遊戲，兼具技術學習與朋友圈實際遊玩用途，並保留未來擴充原創劇本與 AI 玩家的彈性。

## 已完成進度 (Completed)
- 設計文件、MVP 里程碑拆分（M1-M4）、選定的兩個原版劇本，皆已確認（[spec 文件](docs/superpowers/specs/2026-07-31-web-multiplayer-design.md)）
- **M1（伺服器與大廳骨架）已全部完成並合併進 `main`**：[docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md](docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md)（PR [#1](https://github.com/jamessun0919-ops/Betrayal-at-House-on-the-Hill/pull/1)，已 merge，功能分支已刪除）
  - 5 個任務全數完成並個別 review 通過：伺服器骨架、`LobbyManager`、Socket.IO 事件層、React 大廳畫面、正式環境靜態檔案伺服
  - **全分支 final review 抓到並修好 1 個 Critical bug**：任何格式錯誤的 `lobby:create`/`lobby:join`（缺 callback 或 payload 為 null）會讓整台伺服器 process 直接崩潰——已加上防呆＋try/catch 修正
  - 同時修好 3 個 Important 問題：重複 join/create 產生永久幽靈玩家/房間；斷線自動重連後畫面卡住無提示（現在會顯示繁中錯誤訊息）；伺服器未驗證暱稱（現在會 trim/檢查空字串/長度上限）
  - 目前程式碼在 `main` 分支：`server/`（Node.js+Express+Socket.IO）與 `client/`（React+Vite）
  - Jest 測試：26/26 通過（`cd server && npx jest`）
  - 已知非阻塞事項：`server/` 的 devDependency（Jest 依賴鏈上的 `brace-expansion`）有 npm audit 標示的 high severity 漏洞，但屬於測試工具鏈的間接依賴，不影響正式執行環境；`npm audit fix --force` 會降級 Jest 版本（breaking change），未處理，留給開發者決定是否要處理

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無阻塞。M1 完全結束（開發、review、合併皆完成）。下一步是規劃 M2。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 只需讀 2026-07-31 當天範圍
2. **開始 M2（探索引擎）**：先呼叫 `writing-plans` skill（或視情況先過一輪 `brainstorming` 確認細節），依照 spec 第 12 節 MVP 範圍撰寫 M2 詳細實作計畫——**計畫需以 M1 實際完成的程式碼介面為基礎延伸**，重點包含：
   - `LobbyManager` 現有方法（`createRoom`/`joinRoom`/`leaveRoom`/`getPlayers`/`findRoomByPlayerId`）
   - Socket.IO 事件命名慣例（`lobby:xxx` 前綴、`ack(callback)` 防呆模式、`socket.data.roomCode`/`socket.data.playerId` 儲存方式）——M2 新增的遊戲事件應該延用同一套防呆/驗證模式（final review 已明確指出這點該寫進 M2 的 Global Constraints）
   - `client/src/LobbyScreen.jsx` 既有的 `ERROR_MESSAGES`/`translateError` 繁中錯誤訊息機制——新錯誤碼應該擴充同一個 lookup，不要另建一套
3. M2 內容需要真實的房間/卡牌資料（劇本1〈神鬼痴漢〉、劇本10〈闔家團圓〉），規則書 PDF 已在本機，用 `pymupdf` 抽取（見下方注意事項）

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；純 JavaScript，不使用 TypeScript；單一程式碼庫同時支援區網與雲端部署
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**
- **內容擴充架構**：房間/卡牌效果採宣告式資料驅動；鬼屋劇本與角色能力透過「劇本模組」/「角色模組」外掛介面擴充（`manifest.json` + `logic.js` 掛勾函式），詳見 spec 第 4、8、9 節
- **MVP 兩個劇本**：劇本1〈神鬼痴漢 The Mummy Walks〉、劇本10〈闔家團圓 Family Gathering〉
- **未來階段**：Phase 2 為 AI 玩家（呼叫 Claude API 決策）；Phase 3+ 為原創劇本（兇案解謎/密室逃脫主題）
- **PDF 內容抽取**：用 `pymupdf`（`import fitz`），不要用 `pypdf`（會產生亂碼）。抽取結果不進版控，只有結構化 JSON 遊戲資料才進版控
- **版權**：規則書/卡牌內容屬 Hasbro/Avalon Hill 版權，僅供私人非商業用途，PDF 原檔已列入 `.gitignore`
- **語言偏好**：與開發者對話一律使用繁體中文
- **Worktree 慣例**：`subagent-driven-development` 執行每個里程碑（M1、M2...）都應該開獨立 worktree/分支，完成後開 PR 合併回 `main`；`main` 分支保持乾淨可執行
- **已評估過、不採用的外部資源**：`Claude-Code-Game-Studios`（GitHub: donchitos/claude-code-game-studios）——整包遊戲工作室範本，鎖定 Unity/Godot/Unreal 引擎、49 agent/73 指令，跟本專案的網頁技術棧不合、規模也對一個朋友圈練習專案過度工程，已跟開發者說明並確認不採用
- **收工流程**：每階段收工前需生成/更新 worklog、chatlog、Handover，並推送至 GitHub repo；需確認本次 session 自行啟動的本機伺服器已關閉——**本階段結束時無殘留伺服器**
