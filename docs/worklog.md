# 工作日誌 Worklog

## 2026-07-31 第 1 次工作階段

**當日工作內容**：
- 使用 `brainstorming` skill 討論將實體桌遊「山中小屋」移植為網頁多人連線遊戲的架構
- 釐清使用情境（學習專案＋朋友圈使用、新手＋Claude Code 協作、區網與外網都要支援、簡極文字介面）
- 討論並確認技術架構：Node.js + Socket.IO + React，伺服器為權威遊戲狀態來源
- 討論擴充性需求：劇本/角色外掛系統（供未來 AI 玩家與原創劇本擴充），確認 MVP 範圍為探索引擎＋1-2 個原版劇本
- 撰寫設計 spec 文件並完成自我檢查
- 初始化 git repo、設定 `.gitignore`（排除規則書 PDF）
- 安裝 GitHub CLI 並完成帳號授權登入
- 設定遠端倉庫並推送初始 commit

**完成項目**：
- [docs/superpowers/specs/2026-07-31-web-multiplayer-design.md](superpowers/specs/2026-07-31-web-multiplayer-design.md) 設計文件（開發者已確認）
- Git repo 初始化並成功推送至 GitHub private repo（jamessun0919-ops/Betrayal-at-House-on-the-Hill，main 分支）

**遇到瓶頸**：
- 首次 `git push` 因 private repo 缺少驗證而失敗（連線被重置，非網路不通）。原因：本機未安裝/登入 GitHub 相關驗證工具。解法：安裝 GitHub CLI (`gh`)，以 OAuth 裝置授權流程登入，並執行 `gh auth setup-git` 讓 git 憑證整合後成功推送。

**開發者交代備忘事項**：
- 下一階段工作：呼叫 `writing-plans` skill，把設計 spec 轉為具體、分階段的實作計畫

## 2026-07-31 第 2 次工作階段

**當日工作內容**：
- 讀取 Handover 與 worklog，確認接續上次進度
- 呼叫 `writing-plans` skill，討論 MVP 執行拆分方式，開發者同意拆成 M1-M4 里程碑計畫
- 安裝 `pypdf`/`pdfplumber` 嘗試抽取規則書/生存者手冊/叛徒手冊 PDF 文字，發現亂碼（字型編碼問題）；改用 `pymupdf` 成功正確抽取繁中文字
- 比較數個劇本複雜度（叛徒判定簡單度、是否有計時器/人數分支/怪物AI複雜度），提出兩個候選劇本，開發者確認採用：劇本1〈神鬼痴漢〉、劇本10〈闔家團圓〉
- 撰寫 M1（伺服器與大廳骨架）詳細實作計畫並完成自我審查
- 開發者選定執行方式為 Subagent-Driven-Development，但本階段先收工，執行留待下次

**完成項目**：
- [docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md](superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md) M1 實作計畫（開發者已過目）
- 確定 MVP 兩個劇本內容（詳見 Handover.md）

**遇到瓶頸**：
- `pypdf` 抽取此規則書 PDF 文字為亂碼，改用 `pymupdf` 解決（詳見 Handover.md「PDF 內容抽取注意事項」）

**開發者交代備忘事項**：
- 下一階段工作：呼叫 `subagent-driven-development` skill，依 M1 計畫逐任務執行
