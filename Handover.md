# 交接文檔 Handover

最後更新：2026-07-31（第 3 次工作階段）

## 專案目標 (Project Goal)
將實體桌遊「山中小屋」(Betrayal at House on the Hill) 移植為可供多位使用者同時連線遊玩的網頁遊戲，兼具技術學習與朋友圈實際遊玩用途，並保留未來擴充原創劇本與 AI 玩家的彈性。

## 已完成進度 (Completed)
- 設計文件、MVP 里程碑拆分（M1-M4）、選定的兩個原版劇本，皆已確認（詳見下方「關鍵設定」與 [spec 文件](docs/superpowers/specs/2026-07-31-web-multiplayer-design.md)）
- M1 實作計畫：[docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md](docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md)
- **M1 Task 1-4 已用 `subagent-driven-development` 完成並通過 review**，程式碼在獨立 worktree／分支上（尚未合併回 main）：
  - Task 1：伺服器骨架＋`/health` 健康檢查（review clean）
  - Task 2：`LobbyManager` 核心邏輯（review clean）
  - Task 3：Socket.IO 事件層＋整合測試（review clean；implementer 發現並修正計畫裡測試程式碼的一個競態條件，reviewer 已獨立驗證這是正確修正）
  - Task 4：伺服器進入點串接＋React 大廳畫面（1 輪修正：join 失敗時原本顯示英文 `ROOM_NOT_FOUND`，已改為繁體中文訊息；手動瀏覽器驗證兩分頁互見/斷線更新皆正常）
- 修正兩個 `.gitignore` 疏漏：worktree 內加了 `node_modules/`（原本會被誤 commit），main 分支加了 `.claude/`（harness 本機狀態，含 `settings.local.json` 與 worktree 內容，不應進版控）

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無阻塞。M1 還剩 **Task 5**（正式環境靜態檔案伺服＋區網啟動說明）尚未執行，之後還要跑完整分支的 final review 才算 M1 全部完成。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 只需讀 2026-07-31 當天範圍
2. **繼續在同一個 worktree 執行**（不要重新開一個）：路徑 `C:\Users\User\Desktop\Betrayal at House on the Hill\.claude\worktrees\m1-server-lobby-skeleton`，分支 `worktree-m1-server-lobby-skeleton`（已推送到 GitHub 備份）。用 `EnterWorktree` 搭配 `path` 參數切入（不要用 `name`，那會建立新的）
3. SDD ledger 已存在：`.superpowers/sdd/2026-07-31-m1-server-lobby-skeleton/progress.md`（在 worktree 內）——`subagent-driven-development` skill 會自動讀取並知道 Task 1-4 已完成，直接從 Task 5 繼續，不要重新派工 Task 1-4
4. Task 5 做完後，依 skill 流程跑「Final Review」（whole-branch review），乾淨後用 `superpowers:finishing-a-development-branch` 決定如何合併回 main
5. M1 全部完成並合併後，才開始撰寫 M2（探索引擎）的詳細實作計畫——M2 計畫需以 M1 實際完成的程式碼介面為基礎延伸

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；純 JavaScript，不使用 TypeScript；單一程式碼庫同時支援區網與雲端部署
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**
- **內容擴充架構**：房間/卡牌效果採宣告式資料驅動；鬼屋劇本與角色能力透過「劇本模組」/「角色模組」外掛介面擴充（`manifest.json` + `logic.js` 掛勾函式），詳見 spec 第 4、8、9 節
- **MVP 兩個劇本**：劇本1〈神鬼痴漢 The Mummy Walks〉、劇本10〈闔家團圓 Family Gathering〉（細節見 spec 討論脈絡／[chatlog 段落17](docs/chatlog/2026-07-31.md)）
- **未來階段**：Phase 2 為 AI 玩家（呼叫 Claude API 決策）；Phase 3+ 為原創劇本（兇案解謎/密室逃脫主題）
- **PDF 內容抽取**：用 `pymupdf`（`import fitz`），不要用 `pypdf`（會產生亂碼）。抽取結果不進版控，只有結構化 JSON 遊戲資料才進版控
- **版權**：規則書/卡牌內容屬 Hasbro/Avalon Hill 版權，僅供私人非商業用途，PDF 原檔已列入 `.gitignore`
- **語言偏好**：與開發者對話一律使用繁體中文
- **Worktree 使用中**：M1 的實作工作在獨立 worktree/分支進行，**main 分支保持乾淨**（只放 spec、plan、Handover、worklog、chatlog 這類文件）；`.claude/` 已加入 main 的 `.gitignore`（本機 harness 狀態不進版控）
- **收工流程**：每階段收工前需生成/更新 worklog、chatlog、Handover，並推送至 GitHub repo（main 分支＋當次 worktree 分支都要推）；需確認本次 session 自行啟動的本機伺服器已關閉——**本階段有兩個殘留 jest/node process（實際上是本次 session 自己 Task 3 測試留下的，implementer 誤判為無關，已由我確認並關閉），目前無殘留伺服器**
