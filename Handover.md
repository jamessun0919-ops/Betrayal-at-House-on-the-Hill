# 交接文檔 Handover

最後更新：2026-08-01（第 1 次工作階段）

## 專案目標 (Project Goal)
將實體桌遊「山中小屋」(Betrayal at House on the Hill) 移植為可供多位使用者同時連線遊玩的網頁遊戲，兼具技術學習與朋友圈實際遊玩用途，並保留未來擴充原創劇本與 AI 玩家的彈性。

## 已完成進度 (Completed)
- 設計文件、MVP 里程碑拆分（M1-M4）、選定的兩個原版劇本，皆已確認（[spec 文件](docs/superpowers/specs/2026-07-31-web-multiplayer-design.md)）
- **M1（伺服器與大廳骨架）已全部完成並合併進 `main`**：[docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md](docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md)（PR [#1](https://github.com/jamessun0919-ops/Betrayal-at-House-on-the-Hill/pull/1)，已 merge）。5 任務全過＋全分支 final review 抓到並修好 1 個 Critical 崩潰 bug＋3 個 Important 穩健性問題。Jest 26/26 通過。已知非阻塞事項：`server/` 有一個 devDependency（Jest 依賴鏈上的 `brace-expansion`）npm audit high severity 漏洞，不影響正式環境，留給開發者決定是否處理。
- **M2（探索引擎）內容範圍已確認，正在整理真實遊戲資料，尚未寫實作計畫**：
  1. M2/M3 邊界：M2＝房間拼圖、移動、屬性、事件/道具/預兆卡抽取與效果解析器、**預兆計數**；M3＝鬼屋降臨觸發＋劇本外掛系統＋實作劇本1/10
  2. 內容範圍：只收錄劇本1〈神鬼痴漢〉、劇本10〈闔家團圓〉必須用到的房間/卡片，另外每類（事件卡/道具卡/預兆卡各+10，房間磚+10）加真實遊戲內容增加隨機性，不做全套內容抽取
  3. **地下室簡化（暫時性，完整版需復原）**：MVP 測試版不含地下室樓層；劇本需要的房間若原本是地下室房間，樓層屬性改為一樓
  4. 額外房間磚需排除「跟地下室有跨樓層互動關聯」的（如崩塌房間、秘密樓梯通往地下室），已排除：地下湖、地底深淵、地下墓穴、來自地下室的樓梯、酒窖
- **已建立內容資料檔（等待開發者填入實體卡片資料）**：
  - [data/rooms/rooms.json](data/rooms/rooms.json)（18 個房間：6 個劇本必用 + 12 個增加隨機性用）＋ [data/rooms/README.md](data/rooms/README.md)：`id`/`name`/`floor` 已填好，其中禮拜堂/圖書室/食品儲藏室/塔橋 4 間已從規則書查到效果文字填入；**`drawType`（進房要抽哪種牌）全部空白，需要開發者對照實體房間磚背面標示填入**
  - [data/cards/](data/cards)（`event-cards.json`／`item-cards.json`／`omen-cards.json`）＋ README：預兆卡已預填 13 個真實名稱（`text` 空白待填），事件卡/道具卡完全空白只留範例物件，**需要開發者對照實體卡片逐張填入內容**
  - 三份 PDF（規則書/生存者手冊/叛徒手冊）裡沒有事件卡/道具卡的完整內容庫，也沒有房間的樓層對照表（規則書提到這些在另一份未提供的附件【山中小屋 房間說明】裡），已跟開發者確認用這個「JSON 範本讓開發者自己填」的方式處理，不是我瞎猜/編造內容
- **已評估過、不採用的外部資源**：`Claude-Code-Game-Studios`（GitHub: donchitos/claude-code-game-studios）——整包遊戲工作室範本，技術棧/規模都跟本專案不符，已跟開發者說明並確認不採用

## 目前的瓶頸或停頓點 (Current Blocker/Status)
**卡住等開發者填資料**：M2 實作計畫需要真實內容才能寫（`writing-plans` skill 規定不能有佔位/編造內容），目前卡在等開發者對照實體卡片/房間磚，把 `data/cards/*.json` 的事件卡、道具卡內容，跟 `data/rooms/rooms.json` 的 `drawType` 欄位填完。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 只需讀 2026-08-01（今日）+ 2026-07-31（前一日）範圍
2. **確認開發者是否已經把 `data/cards/*.json`、`data/rooms/rooms.json` 的內容填完**：
   - 如果還沒填完：詢問開發者進度，看是否要先做其他事，或等填完再繼續
   - 如果已填完：先檢查資料格式正確（JSON 可解析、必填欄位沒有漏），有問題要跟開發者討論再繼續，不要自己猜著改
3. 資料確認無誤後，才開始撰寫 M2 詳細實作計畫（呼叫 `writing-plans` skill），計畫需以 M1 實際完成的程式碼介面為基礎延伸：
   - `LobbyManager` 現有方法（`createRoom`/`joinRoom`/`leaveRoom`/`getPlayers`/`findRoomByPlayerId`）
   - Socket.IO 事件命名慣例（`lobby:xxx` 前綴、`ack(callback)` 防呆模式、`socket.data.roomCode`/`socket.data.playerId` 儲存方式）——final review 已明確指出 M2 新增的遊戲事件應該延用同一套防呆/驗證模式，寫進 M2 的 Global Constraints
   - `client/src/LobbyScreen.jsx` 既有的 `ERROR_MESSAGES`/`translateError` 繁中錯誤訊息機制，新錯誤碼擴充同一個 lookup

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；純 JavaScript，不使用 TypeScript；單一程式碼庫同時支援區網與雲端部署
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**
- **內容擴充架構**：房間/卡牌效果採宣告式資料驅動；鬼屋劇本與角色能力透過「劇本模組」/「角色模組」外掛介面擴充（`manifest.json` + `logic.js` 掛勾函式），詳見 spec 第 4、8、9 節
- **MVP 兩個劇本**：劇本1〈神鬼痴漢 The Mummy Walks〉、劇本10〈闔家團圓 Family Gathering〉
- **未來階段**：Phase 2 為 AI 玩家（呼叫 Claude API 決策）；Phase 3+ 為原創劇本（兇案解謎/密室逃脫主題），**且需要把 M2 的地下室簡化、內容抽取範圍縮減都復原成完整版**
- **PDF 內容抽取**：用 `pymupdf`（`import fitz`），不要用 `pypdf`（會產生亂碼）。抽取結果不進版控，只有結構化 JSON 遊戲資料（`data/` 資料夾）才進版控
- **版權**：規則書/卡牌內容屬 Hasbro/Avalon Hill 版權，僅供私人非商業用途，PDF 原檔已列入 `.gitignore`
- **語言偏好**：與開發者對話一律使用繁體中文
- **Worktree 慣例**：`subagent-driven-development` 執行每個里程碑（M1、M2...）都應該開獨立 worktree/分支，完成後開 PR 合併回 `main`；`main` 分支保持乾淨可執行
- **收工流程**：每階段收工前需生成/更新 worklog、chatlog、Handover，並推送至 GitHub repo；需確認本次 session 自行啟動的本機伺服器已關閉——**本階段未啟動任何伺服器，無需處理**
