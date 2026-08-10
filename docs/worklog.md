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

## 2026-08-01 第 3 次工作階段

**當日工作內容**：
- 開發者提供規則書關於屬性/傷害的完整內容（屬性上限與溢出紀錄、邪祟前不死、物理/精神傷害對應屬性、同房攻防對擲機制、偷竊條件、武器使用限制、遠程攻擊規則），逐一確認後記錄定案，傷害系統缺口解決
- 討論攻擊分層：確認先選攻擊屬性（力量/意志/速度遠程）、再選武器加成，兩層互斥邏輯
- 討論房間門/連接系統（先前完全未設計）：房間新增 `size`/`doors` 欄位，門朝向由引擎在放置當下動態計算（進入方向必有門+剩餘隨機+衝突旋轉+極端情況強制對齊），適用所有門數（1-4）
- 討論「玩家選擇/等待回應」的通用互動模式：確認20秒逾時、彈窗+倒數UI、同時機點多張卡擇一
- 開發者描述完整的回合流程與行動力系統（20秒選移動/道具/襲擊/操作，第二層20秒選具體項目且不可返回上一步防拖延漏洞，行動力=速度值，開門後歸零，各動作點數消耗規則），建立獨立新文件記錄
- 依開發者要求，把36張卡片全部分類觸發時機，找出「同時機點擇一使用」的群組，補進機制參考文件
- 完成多階骰結果的門檻陣列格式設計、持續性標記/buff-debuff通用機制設計（`removeWhen`可擴充詞彙）
- 開發者更正：第一層動作選項「考驗」改名「操作」且範圍限定房間機制，面具/魔術方塊等卡片主動能力應歸類在「道具」選項下，已修正兩份文件

**完成項目**：
- 新增 [docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md](superpowers/specs/2026-08-01-turn-flow-and-action-points.md)：核心回合流程與行動力系統設計文件
- `card-mechanics-reference.md` 補完：傷害系統與戰鬥規則定案、觸發時機分類表（36張卡）、多階骰陣列格式、buff/debuff通用機制
- `rooms.json` 加入 `size`/`doors` 欄位（`doors` 待開發者填寫）

**遇到瓶頸**：
- 無重大瓶頸，皆為設計討論

**開發者交代備忘事項**：
- 下一階段開始時，先檢查 `rooms.json` 的 `doors` 欄位是否已填，若還是 `null` 要提醒開發者（`description` 欄位不用提醒，開發者說可暫時略過）
- 下一階段工作：討論「20秒彈窗詢問玩家」的互動模式要怎麼設計成 Socket.IO 事件，確認後才開始撰寫 M2 實作計畫

## 2026-08-01 第 4 次工作階段

**當日工作內容**：
- 檢查 `rooms.json` 的 `doors` 欄位，確認仍是 `null`，提醒開發者
- 討論 Socket.IO 提問協定設計（`game:prompt`/`game:promptRespond`/`game:promptResolved`），確認全房間同時最多一個提問、其他人可見、伺服器端權威倒數、斷線不特別處理，記錄進 `turn-flow-and-action-points.md`
- 開發者要求撰寫 M2 實作計畫，因範圍過大提議拆成 M2a/M2b/M2c 三個子計畫依序執行，開發者同意
- 撰寫 M2a（遊戲核心狀態＋房間版圖系統）計畫前，讀取 M1 實際程式碼與真實房間資料，發現「起始房間」與「樓層連接」機制先前完全沒設計，跟開發者確認後定案（4塊固定起始房間、梯廳固定連接二樓平台、一二樓為獨立座標網格），建立 `data/rooms/starting-rooms.json`
- 撰寫 M2a 完整實作計畫（5任務、29個測試），自我審查時發現並修正 2 個測試座標設計錯誤、1 個潛在 flaky test（改用 Math.random mock）
- 開發者選擇 Subagent-Driven 執行方式，因 weekly limit 限制本階段先收工，執行留待下次

**完成項目**：
- 新增 [docs/superpowers/plans/2026-08-01-m2a-board-and-player-state.md](superpowers/plans/2026-08-01-m2a-board-and-player-state.md) M2a 實作計畫（已自我審查）
- 新增 [data/rooms/starting-rooms.json](../data/rooms/starting-rooms.json) 起始房間資料
- `turn-flow-and-action-points.md` 補上 Socket.IO 提問協定設計

**遇到瓶頸**：
- 無重大瓶頸；起始房間/樓層連接的設計缺口是在寫計畫過程中發現，及時跟開發者確認後解決，沒有卡住太久

**開發者交代備忘事項**：
- 下一階段開始先檢查 `rooms.json` 的 `doors` 欄位
- 下一階段工作：呼叫 `subagent-driven-development` skill（先用 `using-git-worktrees` 建立獨立 worktree），依 M2a 計畫逐任務執行

## 2026-08-02 第 1 次工作階段

**當日工作內容**：
- 檢查 `rooms.json` 的 `doors` 欄位，開發者確認已補上；驗證時發現一筆全形數字語法錯誤（禮拜堂 `"doors": ２`），修正後 31 筆全部有效
- 建立獨立 worktree（`worktree-m2a-board-and-player-state`），依 M2a 計畫用 `subagent-driven-development` skill 逐任務執行：Task 1 contentLoader.js、Task 2 doorLayout.js、Task 3 boardGenerator.js、Task 4 playerEntity.js、Task 5 gameState.js
- 每個任務都出現同一類落差：計畫附的參考程式碼在 Global Constraints 要求的「不合法輸入一律拋出自訂 UPPER_SNAKE_CASE 錯誤」上有缺口；Task 1 時與開發者確認以補齊自訂錯誤為準，後續任務套用同一原則直接修正，不重複詢問
- 最終整分支審查（opus）發現 4 個 Important 級問題：doorLayout.js 門朝向搜尋演算法有約 20% 機率漏掉本可成立的門配置（改成窮舉修正）、playerEntity.js changeStat 未驗證 delta/hauntStarted（改用非整數會靜默損毀屬性資料）、doorLayout.js 對 getNeighborRequirement 回傳值未做白名單檢查、另外 2 項從 Minor 升級為 Important（boardGenerator.js 座標未驗證、gameState.js 重複 playerId 會靜默覆蓋玩家）；另一項「fallback 造成單向門」的發現判定為 M2b（移動邏輯）範疇的設計問題，記錄下來留給 M2b 處理，不在 M2a 修
- 修正輪＋ scoped re-review 後全部乾淨（70/70 測試通過），合併回 main（fast-forward）
- 合併後發現主目錄還有一筆先前未提交的工作目錄變更（開發者手動填寫的 31 筆房間 `doors` 數值，因為是直接編輯檔案、沒走 git commit），與開發者確認後另外提交
- 清理已合併的 worktree 與分支（M2a 分支＋順手清掉 M1 時期殘留未刪的舊分支），push 到 main

**完成項目**：
- 新增 `server/src/game/{contentLoader,doorLayout,boardGenerator,playerEntity,gameState}.js` 及對應測試（共 70 個測試，含 M1 既有 26 個）
- `data/rooms/rooms.json`：31 筆房間 `doors` 欄位補齊並提交
- M2a 里程碑完整合併進 main（commit fa7f493..559884d）

**遇到瓶頸**：
- 無重大瓶頸；「輸入驗證缺口」這類問題在多個任務重複出現，因為已有開發者第一次的明確裁定可套用同一原則，沒有逐次打斷詢問

**開發者交代備忘事項**：
- 下一階段工作：撰寫 M2b（提問協定＋回合流程）詳細實作計畫，要以 M2a 實際完成的程式碼介面（`gameState.js`/`playerEntity.js`/`boardGenerator.js`/`doorLayout.js` 的實際函式簽名，含審查後新增的驗證錯誤代碼）為基礎延伸，不用計畫文件裡假設的介面
- M2b 撰寫計畫時需要明確設計「fallback 造成單向門」時的鄰接判定規則（最終審查發現但判定為 M2b 範疇，尚未決定）

## 2026-08-02 第 2 次工作階段

**當日工作內容**：
- 討論 M2b（提問協定＋回合流程）設計，先確認「單向門」鄰接判定規則：兩間已探索房間之間能不能通行，改成雙方都要在共用邊列出門才算通行（AND 邏輯），已放置房間的 `doorSides` 資料本身不回頭竄改
- 讀取 M2a 實際完成的程式碼介面（`gameState.js`/`playerEntity.js`/`boardGenerator.js`/`doorLayout.js`/`contentLoader.js`），作為 M2b 設計基礎
- 討論角色屬性/開局分配時，發現實體遊戲的角色屬性其實是「刻度制」（一整排可能重複的數值，上升/下降一級是移動索引、不是數字加減），跟 M2a 原本假設的線性 current/max 模型不同；開發者確認並要求修正，回頭改寫 `server/src/game/playerEntity.js`（`track`/`currentIndex`/`baseIndex`/`skullIndex`），新增 `getStatValue`/`isBelowBase`（給藥膏/嗅鹽這類「低於基準值」卡片效果用）
- 建立 `data/characters/` 角色資料範本（6 個佔位角色位置，欄位含代號/性別/年齡/職業/四屬性刻度），供開發者陸續填入真實角色卡內容，填寫前先用假數值跑
- 逐項確認 M2b 架構決定：遊戲狀態存放（新增 `GameManager`，跟 `LobbyManager` 平行）、選角色互動流程（隨機順序、逐一選、確認才鎖定、30秒逾時隨機指定、其他人可隨時瀏覽角色資訊）、房間磚牌庫歸屬 M2b、牌庫抽完後的規則（開門選項消失、未連接的門視為牆、遊戲用現有版圖跑到結束）、回合順序（跟選角色順序分開各自骰）
- 記錄 Phase 2 AI 玩家的預留設計（選角色順序排真人之後、回合順序仍完全隨機、AI 數量不可超過真人數量），寫進 spec 供之後參考
- 確認實測時機：M2b 計畫最後加一個簡易除錯用測試頁面（非正式美術），讓開發者能在正式遊戲介面完成前就能點選驗證流程
- 寫完 M2b 設計文件，自我審查後給開發者看過確認可以進入 `writing-plans`
- 考量範圍過大（約10個任務），跟開發者確認拆成 M2b-1（純邏輯模組）+ M2b-2（Socket.IO整合+除錯頁面，待 M2b-1 完成後再依實際介面撰寫）
- 撰寫 M2b-1 實作計畫（8 任務：contentLoader擴充/roomDeck/boardGenerator擴充/gameState擴充/promptState/characterSelection/gameManager/turnFlow），自我審查時發現「回合順序」這個設計文件裡有講但沒對應任務的缺口，補進 Task 7/Task 8
- 開發者選定 Subagent-Driven 執行方式，本階段先收工，執行留待下次

**完成項目**：
- 修正 [server/src/game/playerEntity.js](../server/src/game/playerEntity.js) 為刻度制屬性模型（已通過測試、已提交）
- 新增 [data/characters/](../data/characters/) 角色資料範本（6 個佔位角色）
- 新增 [docs/superpowers/specs/2026-08-02-m2b-turn-flow-design.md](superpowers/specs/2026-08-02-m2b-turn-flow-design.md) M2b 設計文件
- 新增 [docs/superpowers/plans/2026-08-02-m2b1-core-game-logic.md](superpowers/plans/2026-08-02-m2b1-core-game-logic.md) M2b-1 實作計畫（已自我審查，尚未執行）

**遇到瓶頸**：
- 角色屬性刻度制的發現算是本階段最大的意外——M2a 原本的線性屬性模型跟實體遊戲機制不符，回頭修正花了一些討論釐清精確語意（`baseIndex` 固定基準值 vs `currentIndex` 目前位置），但範圍侷限在 `playerEntity.js` 一個檔案，改起來不複雜

**開發者交代備忘事項**：
- 下一階段工作：用 `subagent-driven-development` 執行 M2b-1 計畫（跟 M2a 一樣先建獨立 worktree）
- M2b-1 全部完成、通過 final review、合併回 `main` 後，才開始撰寫 M2b-2（Socket.IO 事件層整合＋除錯用測試頁面）的計畫，要以 M2b-1 實際完成的程式碼介面為基礎，不要用計畫文件裡假設的介面
- `data/characters/characters.json` 的 6 個角色仍是佔位資料（`track` 是空陣列），等開發者陸續對照實體角色卡填寫；填之前不影響開發進度

## 2026-08-03 第 1 次工作階段

**當日工作內容**：
- 依 Handover 指示，建立獨立 worktree，用 `subagent-driven-development` 執行 M2b-1 計畫（8 個任務：contentLoader.loadCharacters、roomDeck.js、boardGenerator.canMoveBetween、gameState 擴充、promptState.js、characterSelection.js、gameManager.js、turnFlow.js）
- Task 6（characterSelection.js）、Task 7（gameManager.js）審查各發現 1-2 個 Important 級輸入驗證/測試覆蓋缺口，套用先前已確立的原則直接修正，不重複詢問
- Task 8（turnFlow.js）實作過程中，實作者自行發現計畫測試碼本身有邏輯錯誤（`INVALID_MOVE_DIRECTION` 測試情境設定錯誤：往西移動其實是合法的回大門廳移動，而且開門會讓行動力歸零，根本測不到目標錯誤路徑），停下來分析根本原因後跟開發者確認修正方向，重新設計測試情境（改用往北、模擬下一回合重設行動力）
- Task 8 過程中一個 subagent 因外部用量限制中途失敗（沒有寫入任何檔案異動），改派全新 subagent 接手同一輪修正，未受影響
- Task 8 審查發現 2 個 Important 問題（行動力/方向合法性檢查順序顛倒、缺少「鄰居門不同意」的負向情境測試），修正並通過複審
- 全部 8 個任務完成後，派最終整分支審查（opus），發現 3 個 Important 問題：(1) 房間磚牌庫完全沒實作樓層維度（`floor` 欄位被忽略，玩家永遠上不了二樓）；(2) `advanceTurn` 沒有重設下一位玩家的行動力，職責無人認領；(3) `turnFlow` 完全沒有「是否輪到你」的檢查。前兩項判定為計畫/設計文件本身的架構缺口，跟開發者確認方向後才動工；第三項是可直接套用既有慣例的修正
- 開發者裁定：樓層維度現在就補（單一牌庫、抽到不符樓層放回牌庫最底重抽）；`advanceTurn` 直接併入行動力重設；樓梯移動設計成不耗行動力的免費動作
- 派一次較大範圍的修正輪（重新設計 `roomDeck.js` 的抽牌模型、`turnFlow.js` 新增樓梯移動與 turn ownership 檢查），複審通過（160/160 測試），合併回 main

**完成項目**：
- M2b-1 里程碑完整合併進 main（commit range `2aa45df..0dd7b22`）
- 新增 `server/src/game/{roomDeck,promptState,characterSelection,gameManager,turnFlow}.js` 及對應測試
- `contentLoader.js`/`boardGenerator.js`/`gameState.js` 擴充（角色資料載入、移動鄰接判定、房間磚牌庫與序列化）
- 房間磚牌庫改為樓層感知（ground/upper/any），新增樓梯移動（免費動作）、回合行動力自動重設、回合歸屬權驗證
- Jest 全過（13 suites / 160 tests，含 M1/M2a 既有測試）

**遇到瓶頸**：
- Task 8 的測試設計錯誤是本次自己發現、自己分析根因後跟開發者確認方向解決，沒有卡太久，但過程說明了「非顯而易見錯誤要先停下分析」這條規則實際運作的樣子
- 最終審查發現的樓層/行動力重設兩個架構缺口，是計畫與更早的設計文件都沒處理到的，回頭補花了額外一輪較大範圍的修正，但範圍侷限、複審一次過

**開發者交代備忘事項**：
- 下一階段工作：撰寫 M2b-2（Socket.IO 事件層整合＋除錯用測試頁面）計畫，要以 M2b-1 實際完成的程式碼介面（`gameManager`/`promptState`/`characterSelection`/`turnFlow`/`roomDeck`/`gameState` 的實際函式簽名，含本次新增的樓層感知/樓梯/回合歸屬邏輯）為基礎延伸
- 最終審查提到但本次未處理的架構問題：選角色階段的 `characterSelection` state 與 `promptState` 容器目前沒有任何模組持有（`gameManager` 只管已建立的 `gameState`），這是 M2b-2 必須先解的架構問題，要寫進 M2b-2 設計討論
- `serializeGameState` 目前不含 pending prompt 資訊，M2b-2 廣播時需要一併考慮

## 2026-08-04 第 1 次工作階段

**當日工作內容**：
- 討論並確認 M2b-2 架構決策：選角色階段狀態改用獨立、用完即丟的 `characterSelectionManager.js`（開發者修正 agent 原本傾向擴充 `GameManager` 的提案）；`promptState` 未來若給回合流程用，在 `gameState` 上開全新獨立欄位，不跟選角色階段共用；房主手動觸發選角、`socketHandlers.js` 直接持有 `setTimeout`、除錯頁面用 client 內簡易 React 元件、回合動作先接直接事件不套兩層計時提問、`game:pendingCardDraw`/`game:pendingAction` 做成獨立廣播提早準備接口
- 撰寫並執行 M2b-2 實作計畫（5 任務：LobbyManager host 追蹤、characterSelectionManager.js、角色選擇 Socket 事件、回合流程 Socket 事件、除錯測試頁面），`subagent-driven-development` 逐任務執行
- Task 3/Task 4 各自發現同一類測試競態錯誤（`game:prompt` 廣播的 `.once` 監聽器競態），套用先前 M1 已有先例直接修正；Task 4 一個 subagent 因誤解背景通知機制而卡住，接續說明後恢復正常；Task 4 審查一度因外部 API 用量限制中斷，重新派審通過
- 最終整分支審查發現 2 個 Critical（`handleCharacterSelectTimeout` 無 try/catch 會讓整個 process 當掉；`finishCharacterSelection` 用即時大廳名單而非凍結的選角順序，會造成永久卡住或悄悄少人開局），根因都是缺少「選角開始後」的階段防護。開發者確認新增 `ROOM_IN_PROGRESS`/`GAME_ALREADY_STARTED` 規則，修正並複審通過後合併進 `main`
- 依開發者指示，回頭修正 M2b-2 計畫文件本身內嵌的測試競態程式碼樣本，新增「執行時發現並修正的計畫錯誤」章節
- 清理 worktree 時處理 Windows 殘留 jest 程序、主目錄 `client/` 缺少 `node_modules` 的建置失敗，皆診斷後解決
- 用 `brainstorming` 技能開始 M2c（卡牌牌庫＋效果解析器）設計討論，重新讀取卡牌機制參考文件與三份卡片資料最終內容作為基礎，逐項確認：框架範圍（先建完整的擲骰修改器/持續性標記/多階梯框架，onAttack/onDamageTaken 留給 M3）、pendingPrompt 狀態放獨立的 `effectResolverManager`（不動 `gameState`）、抽卡改成隨 `game:move` 自動觸發解析、事件/道具/預兆牌庫抽空時比照房間磚牌庫「跳過、視為無事發生」（不做棄牌堆重洗）、36 張卡片的 effects 內容由 agent 依參考文件草擬、開發者審核修正
- 提出 M2c 模組切分（`cardDeck.js`/`effectPipeline.js`/`modifiers.js`/`effectResolver.js`/`effectResolverManager.js`）、宣告式效果 JSON 語法（`dice_check`/`stat_change`/`grant_item`/`lose_item`/`persistent_modifier`/`peek_and_reorder`/`choice`）、新增 Socket 事件（`game:cardDrawn`/`game:effectPendingChoice`/`game:effectPromptRespond`/`game:effectResolved`）、任務拆分建議（M2c-1 純邏輯／M2c-2 socket 整合／M2c-3 卡牌內容），開發者確認拆分建議，指示完整設計文件留到下階段撰寫

**完成項目**：
- **M2b-2 完整合併進 `main`**：`server/src/lobbyManager.js`（host 追蹤）、`server/src/game/characterSelectionManager.js`（新）、`server/src/index.js`/`server/src/socketHandlers.js`（大幅擴充：角色選擇與回合流程 Socket 事件、`ROOM_IN_PROGRESS`/`GAME_ALREADY_STARTED` 防護）、`client/src/DebugGameScreen.jsx`（新）、`client/src/LobbyScreen.jsx`（除錯模式入口）
- 修正並提交 [docs/superpowers/plans/2026-08-04-m2b2-socket-integration.md](superpowers/plans/2026-08-04-m2b2-socket-integration.md) 計畫文件本身的測試競態程式碼樣本
- M2c 設計討論的所有決策已記錄（尚未寫成 spec 文件，留待下階段）

**遇到瓶頸**：
- Task 4 一個 subagent 誤以為 Bash 指令執行完會有背景通知，只改測試沒做實作就停手，靠檢查 git 狀態診斷後接續說明解決
- Task 4 審查中途遇到 API 用量限制中斷，重新派審即可，未影響已完成的實作
- 骰子面值 agent 記錯（誤記成 0/0/0/1/1/2），開發者當場更正為 0/0/1/1/2/2，已寫入本次討論記錄，尚未落成程式碼

**開發者交代備忘事項**：
- 下一階段工作：把本次 M2c 討論的所有決策整理寫成完整設計 spec 文件（`docs/superpowers/specs/`），自我審查後給開發者確認，才進入 `writing-plans`
- 骰子面值務必用 **0/0/1/1/2/2**，不是 0/0/0/1/1/2
- M2c 任務拆分已定案：M2c-1（純邏輯：`cardDeck.js`/`effectPipeline.js`/`modifiers.js`/`effectResolver.js`）→ M2c-2（Socket 整合：`effectResolverManager.js`＋`socketHandlers.js` 接線＋除錯頁面擴充）→ M2c-3（36 張卡片實際 effects 內容，agent 草擬、開發者審核）
- `ROOM_IN_PROGRESS` 錯誤碼在 `client/src/LobbyScreen.jsx` 的 `ERROR_MESSAGES` 還沒有中文翻譯（目前顯示通用「發生未知錯誤」），非阻塞，開發者尚未決定何時處理

## 2026-08-05 第 1 次工作階段

**當日工作內容**：
- 撰寫 M2c-1（純邏輯模組）實作計畫並 inline execution 完成全部 7 任務：`cardDeck.js`、`effectPipeline.js`（骰面 0/0/1/1/2/2）、`modifiers.js`、`effectResolver.js`（`stat_change`/`grant_item`/`lose_item`/`persistent_modifier`/`dice_check`/`choice`）、`playerEntity.js` 新增 `addItem`/`removeItem`，合併進 `main`
- 撰寫 M2c-2（Socket 整合）實作計畫並 inline execution 完成全部 7 任務：`effectResolverManager.js`、卡牌牌庫接上 `gameState`/`gameManager`、`game:move` 自動抽卡解析、`game:effectPromptRespond`＋真實逾時計時器、除錯頁面顯示效果結果
- M2c-2 完成後派獨立整分支審查，發現 1 個 Critical（`game:move` 抽卡後若效果卡在 `choice` 提問未解決，仍無條件呼叫 `advanceTurnIfOver`，導致下一位玩家撞上 `promptState` 單一提問限制拋錯、連帶跳過收尾動作，房間永久卡死）與 1 個 Important（未知 `drawType` 拋出未分類 `TypeError` 而非專案慣例錯誤，同樣觸發死鎖路徑）。依開發者確認的通用模式修復：任何會推進狀態的新動作先檢查未解決選擇並拒絕、觸發選擇的動作本身延後推進狀態、效果解析呼叫包 try/catch。修復後另外補寫 event/omen 牌庫的實測回歸測試（不只驗證 item 牌庫），並在 Handover 新增「除錯注意事項」章節記錄這個通用慣例
- 依開發者提出的完整人工測試流程（建房→鎖門→選角→回合迴圈→邪祟考驗），逐項盤點 M2 收尾前的缺口，確認：邪祟觸發規則（每抽一張預兆牌，`omenCount` 遞增後骰等量骰子，總和 >5 觸發）、20 秒兩層計時提問 UI 延後到 M2 完整測試跑完後再補、新增 M2d（簡易使用者介面）里程碑、執行順序 M2c-3→M2c-4→M2c-5→M2d
- 討論物品可否對他人使用的欄位設計，開發者中途修正方向：不是單純布林值，而是三選一的 `category` 欄位（武器/消耗品/一般），並要求檢查預兆卡是否也有武器屬性、事件/預兆卡是否需要消耗品屬性。確認規則：消耗品「生效後」（不是「使用後」）才移除，魔術方塊等考驗類道具若未通過視為未生效、不觸發消耗品規則
- 撰寫並提交 M2c-4/M2c-5（道具/操作動作接線＋邪祟考驗機制）設計 spec 與 6 任務實作計畫，計畫自我審查時抓到 Task 5/Task 6 殘留的錯誤測試草稿並清除
- 開新 worktree（分支 `worktree-m2c4-m2c5-action-and-haunt`），inline execution 依序完成 6 任務：卡片 JSON 補 `category`/`canTargetOthers` 欄位、`effectResolver.js` 新增 `appliedCount` 回傳值、`turnFlow.js` 的 `selectAction` 接上道具/操作真實邏輯、`socketHandlers.js` 的 `cardId`→`sourceId` 改名＋`consumeItemIfApplied` 參數傳遞、`game:selectAction` 接上真實道具/操作效果解析、`resolveCardDraw` 加入邪祟考驗機制
- 執行期間排查一個環境問題：`server/test/socketHandlers.test.js` 測試本身秒退但 Jest 進程不會自然結束（既有的非同步 handle 未關閉問題，非本次改動造成），確認 `--forceExit` 可解，記入 Handover 除錯注意事項
- Task 5 執行中發現計畫裡「room_action 成功案例」測試情境跟既有規則矛盾（開新房間會讓行動力歸零並立刻結束回合，同一回合不可能再有行動力觸發操作），停下跟開發者確認後，改用直接操作 `gameState` 模擬「下一回合已站在房間裡」的情境修正測試
- 發現並清除 `docs/worklog.md` 前一次工作階段結尾殘留的工具呼叫外洩文字（`</new_string>`/`</invoke>` 兩處），屬於文件污染非本次改動造成

**完成項目**：
- **M2c-1、M2c-2 皆已合併進 `main`**（含 M2c-2 獨立審查抓到並修復的 Critical bug）
- [docs/superpowers/specs/2026-08-05-m2c4-m2c5-action-and-haunt-design.md](superpowers/specs/2026-08-05-m2c4-m2c5-action-and-haunt-design.md)、[docs/superpowers/plans/2026-08-05-m2c4-m2c5-action-and-haunt.md](superpowers/plans/2026-08-05-m2c4-m2c5-action-and-haunt.md) 已撰寫並提交
- **M2c-4/M2c-5 全部 6 任務已完成，在分支 `worktree-m2c4-m2c5-action-and-haunt` 上，測試全綠（288/288），尚未合併回 `main`、尚未經過獨立審查**
- Handover.md 新增「除錯注意事項」章節（async-choice-resolution 慣例、Jest 未正常結束環境問題）

**遇到瓶頸**：
- （已解決）Jest 執行 `server/test/socketHandlers.test.js` 後進程不自然結束，導致指令逾時／背景執行殘留大量重複行程鏈，反覆診斷後確認是測試檔案既有的非同步 handle 洩漏問題，跟本次程式改動無關；往後對這個檔案跑測試要加 `--forceExit`
- （已解決）M2c-4 計畫裡 room_action 測試情境跟既有規則矛盾，與開發者確認後修正測試設計，非程式邏輯問題

**開發者交代備忘事項**：
- 下一階段工作**優先**：M2c-4/M2c-5 分支尚未經過獨立審查，需要先跑 `/code-review ultra`（或等效審查流程）確認沒問題，再決定是否合併回 `main`
- 分支已推送至 GitHub 備份，worktree 保留供審查後續修正使用
- M2c-3（36 張卡片＋房間操作 effects 內容）、M2d（簡易使用者介面）仍在排隊，待 M2c-4/M2c-5 審查與合併後接續

## 2026-08-09 第 1 次工作階段

**當日工作內容**：
- 讀取 Handover，確認 M2c-4/M2c-5 分支狀態沒有變動，開始優先處理獨立審查
- 用 `requesting-code-review` 技能派出獨立審查（`general-purpose` subagent，比對 base/head SHA 完整 diff），特別要求重點檢查前次新增的兩個機制：async-choice-resolution 慣例是否正確套用在道具/操作動作、消耗品移除的 `appliedCount` 邏輯是否正確
- 審查結果：核心機制與硬性不變量（預兆卡不可為消耗品、開新房間後行動力歸零不可能同回合操作、`game:cardDrawn` 保留 `cardId`）皆通過檢查，288 測試全綠；但抓到 1 個 Important 級潛在問題——`handleEffectResolveResult` 的 `removeItem` 呼叫沒有包 try/catch，若未來消耗品道具自己的 `effects` 又額外寫了指向自己的 `lose_item`，會造成重複移除拋錯，且會在非同步選擇解析路徑（`game:effectPromptRespond`／逾時）跳過推進回合與廣播狀態——跟 M2c-2 的 Critical C1 是同一類問題，透過新增的 `removeItem` 呼叫點重新出現
- 依 TDD 流程先寫失敗測試重現這個潛在 bug（真的讓一個消耗品道具的 choice 選項效果包含指向自己的 `lose_item`，確認會拋 `ITEM_NOT_FOUND` 並跳過收尾動作），修好後（`removeItem` 包 try/catch，視「已不存在」為良性 no-op）確認測試轉綠，另外補一個「消耗品透過非同步選擇路徑正確移除」的涵蓋測試（審查同時指出的 Important #2 缺口），全套 290 測試通過後提交推送
- 用 `finishing-a-development-branch` 流程合併：切回 `main`、`git pull`（第一次遇到暫時性網路錯誤，重試 `git fetch` 後正常）、合併 `worktree-m2c4-m2c5-action-and-haunt` 分支（乾淨合併無衝突）、合併後重跑全套測試（290/290）確認無誤才推送 `main`
- 嘗試依慣例清理 worktree，發現該 worktree 目前正被本次 session 鎖定為作業目錄（`git worktree remove` 報錯 `locked working tree`），判斷不應該強制解鎖刪除自己正在使用中的目錄，保留待下次 session 處理，僅在 Handover 記錄待辦
- 逐項列出 `item-cards.json`（12張已填內容）／`omen-cards.json`（13張）目前的 `category`/`canTargetOthers` 草稿值供開發者對照實體卡片審核，開發者確認全數正確，無需修改
- 開始 M2c-3（36 張卡片＋房間操作 effects 內容）前，先盤點全部資料現況，發現 2 個需要跟開發者確認的架構問題：房間「結束回合被動加成」（禮拜堂/圖書室/食品儲藏室/健身房）完全沒有觸發點；治療藥膏/嗅鹽要用的 `restoreToBase` 既有邏輯有 bug（會誤降已達基本值以上的數值）。開發者裁定：觸發點另立獨立小任務、bug 直接修正，並確認武器/傷害類卡片這次維持 `needsCustomLogic:true` 留給 M3
- 依 TDD 修好 `restoreToBase` bug（`server/src/game/effectResolver.js`），全套測試通過後提交
- 逐項討論 4 個機制缺口的處理方向：(1) 多點傷害分配——開發者定案「連續跳出 N 次單點選擇視窗，每次顯示候選屬性當下級別+數值，逾時後剩餘點數改用規則書原案的平均分配批次處理」，確認整個傷害系統（新效果類型`damage`＋連續提示鏈＋即時查值機制）放到 M3 實作；(2) 新增 `draw_card` 效果類型（隨機抽 N 張卡），開發者要求抽卡結果要私下讓玩家知道、不廣播；(3) 「同房間全員各自考驗」目前唯一需要的卡片（駭人尖叫）本身也卡在傷害系統，一併延後；(4) 徽章這張預兆卡文字提到的房間不存在於目前房間清單，開發者裁定保留卡片存在但暫不寫功能
- 依 TDD 實作 `draw_card` 效果類型（`effectResolver.js` 新增 handler＋`resolveEffects` 聚合 `drawnCards`），並在 `socketHandlers.js` 三個相關 handler（`game:move`/`game:selectAction`/`game:effectPromptRespond`）用發起方自己的 socket 私下發送 `game:cardsDrawn`，確認逾時路徑（無 socket 可用）是已知限制、目前沒有卡片會用到
- 全套測試跑一次抓到 1 個 flaky 測試（`draw_card` 抽 2 張的測試斷言假設牌庫保持原始順序，但 `createCardDeck` 會洗牌），確認是自己剛寫的測試設計問題、非產品邏輯錯誤，改成順序無關的比對後穩定通過
- 完整分類全部 36 張卡片＋相關房間，逐一跟開發者確認可以先草擬的批次，開始撰寫 `item-cards.json`（3張）、`omen-cards.json`（4張＋全部13張補上 `needsCustomLogic` 欄位）、`event-cards.json`（6張）、`rooms.json`（保險庫）的實際 `effects` 內容
- 撰寫滴答聲/祈禱聲（房間持續骰數修改標記）時發現 `dice_check` 的骰數調整完全沒有上下限保護（卡面文字明確要求「最少一顆」「最多八顆」），依 TDD 補上 `[1,8]` 夾值後提交
- 用一次性驗證腳本載入真實內容檔案，讓全部已草擬的卡片/房間在多組骰值與選項分支下實際跑過 `resolveEffects`，抓到 `persistent_modifier` 的 `removeWhen` 被誤設為強制欄位（滴答聲/祈禱聲卡面文字沒有寫解除條件）。跟開發者確認後，這兩個房間標記維持永久、不寫解除規則，依 TDD 把 `removeWhen` 改成可選欄位（省略＝永久不解除），驗證腳本全部 19 張卡片/房間通過後提交推送
- 開發者指示先收工，審核完這批內容後再繼續

**完成項目**：
- **M2c-4/M2c-5 正式合併進 `main`**（含審查抓到並修復的 1 個 Important 問題），測試 290/290 全綠
- `item-cards.json`/`omen-cards.json` 的 `category`/`canTargetOthers` 欄位已由開發者確認無誤
- **M2c-3 第一批內容（19 張卡片/房間）已草擬並驗證，測試全綠（301/301）**：`item_003`/`item_004`/`item_009`、`omen_002`/`omen_005`/`omen_006`/`omen_007`/`omen_009`（含全部13張補 `needsCustomLogic`）、`event_001`/`event_005`/`event_006`/`event_007`/`event_009`/`event_010`、`room_vault`
- 新增 `draw_card` 效果類型（含 `game:cardsDrawn` 私人通知機制）
- 修復 3 個既有程式碼缺口：`restoreToBase` 誤降已達標數值、`dice_check` 骰數無上下限、`persistent_modifier` 的 `removeWhen` 誤設為強制欄位
- Handover.md 更新：M2c-4/M2c-5 標記完成、M2c-3 進度與待辦、多項除錯注意事項新增（傷害系統設計定案、房間觸發點缺口、`draw_card`/`removeWhen` 使用說明）

**遇到瓶頸**：
- （已解決）合併前 `git pull` 一度出現「Empty reply from server」的暫時性網路錯誤，改用 `git fetch` 重試後正常，本地 `main` 其實已經跟遠端同步，不是真的落後
- （已解決）`draw_card` 抽 2 張卡的測試因牌庫洗牌導致順序不定而 flaky，改成順序無關比對
- （非阻塞，記錄待辦）功能分支的 worktree 因為是本次 session 的作業目錄而被鎖定，無法照慣例當場清理，內容已安全合併進 `main`，只是收尾清潔工作延後
- （非阻塞，記錄待辦）操作疏失把 `removeWhen` 程式碼修正跟 M2c-3 內容草稿合併成同一筆 commit（`52cdd1d`），功能正確但 commit 訊息對不上完整內容

**開發者交代備忘事項**：
- 下一階段工作：先等開發者審核完 M2c-3 第一批內容（19 張卡片/房間）的實際數值是否正確，有修正意見再處理
- 審核通過後才繼續 M2c-3 剩餘內容——依開發者已定案的方向：武器/傷害類卡片留給 M3（含新設計的連續提示鏈傷害分配機制）；房間結束回合/離開考驗的觸發點是獨立小任務；`peek_and_reorder`/差遣能力/穿脫狀態/移動限制持續效果目前都還沒排入具體任務
- 開新 session 時記得檢查 `.claude/worktrees/m2c4-m2c5-action-and-haunt` 是否還被鎖定，能清就清掉（`git worktree remove` + `git branch -d worktree-m2c4-m2c5-action-and-haunt`）

## 2026-08-09 第 2 次工作階段

**當日工作內容**：
- 開發者要求繼續下一階段工作，Agent 確認環境狀態（`main` 乾淨、無未提交異動、worktree 仍鎖定）後詢問 M2c-3 第一批內容審核狀況與下一步方向
- 開發者要求刪除 worktree，Agent 再次嘗試 `git worktree remove` 仍被 `locked working tree` 擋下（鎖定原因明確指向本次 session 自己），判斷這不是普通風險確認後可執行的情況——這是 session 自己正在使用的作業環境，強制解鎖有讓當下 session 壞掉的風險，不能貿然執行，改為說明限制並提供開發者自己在 Claude Code 之外的終端機執行、或開一個不用這個 worktree 的全新 session 執行的替代方案

**完成項目**：
- Handover.md 更新：worktree 清理限制說明得更完整（明確寫出無法在任何仍使用這個 worktree 的 session 內完成的原因，附上開發者可自行執行的指令）

**遇到瓶頸**：
- （非阻塞，記錄待辦）worktree 清理需要開發者自己動手或換一個不相關的 session 才能完成，本 session 無法處理

**開發者交代備忘事項**：
- 下一階段工作：先等開發者審核完 M2c-3 第一批內容，審核完再繼續（同上次交代）
- worktree 清理如果開發者想現在處理，可以直接在系統終端機（非 Claude Code）執行 Handover 裡列出的指令

## 2026-08-09 第 3 次工作階段

**當日工作內容**：
- 開發者要求繼續處理 M2c-3 剩餘卡片，Agent 重新盤點後列出 5 張真正需要新機制設計、之前未討論過的卡片（水晶球/狗/面具/電池耗盡/通靈板），逐一提出設計方向請開發者確認：通靈板整張延後 M3（依賴怪物/叛徒系統）；水晶球開發者簡化為「展示牌庫前3張供選1張，不重排」；面具開發者要求改用泛用的「生效狀態」而非字面的「戴脫」；電池耗盡確認只擋開新房間、不限制移動距離；狗這張開發者提出「操控切換到限制版角色」的全新構想，範圍已超出內容撰寫，另外開一輪設計討論
- 依 TDD 逐項實作已確認的機制：預兆牌抽到時併入玩家背包（跟道具共用同一套持有/使用流程，`game:selectAction` 的 `item` 分支同時查 `items`/`omens` 兩個目錄）、`preview_and_choose`/`take_previewed_card`（水晶球）、`toggle_active`（面具，設計成可泛用而非寫死戴脫語意）、`removeWhen` 支援陣列（OR 邏輯）、`persistent_modifier` 新增 `blocksOpenDoor` 效果並接上 `turnFlow.js` 的方向判定、`checkRemoveConditions` 終於接上真實呼叫點（`game:move` 後檢查同房間玩家、任何效果解析後檢查持有道具）——每個機制都是先寫失敗測試、確認失敗、實作、全套測試通過才提交，共 6 次獨立 commit
- 撰寫並驗證水晶球（omen_003）、面具（omen_008）、電池耗盡（event_004）三張卡的實際 `effects` 內容，用真實內容跑過驗證腳本（含修正腳本本身沒有模擬「預兆牌先加入背包」這個新步驟的問題）後提交推送，M2c-3 累計 22 張卡片/房間有真實內容
- 針對狗這張卡的設計，開發者提出「速度6/其他1，只能移動不能開門，只能撿取/給予道具，不能主動襲擊/被襲擊」的操控切換構想，並延伸出「道具遺留在房間」的新機制（房間動態狀態新增欄位記錄遺留物）。Agent 盤點後列出 10 個技術/規則層面的未釐清點分四類（操控切換的回合/行動力機制、狗的行動限制、遺留欄位放哪裡、給予機制目前完全不存在），開發者逐項詳細回答並把「狗」改名「犬靈」，額外確認「給予」道具給同房間玩家是真的要新增的機制（不是之前討論過忘記做）
- 針對犬靈機制的技術實作層面（切換用哪個 socket 事件、操控期間怎麼分辨玩家本人還是召喚物、犬靈要不要獨立座標/行動力欄位、結束回合的限制），再確認 4 點，開發者要求欄位命名為可擴充的 `summons`（不限定犬靈），並修正 Agent 原本設想的「操控召喚物時不能結束回合」判斷——正確規則是「消散」純粹是狀態切換不等於結束回合，回合是否結束完全看玩家自己的行動力，`turnFlow.js` 不需要新增任何檢查
- 依照全部討論內容，撰寫「召喚物操控切換＋道具給予/遺留/撿取」設計文件，含自我審查（修正一處內部不一致：早期草稿誤寫成犬靈遺留動作要開專用 socket 事件，跟後面章節確認的「沿用既有事件、伺服器端依 `summons` 狀態分派」矛盾，已修正一致）

**完成項目**：
- M2c-3 累計 22 張卡片/房間已有真實 `effects` 內容，測試全綠（317/317）
- 新機制：預兆牌併入道具持有機制、`preview_and_choose`/`take_previewed_card`、`toggle_active`、`removeWhen` 陣列支援、`blocksOpenDoor`、`checkRemoveConditions` 真實接線
- [docs/superpowers/specs/2026-08-09-summon-control-and-item-drop-design.md](superpowers/specs/2026-08-09-summon-control-and-item-drop-design.md) 設計文件已撰寫並提交，等開發者過目
- Handover.md 大幅更新：M2c-3 最新進度、新機制的除錯注意事項、犬靈設計文件待辦

**遇到瓶頸**：
- 無重大瓶頸，本階段主要是設計討論＋依既有慣例逐項實作，沒有卡住的地方

**開發者交代備忘事項**：
- 下一階段工作：先確認開發者是否審核完這批 22 張卡片內容，以及是否已看過犬靈設計文件——核准後才呼叫 `writing-plans` 把設計文件轉成實作計畫
- worktree 清理待辦維持不變（見上次交代）

## 2026-08-10 第 1 次工作階段

**當日工作內容**：
- 開發者指示「刪除遠端分枝後直接進行下一個階段」：刪除已合併的遠端備份分支，並確認 M2c-3 22 張卡片＋犬靈設計文件視為已核准（開發者未提出修改意見）
- 呼叫 `writing-plans` skill，把犬靈設計文件轉成 7 任務實作計畫，自我審查後提交（[docs/superpowers/plans/2026-08-10-summon-control-and-item-drop.md](superpowers/plans/2026-08-10-summon-control-and-item-drop.md)）
- 開發者選擇 Subagent-Driven-Development 執行方式；建立獨立 worktree（分支 `worktree-summon-control-and-item-drop`），過程中發現剛寫好的計畫檔案沒有先 commit 就開了 worktree，導致新 worktree（從 `origin/main` 分岔）讀不到計畫檔——用 `Read` 工具讀回主副本內容，在 worktree 裡重新寫入並 commit 解決
- 依序派 subagent 執行並審查 Task 1（`droppedItems` 房間欄位）、Task 2（`switch_control` 效果類型）、Task 3（道具 give/leave/pickup）——三個任務皆一次通過，無需修正
- Task 4（`moveSummon`/`selectSummonAction`）審查發現 Important 問題：`advanceTurn` 安全網清空 `summons` 時沒有先把召喚物攜帶的道具掉落，會讓道具憑空消失——跑一輪修正＋重新審查後通過。審查同時發現一個計畫沒設想到的架構缺口：犬靈道具本身花 1 點行動力，若玩家使用當下剩 1 點，行動力歸零會觸發回合自動結束，剛建立的召喚物瞬間被摧毀
- 停下來跟開發者討論這個缺口的解法（不自行決定），開發者決定：**回合結束機制全面改為手動**（不限召喚物情境），新增 `game:endTurn`，前端按鈕留到 M2d。查證發現這會改到全遊戲共用的回合推進邏輯，且會弄壞 `socketHandlers.test.js` 裡約 8-10 個既有斷言——如實回報這個影響範圍給開發者，開發者確認一起帶入這個 worktree 執行，把它插入計畫成為新的 Task 5（後面兩個任務順延成 Task 6/7），並同步修正 Task 6 裡跟舊回合機制相關的過時內容
- Task 5 執行後審查通過（無 Critical/Important），過程中 implementer 發現並修正一個既有的測試競態類型（套用檔案裡既有的修法慣例，非隨意試錯），349/349 穩定通過
- Task 6（`socketHandlers.js` 接上 `player.summons` 分流＋`mode` 透傳）審查通過，無 Critical/Important
- Task 7（`omen_004` 犬靈卡片內容）尚未開始，開發者指示收工，中斷於此

**完成項目**：
- [docs/superpowers/plans/2026-08-10-summon-control-and-item-drop.md](superpowers/plans/2026-08-10-summon-control-and-item-drop.md) 實作計畫（7 任務，含執行期間插入的 Task 5）
- SDD 執行 Task 1-6/7 完成並通過獨立審查（詳細審查結論見 worktree 內 `.superpowers/sdd/2026-08-10-summon-control-and-item-drop/progress.md`）：`droppedItems` 房間欄位、`switch_control` 效果類型、道具 give/leave/pickup、`moveSummon`/`selectSummonAction`、**手動結束回合機制（`endTurn`/`game:endTurn`，全體玩家適用）**、`socketHandlers.js` 召喚物分流
- Handover.md 更新：worktree/分支位置、SDD 執行進度、新機制的除錯注意事項

**遇到瓶頸**：
- 計畫檔案在開 worktree 前忘記 commit，導致新 worktree 讀不到——用 `Read` 工具讀回內容重寫解決，過程記錄在上方工作內容
- Task 4 審查發現的回合結束機制缺口，不是單純程式錯誤，是計畫沒設想到的架構決策，依規則停下來跟開發者討論確認方向，沒有自行決定

**開發者交代備忘事項**：
- 下一階段工作：進 worktree `.claude/worktrees/summon-control-and-item-drop`（分支 `worktree-summon-control-and-item-drop`），從 SDD 進度帳本確認的 Task 7 開始繼續，完成後跑全分支最終審查再合併回 `main`
- 回合結束機制的改動（Task 5）是全遊戲共用邏輯的改動，不是單純召喚物功能——合併前的全分支審查要特別注意這部分的完整性

## 2026-08-10 第 2 次工作階段

**當日工作內容**：
- 開發者指示「請繼續進行未完成的工作」，接續前一階段中斷處，進 worktree 從 Task 7 開始
- Task 7（`omen_004` 犬靈卡片內容）派 subagent 完成並通過審查，349/349 全綠
- 依 SDD 流程跑**全分支最終審查**（最強模型，涵蓋全部 12 筆 commit）：發現 1 個 Critical＋4 個 Important，都是單一任務個別審查看不到、只有整個分支放在一起才會浮現的跨任務問題
  - **Critical（會卡死遊戲）**：抽卡就立刻解析 effects，跟「持有後主動使用」共用同一組欄位沒有區分——水晶球/面具原本就有這個問題（影響較小），犬靈的切換控制效果一旦在抽卡瞬間自動觸發，加上這次拿掉的自動結束回合機制、除錯頁面又沒有消散/結束回合按鈕，會讓遊戲永久卡死
  - **Important**：操控召喚物時樓梯仍可免費傳送本體、召喚切換沒有「一回合限一次」的限制、道具遺留會弄丟道具狀態（如面具的啟動標記）、除錯頁面完全沒有結束回合按鈕
  - 針對其中兩項牽涉架構決策的問題（如何區分「抽到即觸發」vs「持有後使用」、要不要真的限制一回合一次切換），停下來跟開發者確認方向，兩項都獲得明確指示後才動手
- 派 subagent 完成 5 項修正並通過重新審查；重新審查發現「道具遺留」的修正只補了半邊（遺留補了，撿取沒補），這個是機械性的同類修正（非新設計決策），直接處理完成並補了一個往返測試
- 最終測試套件穩定通過 358/358
- 用 `finishing-a-development-branch` 流程合併：因為 session 被鎖定在 worktree 裡，用 `ExitWorktree` 工具（保留模式）退回主副本才能操作 `main` 分支的 merge/test/push；合併成功後刪除本機與遠端的 worktree／分支
- 更新 Handover.md，把整個 `summon-control-and-item-drop` 段落從「進行中」改為「已完成並合併」，並把全分支審查發現的 Critical/Important 案例寫進除錯注意事項供未來參考

**完成項目**：
- `summon-control-and-item-drop` 全部 7 個任務＋全分支審查修正，已合併進 `main` 並推送
- Worktree／本機分支／遠端分支皆已清理
- Handover.md／worklog.md／chatlog 更新完成

**遇到瓶頸**：
- 全分支審查發現的 Critical 問題牽涉一個既有（M2c-3 就有，只是影響較小）的架構模式缺陷，不是這次新增的 bug，但這次的犬靈卡片讓它從「小麻煩」變成「會卡死遊戲」——依規則跟開發者確認修法方向後才處理，沒有自行決定

**開發者交代備忘事項**：
- 下一階段工作：M2c-3 其餘卡片（傷害系統等機制缺口，見 Handover）或 M2d（簡易前端 UI），順序已跟開發者確認為 M2c-3 → M2d

