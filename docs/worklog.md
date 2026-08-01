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

## 2026-07-31 第 3 次工作階段

**當日工作內容**：
- 讀取 Handover，呼叫 `subagent-driven-development` skill 執行 M1 計畫
- 建立獨立 worktree（分支 `worktree-m1-server-lobby-skeleton`），依序派 subagent 執行並 review Task 1-4：伺服器骨架、LobbyManager、Socket.IO 事件層、React 大廳畫面
- Task 3 review 時發現 implementer 修正了計畫測試程式碼裡的一個競態條件（已驗證是正確修正，非隨意試錯）
- Task 4 review 發現 1 個 Important 問題（錯誤訊息顯示英文而非繁中，違反規則），跑完一輪修正並通過 re-review
- 修正兩處 `.gitignore` 疏漏：worktree 內漏了 `node_modules/`，main 分支漏了 `.claude/`
- 發現並關閉兩個殘留 jest/node process（來自本次 session 的 Task 3 測試，implementer 誤判為無關）
- 依開發者指示，Task 5 與 M1 最終驗收留到下一階段，本階段先收工

**完成項目**：
- M1 Task 1-4 實作完成並 review 通過（程式碼在 worktree/分支上，未合併回 main）
- Worktree 分支已推送至 GitHub 備份

**遇到瓶頸**：
- 無重大瓶頸；Task 4 的錯誤訊息語言問題已透過 fix loop 解決

**開發者交代備忘事項**：
- 下一階段工作：進入同一個 worktree（`.claude/worktrees/m1-server-lobby-skeleton`，分支 `worktree-m1-server-lobby-skeleton`），從 Task 5 繼續 `subagent-driven-development`，完成後跑 final review 並用 `finishing-a-development-branch` 決定合併方式

## 2026-07-31 第 4 次工作階段

**當日工作內容**：
- 讀取 Handover，開發者要求先評估外部資源 `Claude-Code-Game-Studios`（遊戲開發工作室範本）是否對本專案有幫助，查看後判斷不適合採用（技術棧不符、規模過度工程），已跟開發者說明並確認
- 繼續執行 M1 Task 5（正式環境靜態檔案伺服＋區網說明），一輪修正（`client/dist/` 補 `.gitignore`）後 review 通過
- 跑全分支 final review：抓到 1 個 Critical bug（格式錯誤的 socket 事件會讓伺服器整個崩潰）與 3 個 Important 問題（幽靈玩家/房間、斷線無提示、暱稱未驗證），一次性修正並通過 scoped re-review
- 用 `finishing-a-development-branch` skill 收尾：開發者選擇「push + 建立 PR」，建立 [PR #1](https://github.com/jamessun0919-ops/Betrayal-at-House-on-the-Hill/pull/1)
- 開發者確認後將 PR merge 進 `main`（merge 時遇到 `.gitignore` 小衝突，已解決），刪除功能分支與本地 worktree

**完成項目**：
- **M1 里程碑全部完成並合併進 main**（5 任務 + final review + 1 輪修正）
- Jest 測試 26/26 通過（main 分支上驗證）

**遇到瓶頸**：
- Merge 時 `.gitignore` 有小衝突（兩分支各自獨立新增了不同行），手動解決
- `gh pr merge` 因本地 `main` 分支被另一個 worktree 佔用而報錯，但實際上 API 端已 merge 成功，之後手動清理殘留的遠端分支

**開發者交代備忘事項**：
- 下一階段工作：開始規劃並撰寫 M2（探索引擎）詳細實作計畫

## 2026-08-01 第 1 次工作階段

**當日工作內容**：
- 讀取 Handover 與 worklog，開始規劃 M2（探索引擎）
- 確認 M2/M3 邊界（探索引擎 vs 鬼屋降臨+劇本外掛），開發者同意
- 討論內容範圍：只收錄劇本1、10必用內容+每類額外10張增加隨機性；討論地下室是否影響這兩個劇本，因缺少房間樓層對照附件，開發者決定 MVP 測試版直接不含地下室，需要的房間樓層屬性改一樓（暫時性簡化，完整版要復原）
- 重新用 `pymupdf` 抽取三份 PDF，查證發現：規則書沒有完整房間樓層清單，生存者/叛徒手冊沒有事件卡/道具卡內容庫（只有50個劇本敘述文字），預兆卡名稱可從查詢表查到13個真實名稱
- 開發者決定：改由開發者自己對照實體卡片填寫內容，請建立 JSON 範本
- 建立 `data/cards/`（event-cards.json、item-cards.json、omen-cards.json + README）與 `data/rooms/`（rooms.json 18個房間 + README），預兆卡13個名稱、房間 id/name/floor 已填好，已知的4個房間效果文字也填了，其餘留給開發者對照實體元件填寫
- 房間樓層分配討論了兩輪：先由 agent 提出一樓/二樓各5個的猜測分配，開發者接著指出廚房/廢棄房間/食品儲藏室/臥房/傭人房應該是「一二樓皆可」的通用房間磚（真實遊戲機制），並追加焦黑的房間、染血的房間也設為通用，最終定案 18 個房間（5一樓/6二樓/7通用）

**完成項目**：
- M2 內容範圍決策全部記錄在 Handover.md
- `data/cards/*.json`、`data/rooms/rooms.json` 資料範本建立完成，等待開發者填寫

**遇到瓶頸**：
- **卡住等開發者填資料**：M2 實作計畫需要真實內容，事件卡/道具卡完全沒有來源可查，房間的 drawType（抽牌類型）也需要對照實體元件才知道，這兩塊都無法由 agent 自行查證或編造，卡在等開發者手動填寫 JSON 檔案

**開發者交代備忘事項**：
- 下一階段工作：先確認開發者是否已填完 `data/cards/*.json`、`data/rooms/rooms.json`，填完才能開始寫 M2 實作計畫

## 2026-08-01 第 2 次工作階段

**當日工作內容**：
- 評估外部資源 `Claude-Code-Game-Studios`（開發者要求），判斷不適用本專案，說明後確認不採用
- 開發者陸續補充 `rooms.json`（陸續新增至31筆，之後又擴充到23筆再到31筆房間，含新增健身房/保險庫/武器室/標本室/舞廳/琴房/雜亂的房間/天井/客房/藤蔓糾纏的溫室/嬰兒房/浴廁等），每次都先修正 JSON 語法錯誤（缺逗號、id 打字錯誤）、統計 drawType 比例，並確認重複房間/樓層矛盾等問題
- 加入 `description` 欄位到房間資料（角色首次進入房間顯示的場景敘述）
- 開發者填完預兆卡13張真實內容，發現內容比預期豐富（每張都有獨特效果），修正先前「預兆卡機制單純」的錯誤判斷；修正瘋漢屬性不對稱的手誤
- 開發者要求全專案用詞統一：「作祟」→「邪祟」、「奸徒」→「叛徒」、「神智/神志/理智」→「意志」、「檢定」→「考驗」（範圍：`data/`+spec文件，不含歷史worklog/chatlog）；卡牌人稱統一用「玩家」不用「你」，遇到語意混淆的改寫先跟開發者確認
- 開發者填完道具卡12張，機制比預兆卡更複雜（多為「有觸發時機的主動能力」），與開發者討論後決定在 M2 核心引擎設計「觸發時機/擲骰修改器管線」架構
- 開發者填完事件卡11張，發現更多新機制（同房間全員效果、玩家選屬性、持續性標記等），並發現「肉體/精神損傷」傷害系統目前完全未設計，記錄為最大缺口
- 應開發者要求，把所有卡片機制衍生的特殊系統整理成獨立參考文件，供 M2/M3 實作與後續原創內容設計參考
- 開發者確認「駭人尖叫」原本記錄成全域效果是誤植，修正為僅同房間

**完成項目**：
- `data/rooms/rooms.json`（31筆）、`data/cards/omen-cards.json`（13張）、`item-cards.json`（12張）、`event-cards.json`（11張）皆已填入真實內容並驗證JSON格式正確
- 新增 [docs/superpowers/specs/2026-08-01-card-mechanics-reference.md](superpowers/specs/2026-08-01-card-mechanics-reference.md)：彙整17種機制模式＋傷害系統缺口說明＋M2/M3分工建議＋AI主持人代勞設計原則
- 全專案用詞統一（作祟/奸徒/神智神志理智/檢定 → 邪祟/叛徒/意志/考驗）

**遇到瓶頸**：
- 傷害系統（肉體/精神損傷如何影響屬性）完全未設計，是目前最大的未定案項目，留給 M3 詳細設計時優先處理

**開發者交代備忘事項**：
- 下一階段工作：跟開發者討論 `card-mechanics-reference.md` 的機制模式要怎麼設計成具體資料格式/程式介面（尤其傷害系統），確認後才開始撰寫 M2 實作計畫
