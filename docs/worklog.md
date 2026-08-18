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

## 2026-08-10 第 3 次工作階段

**當日工作內容**：
- 開發者「晚安」開新 session，讀取 Handover 後討論本階段工作方向，選定先做房間獨立小任務（結束回合被動加成＋離開房間前考驗）
- 說明 `onceOnlyPerPlayer` 欄位的用途（禮拜堂等 4 間房間的結束回合加成，目前完全沒有觸發點），跟開發者確認離開房間前考驗（塔橋/雜亂的房間/藤蔓糾纏的溫室）的細節：塔橋的「跨越」機制併入統一的「離開時考驗」處理；考驗失敗行動力照扣但可以當回合再試
- 設計「結束回合被動加成」＋「離開房間前考驗」兩個機制方向，確認可以直接在 `main` 上用 TDD 逐項實作（範圍小，不用開 worktree），實作完成：`game:endTurn` 接上房間加成觸發、`moveToRoom` 新增 `leaveCheck` 參數（沿用既有 `dice_check` 的骰值機制，但只需要通過/沒通過的布林結果，不是完整 tiers），確認離開房間前考驗要同時擋住「移動到已知房間」與「開新門」兩種離開方式，開門失敗不影響行動力歸零規則，成功才會歸零。3 個 commit，364/364 測試全綠，推送
- 開發者要求繼續討論 M2c-3，實際盤點後發現先前的印象有誤（不是幾乎都卡在 M3），還有 8 張卡片＋保險庫沒排查過。逐一看過卡面文字後，確認其中 4 張其實隱含綁在 M3 傷害/戰鬥系統上（先前 Handover 沒有列出全部清單），真正沒卡住、需要新機制的是天使羽毛/詭異人偶/幸運兔腳/蠟燭 4 張「影響擲骰」的道具
- 討論「影響擲骰的道具」機制，開發者確認要做「統一擲骰入口」讓 `dice_check` 跟 `leaveCheck` 共用同一套機制，並確認幸運兔腳（擲骰後重骰）不做（後期擴展性低），直接把這張卡從遊戲移除（`item-cards.json` 刪除該筆資料）
- 用 `brainstorming` skill 正式討論「可被道具介入的擲骰」設計，確認幾個關鍵決定：暫停等待玩家回應的狀態要另開一個獨立欄位（`pendingRollChoice`），不跟既有的 `pendingChoice` 共用；詢問視窗一次列完所有可用道具選項（不分兩層問要不要用/用哪個）；天使羽毛需要的數值直接跟著選項一起送出，不用第二層視窗。設計文件寫完並提交
- 用 `writing-plans` skill 轉成實作計畫，讀程式碼時發現規格文件沒完全講清楚的技術細節（`effectResolver.js` 無法直接讀卡片目錄，需要透過 `context.itemCatalog` 往下傳；巢狀擲骰的 `interjectionChoice` 沒清掉會誤套用）。任務量偏大（10 個任務），跟開發者確認拆成兩份計畫，第一份先做 `dice_check` 路徑（7 任務），`leaveCheck` 路徑留給之後的 Part B
- 用 `subagent-driven-development` 在獨立 worktree 執行 Part A 全部 7 個任務：Task 6 執行時 implementer 發現並正確停下（不自行修改）一個計畫本身的一行遺漏（`resolveCardDraw` 缺少 `content` 參數傳遞，導致 2 個測試失敗），確認是計畫作者的疏失後授權修正，計畫文件也同步訂正；Task 5 審查發現 2 個 Important（迴歸測試沒有鑑別力、cost 路徑仍會洩漏 `interjectionChoice`），修一輪後通過重新審查
- 全分支最終審查（最強模型，涵蓋全部 9 筆 commit）：發現 3 個 Important（`overrideValue` 沒驗證就先消耗道具，導致天使羽毛可能被永久摧毀且擲骰結果憑空消失；新暫停狀態沒清空舊的，架構上可能導致房間永久卡死；除錯頁面完全沒有新事件監聽，20 秒凍結）＋1 個 Minor（`sourceDeckType` 沒有在恢復流程中保留）。除錯頁面凍結問題跟開發者確認要加最小監聽/按鈕（不是接受凍結或延後），派 subagent 一次修完 4 項，其中一項（`pendingChoice` 卡死）原本以為無法測試，implementer 找到辦法補了真正會失敗的迴歸測試。重新審查全數通過，391/391 測試穩定
- 用 `finishing-a-development-branch` 合併：`ExitWorktree` 退回主副本、merge、測試確認、刪除 worktree/分支、推送
- 更新 Handover.md：兩個小任務段落改為已完成，新增全分支審查發現的兩個通用教訓（消耗前驗證、新暫停狀態要主動清空舊的）到除錯注意事項

**完成項目**：
- 房間獨立小任務（結束回合被動加成＋離開房間前考驗）已完成並合併進 `main`
- `dice-interjection-part-a`（天使羽毛/詭異人偶/蠟燭三張卡的擲骰介入機制，`dice_check` 路徑）全部 7 任務＋全分支審查修正，已合併進 `main`
- 幸運兔腳（`item_007`）依開發者指示從遊戲移除
- [docs/superpowers/specs/2026-08-10-dice-interjection-design.md](superpowers/specs/2026-08-10-dice-interjection-design.md)、[docs/superpowers/plans/2026-08-10-dice-interjection-part-a.md](superpowers/plans/2026-08-10-dice-interjection-part-a.md) 已撰寫並提交
- Handover.md 更新完成

**遇到瓶頸**：
- 全分支審查發現的問題都是跨任務組合出來的，個別任務審查看不到——跟先前 `summon-control-and-item-drop` 的經驗一致，確立了「新增暫停狀態要檢查跟既有狀態共存」這個通用教訓
- Task 6 執行期間再次遇到計畫本身有遺漏（跟上一階段的犬靈計畫如出一轍），依同樣流程處理：implementer 停下不自行修改，確認是計畫問題後才授權修正

**開發者交代備忘事項**：
- 下一階段工作：M2c-3 其餘卡片（傷害系統/通靈板/中世紀鎧甲，都卡在 M3）或 `dice-interjection` Part B（`leaveCheck` 路徑）或 M2d，開發者尚未排定順序

## 2026-08-11 第 1 次工作階段

**當日工作內容**：
- 開發者「早安」開新 session，讀取 Handover 後選定執行 `dice-interjection` Part B（`leaveCheck` 路徑的道具介入）
- 用 `brainstorming` skill 討論設計：確認直接擴充既有 `pendingRollChoice` 機制（新增 `resumeKind:'leaveCheck'`，不另建新機制）、`game:move` 觸發介入詢問時 ack 回傳 `{kind:'leaveCheckPending'}`（沒有既有先例可循，明確跟開發者確認）、`leaveCheck` 的擲骰完全重用 Part A 寫好的 `computeInterjectedRoll`（含道具代價、持續性修正），設計文件寫完提交
- 用 `writing-plans` skill 轉成 4 任務實作計畫，用 `subagent-driven-development` 在獨立 worktree 執行；worktree 是從 `origin/main` 建立，發現設計文件與計畫文件其實還沒推送（前一階段疏漏），先在主副本補推、merge 進 worktree 分支後才繼續
- 4 個任務全數一次通過個別審查：export `computeInterjectedRoll`、`moveToRoom` 兩階段化（含破壞性簽章變更）、`game:move` 開啟 leaveCheck 的 `pendingRollChoice`（抽出共用的 `finishMoveResult`）、`resumeRollChoice` 新增 `leaveCheck` 分支
- 全分支最終審查（最強模型）：整合面（兩個 `resumeKind` 分支互不干擾、無死鎖、`game:move` 重構行為等價）確認良好，但抓到 1 個 Important——leaveCheck 直接擲骰路徑（沒有道具介入時）沒有套用房間/玩家的持續性修正（modifier），但介入/逾時路徑（透過 `computeInterjectedRoll`）會套用，兩條路徑不一致（現行出貨內容還踩不到，屬潛伏性缺陷）。跟開發者確認方向：套用（讓兩條路徑一致，也符合設計文件本來就寫的「完全重用」）。派 subagent 一次修完（含一個新的鑑別性測試）＋一筆測試註解算術錯誤，scoped re-review 確認全數修復、無新問題，399/399 測試穩定
- 用 `finishing-a-development-branch` 合併：`ExitWorktree` 退回主副本、merge、測試確認。worktree 的實體資料夾刪不掉（Windows 檔案鎖定，找不到實際佔用程序，可能是 OneDrive/防毒軟體），git 端（worktree 註冊＋分支）已經正常清理乾淨，只是磁碟殘留一個空殼資料夾，記錄下來不擋流程
- 更新 Handover.md：`dice-interjection-part-b` 段落改為已完成並合併，新增全分支審查發現的教訓（新路徑重用既有邏輯時要檢查跟舊路徑的一致性，不能只顧新路徑本身正確）

**完成項目**：
- `dice-interjection-part-b`（天使羽毛/詭異人偶可介入 `leaveCheck` 離開房間前考驗）已完成並合併進 `main`，`dice-interjection` 全部功能（Part A + Part B）至此完整
- [docs/superpowers/specs/2026-08-11-dice-interjection-part-b-design.md](superpowers/specs/2026-08-11-dice-interjection-part-b-design.md)、[docs/superpowers/plans/2026-08-11-dice-interjection-part-b.md](superpowers/plans/2026-08-11-dice-interjection-part-b.md) 已撰寫並提交
- Handover.md 更新完成

**遇到瓶頸**：
- 全分支審查再次證明「只審查新路徑本身」不夠——leaveCheck 的 modifier 不一致問題，是因為新的介入路徑重用了 `computeInterjectedRoll`（含 modifier 邏輯），但沒人回頭檢查舊的直接路徑要不要跟著補齊，形成新的不一致，跟上一階段「新暫停狀態要檢查跟舊狀態共存」是同一類「合併多個變更後才會浮現」的問題
- worktree 資料夾清不掉的 Windows 檔案鎖定問題，原因不明，未深入排查（不影響 git 狀態或功能）

**開發者交代備忘事項**：
- `dice-interjection`（Part A + Part B）全部完成，下一階段工作待開發者決定：M2c-3 其餘卡片（仍卡在 M3 傷害系統）或 M2d（簡易使用者介面）
- `.claude/worktrees/dice-interjection-part-b/` 資料夾清不掉，有空時可以手動確認並刪除

## 2026-08-11 第 2 次工作階段

**當日工作內容**：
- 開發者選定討論 M2D（簡易使用者介面），先確認討論方式：一次把整個 M2D 討論完，執行階段再拆成多份計畫
- 討論版面結構時，開發者直接給出完整的大廳流程規劃（開頭頁面 Gate.png 背景、暱稱輸入、等候階段、房主/一般玩家不同按鈕），並提到一般玩家「以房主 ID 選擇大廳」的機制——盤點後發現這已經超出原本 Handover 定義的 M2D 純前端範圍，牽涉後端新增（房主權限轉移目前完全沒做、需要新的大廳列表查詢機制）
- 確認範圍決定：大廳流程併入 M2D 討論，訂為 M2D1；角色選擇階段訂為 M2D2（等開發者補角色圖片後另外提出畫面規劃）；遊戲進行中畫面訂為 M2D3 之後。房主權限轉移簡化為「房主離開＝整個大廳解散，所有人被踢回開頭頁面」
- 逐項確認 M2D1 細節：暱稱輸入排在看列表之前、大廳列表顯示房主暱稱＋人數、列表拉一次＋手動刷新（不做即時廣播）、一般玩家退出後回大廳列表；M2D2 確認先用假資料設計畫面（角色資料 `characters.json` 目前全是空欄位）、選角需要二次確認（不是點選即鎖定）、角色卡橫向滑動呈現
- 寫成設計文件並確認，轉成 6 任務實作計畫（`LobbyManager` 新增能力、`lobby:list`、房主解散大廳、開頭頁/暱稱視窗/佔位畫面、大廳列表/等候室畫面、協調層整合＋端對端驗證），用 `subagent-driven-development` 在獨立 worktree 執行
- 執行期間 worktree 從 `origin/main` 建立、漏掉尚未推送的本地 commit，先在主副本補推、merge 進 worktree 分支後才開始（跟上次 dice-interjection Part B 同樣的疏漏，這次更早注意到）
- Task 3（房主解散大廳）執行時，implementer 用獨立除錯腳本正確定位並修復了計畫本身一個真實的 socket.io 廣播順序錯誤（先讓所有 socket 離開房間才廣播，導致廣播送不到任何人），該任務的審查獨立查證 socket.io adapter 原始碼確認修復正確。同一輪審查也發現房主自己的 socket 會同時收到 `lobby:leave` 的 ack 跟 `lobby:closed` 廣播，兩者若都驅動畫面轉場會互相搶跑——在 Task 5 開始前就先修正計畫檔案，避免把這個問題做進程式碼
- Task 1、2、4、5、6 全數一次通過個別審查
- 全分支最終審查（最強模型）：確認核心機制健全（廣播順序修復正確、房主雙重反應防呆足夠、四種房主/一般玩家×主動離開/斷線路徑的 `socket.data` 清理都完整），但抓到 2 個 Important——(1) 大廳列表跟等候室有 4 處直接把伺服器原始錯誤代碼顯示給玩家，沒有走既有的翻譯對照表；(2) 背景圖片 `Gate.png` 高達 8.1MB，合併後會永久留在 git 歷史裡。派 subagent 一次修完（統一錯誤翻譯、圖片縮小到 1600px／約 2.9MB、順手修正一句設計文件裡已經過時的敘述），scoped re-review 確認全數修復
- 合併進 `main`，412/412 測試全綠，client build 成功。清理 worktree 時資料夾刪不掉，這次抓到真正原因：Task 6 端對端驗證時啟動的一個 Vite dev server 進程沒有完全關乾淨（implementer 誤判成不是本次啟動），佔用資料夾檔案控制代碼——手動關閉該進程後資料夾成功刪除，解開了上一階段（dice-interjection Part B）同類問題一直沒查出的根因

**完成項目**：
- M2D1（大廳流程：開頭頁面／暱稱輸入／大廳列表／等候室／房主解散大廳機制／角色選擇佔位畫面）已完成並合併進 `main`
- [docs/superpowers/specs/2026-08-11-m2d1-lobby-flow-design.md](superpowers/specs/2026-08-11-m2d1-lobby-flow-design.md)、[docs/superpowers/plans/2026-08-11-m2d1-lobby-flow.md](superpowers/plans/2026-08-11-m2d1-lobby-flow.md) 已撰寫並提交
- 解開了「worktree 資料夾刪不掉」的根因（殘留 dev server 進程佔用檔案控制代碼），未來遇到同類狀況可以直接排查 node 進程
- Handover.md 更新完成

**遇到瓶頸**：
- 討論初期範圍一度模糊（開發者描述的大廳流程細節超出 Handover 原本定義的 M2D 範圍），透過盤點現有程式碼＋明確提問確認邊界後才繼續
- Task 3 的 socket.io 廣播順序 bug 是本次計畫撰寫階段的疏漏，不是實作偏差；跟先前幾次一樣，implementer 正確停下用獨立除錯腳本定位，不盲目重跑

**開發者交代備忘事項**：
- M2D2（角色選擇正式畫面）待開發者補角色圖片後，由開發者自己提出畫面規劃再討論（`img/` 資料夾裡其實已經有 6 張角色圖＋Gate.png，但依開發者要求先不動）
- 除了 M2D2，下一階段工作待開發者決定：M2c-3 其餘卡片（仍卡在 M3 傷害系統）或繼續 M2D 系列

## 2026-08-12 第 1 次工作階段

**當日工作內容**：
- 開發者「早安」開新 session，讀取 Handover 後，開發者先請 agent 檢查開發者手動修改的 `data/cards/item-cards.json`／`data/characters/characters.json` 兩份檔案，補齊對應效果程式碼——修好 4 處遺漏逗號的 JSON 語法錯誤；`item_013`（腎上腺素藥劑）確認 4 項屬性皆 `restoreToBase`，`category` 由 `general` 訂正為 `consumable`；`item_014`~`017` 確認維持無效果；新增「角色宣告的起始道具在遊戲開始時自動放入背包」機制（`gameManager.js` 的 `startGame`）。直接在 `main` 上 TDD 完成並提交（`f841361`）
- 開啟本機測試伺服器（`.claude/launch.json` 新設定 `server`/`client` 兩組），讓開發者手動驗證 M2D1 流程；開發者確認功能正常，要求測試伺服器保持開啟供後續角色選擇階段使用
- 開發者提出 M2D2（角色選擇正式畫面）完整規劃（六角色橫向排開、hover/點擊浮出加亮、身高比例縮放、點擊跳出屬性資料卡、左翻/右翻/退出/確定選擇），用 `brainstorming` skill 討論確認細節：維持輪流制但允許自由瀏覽（只有確定選擇被輪到才亮起）、點擊與 hover 觸發同樣效果、最高角色（180cm）基準 2/3 螢幕高度其餘按比例縮小、優先實作高度縮放（允許橫向滑動看完 6 個，不強求塞進單一螢幕）。設計文件寫完提交（[spec](superpowers/specs/2026-08-12-m2d2-character-select-design.md)）
- 轉成 3 任務實作計畫（[plan](superpowers/plans/2026-08-12-m2d2-character-select.md)），用 `subagent-driven-development` 在獨立 worktree 執行。Task 1（協調層重構＋`DebugGameScreen` 重新接上 `game:started`）、Task 2（角色畫廊列）、Task 3（屬性資料卡 modal＋確認流程）依序執行，過程中 3 次計畫修正（Task 1 的一次性事件被搶先消費問題；Task 2 的鎖定徽章寬度異常，第一輪假設容器寬度不明確、被 implementer 用獨立靜態 CSS repro 實測證偽，第二輪才抓到真正原因是選擇器特異性衝突；Task 3 的按鈕禁用文字誤將「未輪到」跟「角色已被選走」用同一句訊息表達），皆逐一跟開發者確認方向後修正
- 全分支最終審查途中，第一次 Agent 呼叫因 session 額度不足被中止（"resets 12:40pm"），開發者指示「請繼續執行因未額度不足而中止的工作」，重新完整派工一次成功跑完。審查發現 2 個 Important（狀態訊息缺第 3 種「自己已選」分支；6 張角色圖合計約 37MB 即將進 git 歷史），派 subagent 一次修完（新增 `isMine` 分支＋PowerShell 縮圖到約 600px 寬／約 4.5MB），scoped re-review 通過，412/412 測試全綠
- 用 `finishing-a-development-branch` 合併回 `main`；因中斷造成的長時間空窗，回來後發現先前保持開啟的兩個測試伺服器（3001/5173）已經完全消失（節點行程／連接埠監聽都查無），主動重啟並回報開發者，開發者手動驗證確認 M2D2 功能正確
- 開發者反應版面需求：「角色圖片去背後再放置入角色選擇畫面」。用本機既有工具（Pillow/numpy/scipy，皆已安裝，無需新依賴或連網）試驗去背：色彩距離門檻＋邊界連通 flood-fill 在遊戲內實際顯示尺寸下效果乾淨，但殘留腳下陰影殘影＋右下角浮水印圖示兩處小瑕疵；嘗試提高門檻或改用鄰接色彩容忍度擴散去背，皆因這批 AI 生成人像的膚色亮度太接近灰色背板而啃食到臉部/手部，確認是素材本身限制。提供實際顯示尺寸的預覽圖給開發者參考，開發者決定自行處理去背並提供新圖檔，agent 這邊維持現狀不動作
- 開發者確認提交 `characters.json` 尚未提交的 `tall` 微調（警察 172→170、高中生 175→170、小女孩 151→150），並收工

**完成項目**：
- item-cards.json JSON 語法修正、`item_013` 效果補齊、角色起始道具機制，已提交（`f841361`）
- M2D2（角色選擇正式畫面）已完成並合併進 `main`：[docs/superpowers/specs/2026-08-12-m2d2-character-select-design.md](superpowers/specs/2026-08-12-m2d2-character-select-design.md)、[docs/superpowers/plans/2026-08-12-m2d2-character-select.md](superpowers/plans/2026-08-12-m2d2-character-select.md) 已撰寫並提交
- `characters.json` 的 `tall` 微調已提交（`14a4c36`）
- Handover.md 更新完成

**遇到瓶頸**：
- 全分支審查 Agent 呼叫途中被 session 額度限制中止，重新完整派工一次才跑完；恢復後發現保持開啟的測試伺服器完全消失（很可能是底層沙箱環境在長時間中斷期間被回收），主動重啟並透明回報，未預設仍在執行
- 角色圖片去背受限於素材本身（AI 生成人像膚色亮度與灰色攝影棚背板接近），簡單色彩門檻類方法無法在「不啃食膚色」跟「完整清除陰影/浮水印」之間兩全，判斷需要 ML 分割才能真正乾淨處理，已如實回報並交由開發者自行處理

**開發者交代備忘事項**：
- 角色圖片去背由開發者自行處理後提供新圖檔，agent 屆時協助替換 `client/public/images/` 並重新縮圖
- 下一階段工作待開發者決定：M2c-3 其餘卡片（仍卡在 M3 傷害系統）或 M2D3（遊戲進行中畫面）

## 2026-08-13 第 1 次工作階段

**當日工作內容**：
- 開發者「早安」開新 session，讀取 Handover 後選定推進 M2D3（遊戲進行畫面）
- 開發者提出畫面規劃（左 2/3 地圖／右 1/3 人物面板，地圖以 1x1 方塊組成、方塊四邊依門資料放移動按鈕，人物用圓形徽章標示），並提供一張其他專案的等角透視房間美術截圖當風格參考。用 `brainstorming` skill 逐項確認：地圖採「永遠聚焦目前房間＋鄰居一角＋總覽地圖按鈕切換」（不用常駐整體地圖）、總覽地圖是玩家個人探索紀錄（不是全體共用）、門按鈕依「已探索移動」／「開新門」分樣式、右側面板僅顯示自己、這次討論範圍先定地圖＋面板骨架（行動選單/擲骰道具介入等細節留後續）
- 房間美術圖風格經三輪實際生圖比較（開發者用 AI 生圖工具測試，agent 撰寫比較用 prompt）：娃娃屋等角透視（氛圍最好但近側牆不存在，無法放門框）→ 地牢圖磚等角透視（仍有透視傾斜，單張圖無法靠旋轉對應任意門位置組合）→ **完全平面俯視圖（無透視傾斜、光線無方向性）確定採用**，可用旋轉對應任意門位置且開發者測試後確認視覺效果可接受
- 深入討論房間圖產生規則：四面牆統一畫成半厚度（兩房並列疊合成正常厚度）、依 `rooms.json` 的 `doors` 數量決定要不要多出「相鄰／相對」變體圖（2 門房間才需要 2 張，1/3 門房間靠旋轉涵蓋所有方向，4 門房間 1 張）、房間專屬「排除牆」（如禮拜堂祭壇牆永遠不放門）——agent 推導確認這個機制純靠旋轉就能保證圖跟遊戲資料永遠一致，不需要新增後端資料欄位（原本擔心需要，後來證明想錯了）。整理出固定風格＋變動變數模板，禮拜堂範例定案（2 變體）
- 盤點現有程式碼發現兩個真實架構缺口：前端完全拿不到房間靜態內容（只有 `roomId` 字串）、伺服器已寫好但沒接線的 `getAvailableDirections`（門的 `move`/`open_door` 狀態）。技術決策：門狀態改用「小幅擴充廣播資料＋前端自己算」而非伺服器逐位玩家推播（開發者選定），避免大幅更動十幾個 `game:stateUpdate` 廣播點
- 設計文件寫完提交（[docs/superpowers/specs/2026-08-13-m2d3-gameplay-screen-design.md](superpowers/specs/2026-08-13-m2d3-gameplay-screen-design.md)），涵蓋整體版面／聚焦與總覽地圖／人物徽章／右側面板骨架／房間美術圖產生規則（含 48 張圖的變體數量統計）／後端架構缺口／`player.visitedRooms` 新欄位／範圍外事項
- 開發者確認範圍很大，同意拆成兩份計畫（後端資料串接 → 前端畫面骨架）。第一份計畫（後端，3 任務：`game:started` 廣播房間內容、`serializeGameState` 新增分樓層房間牌庫剩餘資料、`player.visitedRooms` 追蹤）寫完提交（[docs/superpowers/plans/2026-08-13-m2d3-backend-data-wiring.md](superpowers/plans/2026-08-13-m2d3-backend-data-wiring.md)），基準測試 414/414 全綠已確認
- 開發者指示先結束本階段工作，下階段以 `subagent-driven-development` 執行這份後端計畫

**完成項目**：
- [docs/superpowers/specs/2026-08-13-m2d3-gameplay-screen-design.md](superpowers/specs/2026-08-13-m2d3-gameplay-screen-design.md) 已撰寫並提交（`c383b8a`）
- [docs/superpowers/plans/2026-08-13-m2d3-backend-data-wiring.md](superpowers/plans/2026-08-13-m2d3-backend-data-wiring.md) 已撰寫並提交（`33e0374`），尚未開始執行
- Handover.md 更新完成

**遇到瓶頸**：
- 房間美術圖風格選定過程中，agent 一度誤判排除牆機制需要新增後端資料欄位（`excludedDoorSides`），開發者追問程式流程後重新推導才確認純旋轉即可保證一致，不需要後端改動——這次的教訓是先講清楚「渲染時挑旋轉角度對齊真實門資料」的因果順序，避免把「圖畫死方向」跟「圖旋轉對齊」的兩種心智模型搞混
- 中途誤觸一次無意義的 `AskUserQuestion`（佔位選項），已在對話中致歉澄清，未造成實質影響

**開發者交代備忘事項**：
- 下階段（M2D3 後端資料串接計畫）明確指定用 `subagent-driven-development` 執行
- 其餘 30 間房間（約 47 張圖）的變動變數 prompt，留到後端計畫完成、前端骨架計畫開始前後再處理
- 角色圖片去背仍待開發者自行提供新圖檔，尚未收到

## 2026-08-13 第 2 次工作階段

**當日工作內容**：
- 開發者「午安」開新階段，指示先完成剩餘 30 間房間（46 張圖）的美術圖 prompt，再進行後端計畫。Agent 依既有規則產出完成，寫入 [docs/superpowers/specs/2026-08-13-m2d3-room-art-prompts.md](superpowers/specs/2026-08-13-m2d3-room-art-prompts.md) 並提交
- 用 `subagent-driven-development` 執行 M2D3 後端資料串接計畫（3 任務）：Task 1 派工時誤用 `isolation:"worktree"` 參數，implementer 落在孤立分支上無法執行 bash/git，agent 驗證該 diff 正確後手動搬移到正確 worktree、重新驗證、提交，後續改回正常派工不再發生。3 個任務全數一次通過個別審查；全分支最終審查抓到 1 個 Important（沒有整合測試同時驗證三項新資料一起出現在 `game:started` payload，是各任務審查者各自看不到的死角）＋幾個 Minor，一次修完並通過 scoped re-review，418/418 測試全綠，Fast-forward 合併回 `main` 並推送
- 開發者多輪來回規劃「起始大門廳」的房間圖：一開始構想單一 3x1 大房間（agent 指出跟現有引擎「每間房固定佔 1 格」的模型不相容），開發者改為三個 1x1 房間縱向堆疊（對外大門／中央鎧甲走廊／樓梯側含地下室鎖梯）＋二樓平台，逐一提供對應 prompt；過程中一次語意不清（「下方」被提到兩次、內容矛盾），agent 停下確認清楚位置才繼續；開發者回報生成的樓梯視覺不像「往下通往一樓」，agent 分析俯視角度深度暗示不足的問題並修正 prompt
- 開發者要求把兩門房間的「隨機分配門」改為「固定相鄰/相對」，由開發者自行在 `rooms.json` 填寫。Agent 判斷範圍小、機制單一，直接在 `main` 用 TDD 實作新的 `doorPattern` 欄位（`doorLayout.js`/`boardGenerator.js`），426/426 測試全綠並提交，回報欄位規格給開發者
- 開發者回報已填完 `rooms.json` 的 `doorPattern`，請 agent 檢查完整性並同步修剪 prompt 檔案。Agent 發現禮拜堂欄位漏一個逗號導致整份 JSON 語法錯誤，直接修正；確認全部 17 間 2 門房間欄位完整無誤後，把 [room-art-prompts.md](superpowers/specs/2026-08-13-m2d3-room-art-prompts.md) 16 間 2 門房間各自只保留對應 `doorPattern` 的那組 prompt（46 張→30 張），測試套件確認無連帶影響，提交推送

**完成項目**：
- M2D3 後端資料串接計畫已完成並合併進 `main`：[docs/superpowers/plans/2026-08-13-m2d3-backend-data-wiring.md](superpowers/plans/2026-08-13-m2d3-backend-data-wiring.md)
- 剩餘 30 間房間的美術圖 prompt 已產出並提交
- 起始大門廳（3 個 1x1 房間＋二樓平台）的美術圖 prompt 已提供
- `doorPattern` 欄位機制（`server/src/game/doorLayout.js`、`boardGenerator.js`）已實作並合併
- `rooms.json` JSON 語法錯誤已修正，`doorPattern` 欄位完整性已確認
- Handover.md 更新完成

**遇到瓶頸**：
- SDD Task 1 派工時誤用 `isolation:"worktree"` 導致 implementer 工作落在孤立分支——已診斷並手動修復，後續任務改回正常派工方式；這是這次階段唯一的操作失誤，記錄供之後留意
- 「起始大門廳」規劃過程中一次語意不清、兩次無意義的佔位 `AskUserQuestion` 誤觸，皆已在對話中確認/致歉並繼續，未造成實質影響

**開發者交代備忘事項**：
- 下階段開始時，討論套用已生成的房間圖片，建立遊戲開始階段畫面（M2D3 前端骨架，這次後端資料已就緒）
- 角色圖片去背仍待開發者自行提供新圖檔，尚未收到

## 2026-08-14 第 1 次工作階段

**當日工作內容**：
- 開發者「早安」開新階段，看了開發者已生成的 10 張房間圖（`img/rooms/`：大門廳三格 LobbyA/B/C＋二樓平台 2Fladder＋6 張一般房間），品質高、跟 prompt 規格吻合。用 `brainstorming` skill 確認這次範圍縮小為「只做進入遊戲後的起始畫面」（大門廳），而非完整 M2D3 地圖骨架
- 確認資料模型整合方向：新的 3 格大門廳（room_lobby_a/b/c）完全取代舊的大門廳/廊廳/梯廳三個從未真正設計過的固定房間（原本 `doorSides` 全部寫死 `ALL_SIDES`）；玩家在大門廳任一格時，畫面固定顯示三張圖完整堆疊（因為圖片本身已設計成無縫拼接，不做鄰居裁切/淡化）
- 寫成設計文件＋實作計畫（[docs/superpowers/specs/2026-08-14-entrance-hall-and-start-screen-design.md](superpowers/specs/2026-08-14-entrance-hall-and-start-screen-design.md)、[計畫](superpowers/plans/2026-08-14-entrance-hall-and-start-screen.md)），開發者確認後直接執行（判斷範圍雖然touch多個檔案但機制單一，不需要走完整 SDD 流程，agent 自己在獨立 worktree 裡直接施作＋TDD）
- 後端：`placeFixedRoom` 改成接受明確 `doorSides`，`createBoard` 改用新的 room_lobby_a/b/c＋更新過的二樓平台 doorSides；6 個受影響的測試檔案（`boardGenerator`/`contentLoader`/`effectResolver`/`gameManager`/`gameState`/`turnFlow`/`socketHandlers`）逐一排查座標依賴後更新，過程中發現多個既有測試把新房間的座標（north/south of 原點）當「保證是空的」在用，改用遠離大門廳格子的座標，426/426 測試全綠
- 前端：新元件 `EntranceHallView.jsx`（依 `roomContent.startingRooms` 動態查圖檔名稱，依真實 `doorSides` 產生按鈕，`room_lobby_c` 額外顯示上二樓按鈕），`DebugGameScreen.jsx` 新增獨立 `roomContent` state（避免被 `game:stateUpdate` 覆蓋掉）並依玩家目前房間條件渲染。在瀏覽器手動跑完整流程驗證（建房→雙人選角→進入遊戲→移動→上樓梯）全部正常，合併回 `main` 並推送
- 開發者請 agent 開測試伺服器手動測試，回報看不到大門廳圖片、卡在文字除錯頁面。Agent 沒有直接改程式碼，先在自己的瀏覽器分頁重跑一次完整流程確認同一組伺服器上程式碼實際正常運作，判斷是開發者的舊分頁在伺服器重啟後 Vite 熱更新連線斷掉、卡在重啟前的舊版本，請開發者重新整理分頁——確認問題解決

**完成項目**：
- 大門廳整合＋遊戲開始畫面已完成並合併進 `main`：[設計文件](superpowers/specs/2026-08-14-entrance-hall-and-start-screen-design.md)、[實作計畫](superpowers/plans/2026-08-14-entrance-hall-and-start-screen.md)
- 大門廳三張圖＋二樓平台圖已接上前端並實際手動驗證正常運作
- Handover.md 更新完成

**遇到瓶頸**：
- 多個既有測試檔案把「原點南北方向必定是空格」當隱含假設在用，這次新增的大門廳恰好佔用這些座標，逐一排查花了不少時間；沒有捷徑，只能一個個檔案確認座標依賴是否真實存在
- 開發者回報「看不到圖片」時，先自行重現而非直接猜測改碼，確認是瀏覽器舊分頁快取問題不是程式問題，符合專案「不可自行試錯」的規則精神（用重現排查取代盲改）

**開發者交代備忘事項**：
- 下階段開始討論接上其他房間（目前已生成 6 張一般房間圖：`room_library`／`room_vault`／`room_bathroom_ground`／`room_bathroom_upper`／`room_larder`／`room_master_bedroom`，`rooms.json` 尚未補 `filename` 欄位，也還沒有一般房間的地圖顯示元件）
- 角色圖片去背仍待開發者自行提供新圖檔，尚未收到

## 2026-08-14 第 2 次工作階段

**當日工作內容**：
- 開發者「午安」開新階段，展示新一批房間圖片（16 張一般房間＋4 張大門廳），確認範圍為「補齊 31 筆 rooms.json 的 filename 欄位（無資料先佔位）＋聚焦目前房間／鄰居一角／總覽地圖」的一般房間地圖骨架，開發者指定用 `subagent-driven-development` 執行
- 完成並自我審查 [docs/superpowers/plans/2026-08-14-m2d3-general-room-skeleton.md](superpowers/plans/2026-08-14-m2d3-general-room-skeleton.md)（6 任務），用 SDD 依序執行：`mapUtils.js`／`RoomTile`＋`PlayerBadge`／`FocusedRoomView`／`OverviewMap`／`CharacterPanel`／整合進 `DebugGameScreen.jsx`。Task 6 審查抓到 1 個 Critical（計畫本身 Step 2 與 Step 3 文字互相矛盾，導致 `lastPromptResolved` 顯示永遠空白），確認是計畫撰寫疏漏後直接修復；修復期間 implementer session 因額度限制中斷，agent 確認檔案改動已落地後自行完成收尾。427/427 測試通過，合併進 `main` 並推送
- 開發者手動測試後回報 5 項修正需求（大廳單人可進角色選擇、玩家圖標依進入方向定位、暫時除錯框線、文字對比度、道具顯示真實名稱），逐項調查程式碼根因後實作，其中圖標定位範圍（是否含同房間其他玩家）用 `AskUserQuestion` 確認後採用「後端新增 `enteredFromSide` 欄位、支援所有玩家」的完整方案；文字對比度根因是外層 `.lobby-viewport` 的近白色文字設定沒被除錯頁面覆蓋
- 開發者提供截圖回報版面仍不符期待，要求視野正方形放大到最大化、移動按鈕搬到左欄、先確保視野最大再平分左右空間。實作時發現並修正一個 flexbox 冷知識（padding 直接加在 `flex-basis:0%` 的欄位上，即使 `minWidth:0` 仍會頂住縮放下限，需搬到內層 wrapper）
- 開發者再次回報不符期待並提供精確數字規格（房間佔視野 70%、四邊鄰居預覽各 15%），用 `AskUserQuestion` 確認是比例關係後，把標題／錯誤訊息搬進左欄（釋放視野正方形上方空間，最終呈現目標是手機），視野高度預留從 200px 降到 16px，同時修正一個先前遺漏未同步調整的預留高度舊值

**完成項目**：
- M2D3 一般房間地圖骨架已完成並合併進 `main`：[計畫](superpowers/plans/2026-08-14-m2d3-general-room-skeleton.md)、[設計文件](superpowers/specs/2026-08-14-m2d3-general-room-skeleton-design.md)
- 大廳單人角色選擇、玩家圖標依方向定位、道具真實名稱顯示、人物面板文字對比度／姓名／行動力／屬性刻度數值等 5 項修正已完成並合併
- 視野正方形置中最大化版面（左中右三欄，中間固定寬＝視野正方形、左右平分剩餘空間、標題與按鈕移至左欄、70%/15%/15% 比例）已完成並合併
- Handover.md 更新完成

**遇到瓶頸**：
- SDD Task 6 審查抓到的 Critical 其實是 agent 自己撰寫計畫時的疏漏（Step 2 程式碼跟 Step 3 文字說明互相矛盾），非 implementer 誤判——這次的教訓是計畫自我審查階段對「文字承諾」跟「程式碼實際行為」要交叉核對，不能只個別檢查
- 版面需求前後修正了 3 輪，前兩輪開發者回報「不是我要的」，第三輪開發者直接提供精確像素比例（70%/15%/15%）跟明確約束（手機呈現、盡量最大化）才收斂——抽象的版面描述（如「填滿中央區域」）容易產生認知落差，具體數字規格才能一次到位
- 過程中連續踩到兩個 CSS/flexbox 細節坑：忘記在按鈕搬到左欄後同步調小視野高度的預留空間；padding 直接加在 flex 欄位上會頂住 `minWidth:0` 的縮放下限，都是先發現版面數字對不上、實測比對公式才抓出來

**開發者交代備忘事項**：
- 下階段預計開發者會用手機實際測試這次的最大化置中版面，帶著回饋回來討論
- 目前的除錯框線（左中右三欄的紅／綠／藍虛線）仍是暫時性的，等開發者確認版面無誤後要移除
- 角色圖片去背仍待開發者自行提供新圖檔，尚未收到

## 2026-08-15 第 1 次工作階段

**當日工作內容**：
- 開發者「早安」開新階段，請開測試伺服器並詢問手機連線方式。查出兩個問題：Vite dev server 預設只監聽 localhost（改用 `--host` 開放區網）、前端 socket 連線目標開發模式下預設寫死 `http://localhost:3001`（改用 `VITE_SERVER_URL` 環境變數指向筆電區網 IP）。agent 自己的瀏覽器工具連不到私有網段 IP（工具本身安全限制），改用 localhost 驗證正常後請開發者直接手機測試，確認連線成功
- 開發者手機測試回報建立大廳後玩家列表跟房主按鈕都沒出現。Agent 追出根因：`WaitingRoomScreen.jsx` 自己在元件掛載後才訂閱 `lobby:players`，但伺服器端 ack 後緊接著同步廣播，中間隔著一次 React 掛載週期，形成競態條件——這個問題其實一直存在，只是過去測試都是雙人流程（第二人加入的廣播會補上被漏接的第一次），這次用單人建房功能單獨測試才第一次暴露。修法比照 M2D2 `game:started`/`initialGameState` 的既有先例：訂閱搬到協調層常駐監聽，往下當 props 餵。427/427 測試通過，提交（`d4d059e`），開發者手機重測確認可以正常進入遊戲畫面
- 開發者確認手機遊戲最終呈現是直式（portrait），原規劃橫式版面需要改設計，並給出明確規格（視野正方形依螢幕寬度算、同一套 70%/15%/15% 比例、左右人物面板移到下方），要求先記錄不實作。Agent 完整記錄進 Handover，並註記一個待確認的架構問題（是否同時支援橫式），提交（`ce9fb49`），未寫任何版面程式碼

**完成項目**：
- 手機／筆電同 WiFi 連線設定（`--host`＋`VITE_SERVER_URL`）已確認可行
- `lobby:players` 廣播競態條件已修復並合併：[LobbyScreen.jsx](../client/src/LobbyScreen.jsx)、[WaitingRoomScreen.jsx](../client/src/lobby/WaitingRoomScreen.jsx)
- 直式版面需求已完整記錄進 Handover.md，待下階段實作
- Handover.md 更新完成

**遇到瓶頸**：
- agent 自己的瀏覽器工具連不到使用者家用 WiFi 的私有網段 IP（工具安全限制），無法直接在區網 IP 上驗證修復結果，改用 localhost 驗證邏輯正確後請開發者在手機上做最終確認——這是本階段唯一的驗證侷限，不是程式問題
- `lobby:players` 競態條件是本階段第二次遇到「子元件掛載後才訂閱廣播事件」這類問題（第一次是 M2D2 的 `game:started`），確立的通用教訓已記入 Handover 除錯注意事項：任何「伺服器 ack 後緊接著同步廣播」的模式，前端訂閱都要搬到觸發動作發生之前就已經在監聽的地方，不能依賴子元件掛載後才訂閱

**開發者交代備忘事項**：
- 下階段開工第一件事：直式版面改版，實作前建議先跟開發者確認是否要同時支援橫式（media query 切換）或直接只做直式
- 目前的除錯框線（左中右三欄的紅／綠／藍虛線）仍是暫時性的，等版面確認無誤後要移除
- 角色圖片去背仍待開發者自行提供新圖檔，尚未收到

## 2026-08-16 第 1-2 次工作階段

**當日工作內容**：
- 開發者「午安」開新階段，臨時把方向從直式版面改版改成房間／角色資料稽核：檢查手動編輯的 `characters.json`/`rooms.json` 格式、對照官方規則書＋全部 50 個劇本原文列出邪祟降臨／劇情相關但未列入資料庫的房間、整理美術圖缺漏清單，生成 `docs/2026-08-16-room-data-audit.md` 交付
- 依開發者確認回覆修正：`flieicon`→`fileicon` 手誤（6 個角色）、8 間房間（地下湖／老朽迴廊／塵封迴廊／風琴室／崩塌房間／包廂房／神秘電梯／煤導槽）在本專案 2 個劇本中皆未使用、依審核報告 2.2 節補入 11 筆佔位房間到 `rooms.json`
- 開發者再要求跨全部 50 個劇本（非僅本專案 2 個）查核前述 8 間＋臥房／客房共 10 間房間的預兆觸發／劇情使用情形，並明確指示新增「髒亂的房間 Junk Room」（獨立房間，官方力量檢定3+機制）到 `rooms.json`、「地下平台 Basement Landing」到 `starting-rooms.json`。完成查核（老朽迴廊／塵封迴廊／客房全劇本 0 筆命中，其餘 7 間都有具體劇本用法）並完成兩項 JSON 新增，同時誠實告知「觸發預兆」這點缺乏官方主對照表資料、地下平台目前只是安全佔位資料，實際連通地下室需要三樓層架構改動
- 開發者要求風琴室／地下湖／崩塌的房間／包廂房／臥房加回 `rooms.json`，並提出地下室開放的 3 個機制構想（道具解鎖大門廳地下室門、崩塌房間掉落生成地下室房間、原創逃生通道房間）。判斷此舉觸及新架構／新資料模型，呼叫 `brainstorming` 技能釐清範圍；開發者明確拆成 3 個獨立工作階段（本階段只做房間機制內容填充，三樓層擴充與座標連接系統另排）
- 比對 `_rule.pdf` 房間附錄官方原文，把 11 筆先前佔位房間＋5 筆新房間的具體機制（`leaveCheck`／`needsCustomLogic`／`text`）逐一填入 `rooms.json`。發現崩塌的房間官方機制（橫向接到既有地下室房間）跟開發者自創機制（同座標垂直對應）不同，主動提出讓開發者確認；開發者確認速度檢定/骰子傷害維持官方版、掉落位置改用自創座標機制，並補充説明這會需要舞廳／包廂房的雙向房間綁定生成規則（含位置衝突重抽、牌堆最後一張的隨機例外），一併寫入兩間房的 `text` 欄位

**完成項目**：
- `docs/2026-08-16-room-data-audit.md` 稽核報告已交付
- `data/characters/characters.json` 的 `fileicon` 欄位手誤已修正（6 筆）
- `data/rooms/rooms.json` 從 32 筆擴充到 49 筆：11 筆先前佔位房間（餐廳／手術室／天花閣樓／五芒星室／墓園／地下墓穴／地底深淵／鍋爐室／地窖／酒窖／倉庫）全數依官方原文補上機制內容；新增髒亂的房間／風琴室／地下湖／包廂房／臥房／崩塌的房間共 6 筆；`room_ballroom` 樓層修正為 `"ground"` 並補上與包廂房的綁定規則說明
- `data/rooms/starting-rooms.json` 新增地下平台（`room_basement_landing`，`filename` 待開發者補圖）
- 10 間房間的跨全劇本（50 個）使用情形查核完成

**遇到瓶頸**：
- 崩塌的房間官方原文機制跟開發者自創的座標式掉落機制不一致，主動攤開兩個版本讓開發者決定，而非自行擇一——這類「官方規則 vs 自創設計」的分歧，只要不是純語法錯誤層級，都要先問
- `leaveCheck` 引擎目前只會擋住移動、不會真的執行「檢定失敗扣屬性」的懲罰，這是從稍早「髒亂的房間」就存在的資料與行為落差，這次新增 3 間同類房間（天花閣樓/五芒星室/墓園）讓缺口範圍擴大，已記錄為待辦（見下方備忘事項）
- 座標式房間連接（`floor:"basement"`／同座標垂直生成／舞廳包廂房綁定）目前都只停留在 `rooms.json` 的 `text`／`needsCustomLogic:true` 資料層級記錄，實際遊戲邏輯完全還沒寫，等三樓層與座標連接兩個工作階段才會動工

**開發者交代備忘事項**：
- 下階段待辦共 4 項（開發者明確要求記錄，未指定順序）：①未通過考驗扣屬性的引擎缺口②寫死的二樓層改三樓層架構③座標式房間連接機制設計④UI 介面改為手機直式版面（沿用上次階段記錄的規格）
- 本階段全程未啟動任何本機測試伺服器（純資料檔編輯）

## 2026-08-17 第 1-4 次工作階段

**當日工作內容**：
- 開發者「早安」開新階段，從上次記錄的 4 項待辦中選擇優先做「UI 改為手機直式版面」，開啟本機測試伺服器並提供區網連結
- 直式／橫式版面確認為「兩種模式並存」（`AskUserQuestion` 確認直式下按鈕/人物面板堆疊順序：按鈕在上、人物面板在下）。新增 `client/src/gameplay/playingLayout.css`，CSS Grid＋`@media (orientation: portrait)` 讓兩套版面共存，桌面/手機尺寸皆用 JS 結構化檢查驗證（本階段瀏覽器面板截圖功能全程逾時失效，改用 `getBoundingClientRect`/`getComputedStyle` 取代視覺驗證）
- 開發者回報視野圖片貼齊頂端、下方留白，追出根因是容器只有水平置中沒有垂直置中，補 `align-items:center` 修正
- 依開發者指示精簡遊戲畫面成「視野／角色資訊行動區」兩區域，移除除錯訊息欄與底部 JSON 傾印，錯誤改用 `console.error`；鎖定兩區域禁止捲動時抓到並記錄 2 個 CSS 陷阱（Grid 項目預設 `min-height:auto` 會撐開 `overflow:hidden` 容器；瀏覽器預設 body margin 造成額外可捲動空間）
- 方向按鈕移入視野區域鄰房 15% 預覽帶（浮於圖面上不被蓋住，文字改「上/下/左/右」），下方狀態欄依開發者規格重寫成 6 排緊湊版面，實測兩種尺寸皆恰好填滿不溢出
- 後續 3 輪細節調整：①方向按鈕文字改「移動/開門」②樓梯按鈕合併進「操作」（改名「行動」），`AskUserQuestion` 確認合併方式與行動力是否維持免費（維持免費），新增 `move_to_room` 效果類型＋`freeAction` 旗標機制，實測時因後端伺服器未重啟（純執行無監看檔案）卡在 `NO_ROOM_ACTION_AVAILABLE`，排查後重啟伺服器解決，驗證 LobbyC↔二樓平台雙向免費移動正確③4 顆按鈕搬到視野區域四角空白方格＋狀態框改左80%/右20%（道具區）
- 最後一輪：訊息欄改回跟面板同寬（不分左右）佔 25% 高，中央狀態區佔 75% 高；姓名/行動力放大置中佔中央區 2/6（換算面板整體 25%）；四項能力改由上到下各自一排（各佔 1/6），字體與級距量表放大；道具按鈕移除，改成點道具名稱跳出「使用/遺留/取消」選項彈窗，順手修正舊版「道具」按鈕從未真正傳遞 `itemId` 因此必定失敗的既有缺口

**完成項目**：
- 手機直式/橫式版面並存（CSS Grid + media query）已完成並實測
- 遊戲進行畫面精簡為視野／角色資訊兩區域＋完全鎖定捲動已完成
- 方向按鈕移入視野區域、四顆動作按鈕移到四角空白格已完成
- 樓梯功能合併進「行動」按鈕（`move_to_room` 效果類型＋`freeRoomAction` 免費旗標）已完成，後端測試 427/427 通過
- 狀態欄最終版面（訊息欄全寬 25% 高、中央狀態區 75% 高左80/右20、四項能力上下排列放大）已完成
- 道具使用機制改為點名稱跳選項彈窗，並修正舊版道具按鈕從未真正可用的缺口

**遇到瓶頸**：
- 本階段瀏覽器面板截圖功能全程逾時失效（面板未顯示），改用 `getBoundingClientRect`/`getComputedStyle`/DOM 內容檢查等結構化方式驗證每一輪改動，未能提供視覺截圖佐證，靠精確數值比對（例如面板分割比例、按鈕座標）確認正確性
- 後端伺服器變更（資料檔與程式碼）不會自動生效，純 `node src/index.js` 執行沒有監看機制，這次因為忘記重啟卡在 `NO_ROOM_ACTION_AVAILABLE` 一段時間才排查出來——之後任何動到 `server/`或 `data/` 的改動都要記得重啟才能實測
- 「操作」按鈕固定扣行動力但既有樓梯免費，合併時如果沒有主動比對這兩條規則會不小心改變既有遊戲規則，靠讀程式碼主動發現後跟開發者確認方向，不是開發者自己先發現的

**開發者交代備忘事項**：
- 下階段待辦剩 3 項：①未通過考驗扣屬性的引擎缺口②寫死的二樓層改三樓層架構③座標式房間連接機制設計（UI 直式版面本階段已完成）
- 道具「給予」選項尚未實作（需要同房玩家名單，目前元件拿不到資料），give/leave/pickup 三種模式伺服器都已支援，之後有需要可以直接補上
- 暫時除錯框線（視野區域綠色／角色資訊區域藍色虛線）仍未移除，等開發者確認整體版面無誤後再拿掉
- 本階段自行啟動並重啟過的本機測試伺服器（後端 3001／前端 5173）已於收工前確認全數關閉

## 2026-08-17 第 5-7 次工作階段

**當日工作內容**：
- 第 5 階段：完成第 1-4 階段留下的剩餘 2 項待辦——寫死的二樓層改三樓層架構（新增 basement 樓層）、座標式房間連接機制設計與實作（機制 1-4），以及未通過考驗扣屬性的引擎缺口（`leaveCheck` 的 `failPenalty` 補上實際扣屬性邏輯）。開發者確認全部完成。（此階段的對話內容因對話紀錄視窗壓縮而未能完整保留逐字稿，僅存摘要，詳見下方 chatlog 說明）
- 第 6 階段：開發者要求 3 項版面調整因應直式畫面——①大廳初始頁面背景改為 `img/house_cloudy_day.webp`②選角頁面角色立繪重新連結至 `img/characters/` 六張圖③遊戲內玩家圓形 ICON 實際連結顯示。研究後發現第③項需要伺服器補一個先前沒人注意到的資料缺口：`playerEntity.js`/`gameState.js`/`gameManager.js` 從未把 `characterId` 存到遊戲內玩家物件上，導致前端原本不可能知道某個在場玩家對應哪個角色。補上 `characterId` 串接＋`game:started` 新增 `characterContent` 廣播後，三項調整都以雙分頁模擬兩位玩家的方式在瀏覽器實測驗證成功（背景圖 200 OK、六張立繪皆載入完成、玩家徽章正確顯示對應角色 ICON），後端測試 458/458 全數通過
- 收工前關閉本次啟動的測試伺服器時，誤用 `taskkill /F /IM node.exe` 全域關閉所有 node 行程（而非只關閉本次啟動的 2 個），已在對話中向開發者說明並致歉，開發者要求確認是否誤殺其他服務——查核當下系統 node.exe 行程數為 0，但因關閉前未先列出行程清單，無法回溯證明沒有波及本次無關的其他 Node 服務，僅能請開發者自行確認記憶中是否有其他服務受影響（已記錄為經驗教訓：日後關閉自啟動的 server 一律先用 port 對應 PID 精準關閉，不用全域 image name）
- 開發者要求重新開啟本機測試伺服器供其手動測試（已完成，見下方）
- 第 7 階段：開發者提出新需求——訊息欄字體放大到 24px、訊息內容從代碼式文字改為人類可讀句子（範例含房間進入／事件卡／道具卡／預兆卡）、設計「進入房間跳出考驗彈窗（描述＋擲骰按鈕）→ 關窗＋擲骰動畫 → 顯示考驗結果」的機制。呼叫 `superpowers:brainstorming` 技能，先派 Explore agent 研究現有訊息欄／擲骰機制／既有彈窗樣式，發現訊息欄目前用 `JSON.stringify` 硬塞事件內容、完全沒有房間進入訊息、卡片內建考驗的骰值結果從未回傳給前端。經兩輪 `AskUserQuestion` 釐清範圍後，開發者明確要求把 leaveCheck／崩塌房間速度考驗／卡片內建考驗三個各自獨立的機制全部統一整合進同一套考驗彈窗機制（原本以為只需做卡片考驗一種，範圍確認後擴大）。開通瀏覽器視覺化協作分頁，用塔橋房真實資料做 mockup 讓開發者確認彈窗版面（考驗前/結果兩階段、結構化摘要框、字級、成功/失敗大字標題），開發者複選確認 3 項版面細節後，撰寫並提交設計文件 `docs/superpowers/specs/2026-08-17-check-modal-and-readable-messages-design.md`

**完成項目**：
- 3 樓層架構＋座標式房間連接機制（機制 1-4）、`leaveCheck` 失敗扣屬性引擎缺口，開發者確認全部完成
- 大廳背景圖／選角立繪／遊戲內玩家 ICON 三項版面調整，瀏覽器雙人流程實測通過
- `characterId` 從伺服器到前端的完整資料串接（`playerEntity`/`gameState`/`gameManager`/`socketHandlers`），含新測試覆蓋
- 統一考驗彈窗機制設計文件已寫成並提交（`docs/superpowers/specs/2026-08-17-check-modal-and-readable-messages-design.md`），待下階段轉 `writing-plans` 拆任務清單
- 本次階段所有先前累積的未提交變更（第 5、6 階段＋設計文件）已分 3 筆 commit 推送至 GitHub

**遇到瓶頸**：
- 第 5 階段（三樓層／座標連接／leaveCheck 扣屬性）的對話過程因視窗壓縮遺失逐字稿，只能靠摘要回填工作日誌，chatlog 該階段無法提供真正逐字稿，僅能記錄重點摘要並如實告知這個限制
- 關閉測試伺服器時誤用全域 `taskkill`，已知風險並記錄改善作法（見上）
- 第 5、6 階段的程式碼變更累積到本階段才第一次提交，中間橫跨多個功能（引擎架構／角色圖示串接／版面素材），拆分 commit 時部分檔案（如 `OverviewMap.jsx` 的地下室樓層按鈕）難以完全歸類到單一主題，採取「盡量依邏輯分兩批、無法完美切分時如實在 commit message 說明」的做法

**開發者交代備忘事項**：
- 下階段第一件事：針對「統一考驗彈窗機制」設計文件，呼叫 `writing-plans` 技能拆成實作任務清單（開發者已明確指示：這次先結束階段，下階段再進行 writing-plans）
- 暫時除錯框線（視野區域綠色／角色資訊區域藍色虛線）仍未移除，等開發者確認整體版面無誤後再拿掉（延續自第 1-4 階段的備忘，尚未處理）
- 道具「給予」選項仍未實作（需要同房玩家名單）
- 本階段自行啟動的本機測試伺服器（後端 3001／前端 5173）已於收工前用 PID 精準關閉並確認乾淨

## 2026-08-17 第 8 次工作階段

**當日工作內容**：
- 開發者「晚安，請閱讀交接資料與工作規則後與我討論，請開始writing-plans」，agent 確認模型身分（Claude Sonnet 5）後直接呼叫 `writing-plans` 技能。詳讀伺服器端 `socketHandlers.js`／`turnFlow.js`／`effectResolver.js` 現有程式碼與既有測試檔案精確斷言寫法，把設計文件拆成 7 個任務的完整實作計畫（`docs/superpowers/plans/2026-08-17-check-modal-and-readable-messages.md`），每個任務都寫出可直接轉譯的完整程式碼與測試步驟，不留佔位符
- 呼叫 `using-git-worktrees` 技能，詢問開發者是否要建立獨立 worktree（比照過去每個里程碑的慣例），開發者確認後用 `EnterWorktree` 建立 `worktree-check-modal-and-readable-messages` 分支，跑過一次基線測試（458/458）確認乾淨
- 呼叫 `subagent-driven-development` 技能，依序執行 7 個任務（伺服器端 Task 1-4：`turnFlow.js`/`effectResolver.js` 補回傳資料缺口、`socketHandlers.js` 新增 `game:checkResolved`/`game:roomEntered` 廣播；前端 Task 5-7：新增 `CheckModal.jsx` 元件、`DebugGameScreen.jsx` 考驗佇列接線、訊息欄可讀化＋24px），每個任務都是全新 subagent 實作＋獨立審查
  - Task 1 審查抓到一個 Critical：implementer（haiku 模型）用整檔重寫的方式修改測試檔案，導致 UTF-8 BOM＋部分繁體中文字串亂碼，測試檔案根本無法解析（`node --check` 直接報 SyntaxError），implementer 自報「83/83 測試通過」但那份報告根本不可能反映真實提交內容。修復方式：從乾淨的 base commit 撈回原始檔案內容，只重新套用該任務要改的部分，避免整檔重寫；同時發現一個重複的測試區塊一併移除。修復後複審通過，也建立了「往後任務都要提醒 implementer 用 Edit 工具做局部修改、不要整檔重寫，且改完要 `node --check` 驗證」的防範措施，後續 6 個任務都沒有再發生
  - Task 2-7 陸續完成，除 Task 1 外全數第一輪審查即通過（Approved），共記錄 8 筆 Minor 待辦（如 `STAT_LABELS` 四檔重複、`useEffect` 依賴陣列閉包等），依規則列為延後處理不進入修正迴圈
  - 全部任務完成後，controller 自行啟動 worktree 內的雙人瀏覽器測試（模擬 Alice／Bob 兩位玩家），實機驗證訊息欄 24px 字體、「XX 進入了『房間名』」跨玩家廣播訊息、無考驗卡片的簡化確認彈窗（含隨機抽到已知的空白佔位道具卡也正確處理）。嘗試多回合仍未能靠隨機抽卡/開門實機觸發真正的擲骰考驗彈窗（`CheckModal` 的擲骰→動畫→結果流程），如實記錄這個驗證缺口，改用「請整分支最終審查特別聚焦這條路徑」的方式補強信心
  - 整分支最終審查（Opus 模型）確實在這條沒有實機驗證的路徑上抓到 1 個 Critical：`CheckModal` 沒有 `key`，佇列連續兩筆考驗時第二筆會直接跳過「描述→擲骰」顯示前一筆的殘留結果畫面——正好是開發者最早要求的「依序彈窗」核心情境。另抓到 4 個 Important：`activatedOnUse` 卡片（水晶球/面具）完全不會跳彈窗、無屬性考驗訊息欄印出字面 "undefined"、考驗結果訊息在玩家按擲骰前就先寫進訊息欄（半透明彈窗背後看得到，等於爆雷）、考驗彈窗會蓋住有 20 秒倒數的道具介入彈窗
  - 後兩項 Important（爆雷時機、彈窗堆疊層級）屬於產品設計決策，agent 沒有自行拍板，改用 `AskUserQuestion` 請開發者確認：訊息延到按下確認才寫入、道具介入彈窗改更高層級，兩項都採納推薦選項
  - 一輪修正後複審，抓到修正本身的副作用：用佇列長度當 `key` 不夠精準，當同一次移動連續觸發兩個考驗時（例如離開房間考驗通過後開門到崩塌的房間），第二筆考驗推進佇列會誤觸發第一筆考驗的彈窗重新掛載，讓玩家已經看到一半的動畫/結果被打斷。技能流程原則上「不會有第二輪修正」，但這個新發現直接命中開發者最早要求的核心情境，主動跟開發者說明並詢問是否破例，開發者同意後多跑一輪小修正（改用每筆考驗自己的穩定 id 當 key，不再用佇列長度），複審確認乾淨
  - 最終整分支複審通過，後端測試 466/466、前端 build 全數通過，合併回 `main`（快轉合併）並推送，worktree 與分支清理完畢

**完成項目**：
- 統一考驗彈窗機制（`game:checkResolved`／`game:roomEntered` 廣播、`CheckModal.jsx` 兩階段彈窗、考驗佇列）與訊息欄可讀化＋24px 字體全部完成，已合併進 `main` 並推送
- leaveCheck／崩塌房間／卡片內建考驗三個原本互相獨立的機制，全部統一走同一套彈窗與訊息流程
- 全程 7 個任務＋1 次整分支審查＋2 輪修正審查，程式碼審查全數通過（466/466 測試、client build 乾淨）

**遇到瓶頸**：
- Task 1 的 implementer（haiku 模型）整檔重寫測試檔案導致 UTF-8 編碼／繁體中文亂碼，測試檔案無法解析卻自報全數通過——已修復並在後續任務的派工指示中加入「用 Edit 局部修改、不要整檔重寫、改完要驗證解析」的提醒，未再復發
- 手動瀏覽器測試因隨機抽卡/開門運氣不佳，始終沒能實機觸發真正的擲骰考驗彈窗流程，改用請整分支審查特別聚焦這條路徑的方式補強信心——事後證實這個判斷正確，該路徑確實藏著一個會讓核心功能（依序彈窗）失效的 Critical bug
- 整分支審查後新增的一輪小修正，嚴格來說超出 `subagent-driven-development` 技能「最多一輪修正」的預設流程，因為新發現的問題直接命中開發者最初的核心需求，主動說明利弊並取得開發者同意後才多跑一輪，沒有自行擅自決定
- 準備清理已合併的 worktree 資料夾時，第一次 `git worktree remove` 因為權限問題失敗——排查後發現是先前某個任務的 `socketHandlers.test.js` 測試（該檔案已知會留下未正常結束的非同步 handle）殘留了 2 個 node/jest 行程還佔用著 worktree 資料夾內的檔案控制代碼，用 `Get-CimInstance Win32_Process` 找出並用 PID 精準關閉後才清除成功，是這個專案第三次踩到同一類「worktree 清不掉」的問題，根因跟前兩次一樣

**開發者交代備忘事項**：
- 開發者已明確指示：本次審查記錄的 Minor 建議（共 6 項，見下方關鍵設定）列為下階段待辦事項，不在本階段處理
- 道具「給予」選項仍未實作（延續多階段的既有待辦）
- 暫時除錯框線仍未移除（延續多階段的既有待辦）
- 本階段沒有啟動任何長駐本機測試伺服器供開發者使用（controller 自行在 worktree 內啟動雙人瀏覽器驗證後已關閉），確認收工前系統無殘留 node 行程

## 2026-08-18 第 1 次工作階段

**當日工作內容**：
- 開發者「早安」開新階段，agent 確認模型身分並讀完 Handover，開發者指示「先處理上階段的minor建議」
- 逐項處理上階段整分支審查記錄的 6 項 Minor：①新增 leaveCheck＋崩塌房間同時觸發的組合測試（TDD，先確認 RED 再實作）②讓 `collapseResult` 也自己帶 `roomId`，兩邊 `game:checkResolved` 廣播改成都從各自 check 物件讀取（開發者確認方案後才動手）③死碼防呆依開發者指示維持現狀不動④`STAT_LABELS` 中文對照從 4 個檔案收斂到 `mapUtils.js`，`CharacterSelectScreen.jsx` 原本用陣列保留自己的顯示順序，只共用翻譯表本身⑤`useEffect` 閉包已確認實務安全不需要改⑥補齊走樓梯（`move_to_room` 效果）與崩塌房間跳下去這兩條路徑的 `game:roomEntered` 廣播，過程中發現並修正一個自己新增測試的 race condition（第一次移動的既有廣播被誤認成第二個動作的結果，看起來「通過」但其實是假的）
- 手動驗證階段（角色選擇畫面＋進房訊息）啟動本機伺服器時撞見不相關的既有問題：`data/cards/item-cards.json` 未提交且有語法錯誤（`CONTENT_DATA_LOAD_FAILED`）。依規則停下不自行修改，列出可能原因（開發者剛編輯完的內容）詢問後，開發者確認「先結束編輯，你進行修改並同步檢查其他欄位」——通讀整份檔案找出 9 處缺逗號的位置全部修正（純語法，內容不變），額外確認無重複 id、無其他結構性問題
- 全部完成後跑後端測試 469/469、client build 乾淨，雙人瀏覽器＋單人角色選擇畫面實機驗證過（字體/訊息/屬性對照皆正常），3 筆 commit 分別推送
- 開發者提出 3 項新任務：①整理 `rooms.json` 缺美術圖的房間、生成 prompt②③記錄兩項道具設計待討論事項（武器/消耗品分類缺口、道具合成機制）
- 執行任務①前先比對舊版 [2026-08-13-m2d3-room-art-prompts.md](superpowers/specs/2026-08-13-m2d3-room-art-prompts.md) 跟目前 `rooms.json`，發現 33 間缺圖房間裡有 10 間舊 prompt 仍有效、4 間舊 prompt 因房間資料變動已經失效、19 間是全新從未寫過的房間；另外發現 17 間 `doors:2` 房間完全沒有 `doorPattern`。如實把這個落差回報給開發者，不預設直接生成，等開發者裁示（缺 `doorPattern` 統一用 adjacent、10+新的合併成一份新文件、門數對不上的以現有 `rooms.json` 為準）後才動手
- 依開發者裁示：先幫 17 間房補上 `doorPattern:"adjacent"`（跑測試確認無誤），再撰寫合併後的新文件 [2026-08-18-room-art-prompts-remaining.md](superpowers/specs/2026-08-18-room-art-prompts-remaining.md)（33 間房間的完整 prompt，取代舊文件裡尚未生圖的部分），寫完用程式比對確認 33 間全數涵蓋、無遺漏無重複
- 任務②③直接記錄進 Handover 的「目前的瓶頸或停頓點」，不在本階段實作（架構決策不小，建議之後另開 brainstorming）
- 開發者接著提供一份精確的房間門數／樓層調整清單（16 間房間），逐一比對現況、執行 14 項實際修改（2 間手術室/鍋爐室確認現況已符合、無需改動），確認後跑測試（469/469）並提醒開發者：這 16 間裡有 14 間跟剛寫好的新 prompt 文件對不上了，開發者明確指示這次不修 prompt 文件，之後生圖前自己手動調整

**完成項目**：
- 統一考驗彈窗機制上階段的 6 項 Minor 建議：4 項修復、1 項維持現狀、1 項確認安全免修
- `data/cards/item-cards.json` 語法錯誤修正（9 處缺逗號）
- 33 間缺美術圖房間的 prompt 全數產出（新文件），17 間房間補上 `doorPattern` 預設值
- 16 間房間的門數／樓層依開發者最新規格更新完畢
- 道具設計待討論事項（武器/消耗品分類、道具合成機制）已記錄進 Handover

**遇到瓶頸**：
- 手動驗證時撞見開發者自己編輯中、尚未提交且有語法錯誤的 `item-cards.json`，依規則停下確認方向而非自行修改，確認後才動手且同步檢查了其他欄位
- 房間美術圖任務原本以為單純是「幫缺圖房間寫 prompt」，實際比對後發現範圍複雜得多（舊 prompt 部分仍有效、部分已過時、部分全新），如實回報落差讓開發者裁示範圍，而不是自己假設後直接生成一批可能有問題的內容
- 委託清理 worktree 遇到門數/樓層資料異動後，新寫好的 prompt 文件立即有 14 間對不上——這是本階段任務先後順序（先寫 prompt、後改門數）造成的必然結果，已如實提醒開發者，不自行決定要不要連帶修正 prompt 文件

**開發者交代備忘事項**：
- prompt 文件裡有 14 間房間的門框配置跟目前 `rooms.json` 對不上，開發者確認會在生圖時自己手動調整，不需要 agent 修正
- 道具設計待討論事項（武器/消耗品分類、道具合成機制）尚待開發者安排時間另開討論
- 道具「給予」選項仍未實作（延續多階段的既有待辦）
- 暫時除錯框線仍未移除（延續多階段的既有待辦）
- 本階段沒有啟動任何長駐本機測試伺服器供開發者使用，確認收工前系統無殘留 node 行程

