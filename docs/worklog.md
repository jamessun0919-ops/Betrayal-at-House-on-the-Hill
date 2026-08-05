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

