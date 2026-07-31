# 交接文檔 Handover

最後更新：2026-07-31（第 2 次工作階段）

## 專案目標 (Project Goal)
將實體桌遊「山中小屋」(Betrayal at House on the Hill) 移植為可供多位使用者同時連線遊玩的網頁遊戲，兼具技術學習與朋友圈實際遊玩用途，並保留未來擴充原創劇本與 AI 玩家的彈性。

## 已完成進度 (Completed)
- 完成需求釐清與架構討論，設計文件已確認：[docs/superpowers/specs/2026-07-31-web-multiplayer-design.md](docs/superpowers/specs/2026-07-31-web-multiplayer-design.md)
- Git repo 設定完成並推送至 GitHub private repo：https://github.com/jamessun0919-ops/Betrayal-at-House-on-the-Hill （main 分支）
- 確認 MVP 執行方式：拆成依序執行的里程碑計畫（M1 伺服器與大廳骨架 → M2 探索引擎 → M3 鬼屋降臨與劇本外掛 → M4 開發者劇本輸入工具），開發者已同意此拆分
- 讀取規則書/生存者手冊/叛徒手冊 PDF，選定 MVP 要實作的 2 個原版劇本（開發者已確認採用）：
  - **劇本 1〈神鬼痴漢 The Mummy Walks〉**：叛徒＝作祟揭露者，操控固定屬性木乃伊（速度3/力量8/神志5），生存者 3 步驟解謎（知識檢定找真名→學驅散咒語→神志攻擊擊敗），叛徒需集齊「女孩+戒指+聖符」3張詛咒牌帶回石棺
  - **劇本 10〈闔家團圓 Family Gathering〉**：叛徒＝作祟揭露者，叛徒角色死亡改為操控多隻殭屍（數量=玩家人數，簡單「追最近生存者」AI）+ 1隻有傷害計數器的瘋漢，生存者需把殭屍引誘進 5 個特定房間並知識檢定困住牠們
- 撰寫並完成自我審查的 M1 詳細實作計畫：[docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md](docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md)（5 個任務：伺服器骨架/健康檢查、LobbyManager、Socket.IO 事件層、React 大廳畫面、正式環境靜態檔案伺服+區網說明）
- 開發者已選定執行方式：**Subagent-Driven-Development**（尚未開始執行，留待下次階段）

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無阻塞。M1 計畫已寫完並經開發者過目，尚未開始實際執行任何任務。

## 下一步行動 (Next Steps)
1. 讀取本 Handover 文件；worklog 只需讀「首日（2026-07-31）」範圍即可（目前尚無更早紀錄）
2. 呼叫 `superpowers:subagent-driven-development` skill，依 [M1 計畫](docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md) 逐任務派 subagent 執行（Task 1→5，任務間停下來讓開發者 review）
3. M1 全部任務完成並驗收通過後，才開始撰寫 M2（探索引擎）的詳細實作計畫——M2 計畫需以 M1 實際完成的程式碼介面（`LobbyManager`、Socket 事件命名慣例）為基礎延伸，不要用假設性介面

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；**純 JavaScript，不使用 TypeScript**（新手可讀性優先）；單一程式碼庫同時支援區網與雲端部署
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**
- **內容擴充架構**：房間/卡牌效果採宣告式資料驅動；鬼屋劇本與角色能力透過「劇本模組」/「角色模組」外掛介面擴充（`manifest.json` + `logic.js` 掛勾函式），詳見 spec 第 4、8、9 節
- **MVP 範圍**：探索引擎（三層樓房間拼圖、屬性、事件/道具/預兆卡、預兆計數與鬼屋觸發）＋ 劇本 1、10（見上）；**不含** AI 玩家、其餘 48 個原版劇本、伺服器狀態持久化、帳號系統
- **未來階段**：Phase 2 為 AI 玩家（呼叫 Claude API 決策）；Phase 3+ 為原創劇本（兇案解謎/密室逃脫主題）
- **PDF 內容抽取注意事項**：這份規則書 PDF 用 `pypdf` 抽取文字會得到亂碼（字型編碼問題，非內容損毀），改用 `pymupdf`（`import fitz`，`page.get_text()`）可正確抽取繁中文字。若之後 M2/M3 需要再讀取 PDF 補充卡牌/房間/劇本細節，直接用 pymupdf，不要用 pypdf。抽取結果不要整份存進 git（版權考量），只有依 spec 第 8 節格式整理出的結構化遊戲資料（JSON）才進版控
- **版權**：規則書/卡牌內容屬 Hasbro/Avalon Hill 版權，僅供私人非商業用途（朋友圈遊玩），PDF 原檔已列入 `.gitignore` 不進版控
- **語言偏好**：與開發者對話一律使用繁體中文
- **收工流程**：每階段收工前需生成/更新 worklog、chatlog（逐段落即時寫入為佳）、Handover，並推送至 GitHub repo；需確認本次 session 自行啟動的本機伺服器已關閉——**本次 session 未啟動任何伺服器（只寫了計畫文件，尚未執行 npm start），無需處理**
