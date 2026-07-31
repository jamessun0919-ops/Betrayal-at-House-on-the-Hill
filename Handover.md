# 交接文檔 Handover

最後更新：2026-07-31（第 1 次工作階段）

## 專案目標 (Project Goal)
將實體桌遊「山中小屋」(Betrayal at House on the Hill) 移植為可供多位使用者同時連線遊玩的網頁遊戲，兼具技術學習與朋友圈實際遊玩用途，並保留未來擴充原創劇本與 AI 玩家的彈性。

## 已完成進度 (Completed)
- 完成需求釐清與架構討論（使用 `brainstorming` skill）
- 撰寫並經開發者確認的設計文件：[docs/superpowers/specs/2026-07-31-web-multiplayer-design.md](docs/superpowers/specs/2026-07-31-web-multiplayer-design.md)
- 初始化本地 git repo（原本非 git repo），建立 `.gitignore` 排除規則書 PDF（版權考量，僅本機保留供讀取整理）
- 安裝 GitHub CLI (`gh`)，完成 OAuth 裝置授權登入帳號 `jamessun0919-ops`
- 設定遠端倉庫並成功推送初始 commit：https://github.com/jamessun0919-ops/Betrayal-at-House-on-the-Hill （private repo，`main` 分支）

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無阻塞。設計階段已完成並經開發者確認，尚未進入實作計畫（`writing-plans`）階段。

## 下一步行動 (Next Steps)
1. 讀取本 Handover 文件（本次即為首次工作階段，無需另外搜尋 worklog 舊段落）
2. 開發者已指定：**下一階段工作 = 呼叫 `writing-plans` skill，將設計 spec 轉為具體、分階段的實作計畫**
3. 實作計畫應以 spec 第 12 節「MVP 範圍」為邊界，不擴大範圍

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；單一程式碼庫同時支援區網與雲端部署，差異僅在部署方式
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**
- **內容擴充架構**：房間/卡牌效果採宣告式資料驅動；鬼屋劇本與角色能力透過「劇本模組」/「角色模組」外掛介面擴充（`manifest.json` + `logic.js` 掛勾函式），詳見 spec 第 4、8、9 節
- **MVP 範圍**：探索引擎（三層樓房間拼圖、屬性、事件/道具/預兆卡、預兆計數與鬼屋觸發）＋ 1-2 個完整原版劇本；**不含** AI 玩家、其餘 48+ 原版劇本、伺服器狀態持久化、帳號系統
- **未來階段**：Phase 2 為 AI 玩家（呼叫 Claude API 決策，依賴 MVP 已建立的玩家操作函式抽象）；Phase 3+ 為原創劇本（兇案解謎/密室逃脫主題，沿用同一套外掛系統）
- **版權**：規則書/卡牌內容屬 Hasbro/Avalon Hill 版權，僅供私人非商業用途（朋友圈遊玩），PDF 原檔已列入 `.gitignore` 不進版控
- **語言偏好**：與開發者對話一律使用繁體中文
- **收工流程**：每階段收工前需生成/更新 worklog、chatlog（逐段落即時寫入為佳）、Handover，並推送至 GitHub repo（已設定完成，之後可直接 `git push`）；需確認本次 session 自行啟動的本機伺服器已關閉——**本次 session 未啟動任何伺服器，無需處理**
