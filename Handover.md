# 交接文檔 Handover

最後更新：2026-08-01（第 2 次工作階段）

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
- **內容資料檔進度**：
  - [data/rooms/rooms.json](data/rooms/rooms.json)（目前 31 筆，開發者陸續新增房間中）＋ README：`id`/`name`/`floor`/`drawType` 開發者已填完；已知效果的房間（禮拜堂/圖書室/食品儲藏室/健身房）已填 `effects`；塔橋/保險庫/雜亂的房間/藤蔓糾纏的溫室是多步驟機制，標記 `needsCustomLogic: true`；新增 `description` 欄位（角色首次進入房間顯示的場景敘述，跟機制 `text` 分開），目前全部留白等開發者填
  - [data/cards/omen-cards.json](data/cards/omen-cards.json)：**13 張已全部由開發者填完真實內容**。⚠️ 修正先前的錯誤判斷：預兆卡並不是「內容單純、系統行為統一」，每張都有獨特效果
  - [data/cards/item-cards.json](data/cards/item-cards.json)：**12 張已由開發者填完真實內容**（另有 2 筆空白項目待開發者決定用途或刪除）。道具卡幾乎都是「有觸發時機的主動能力」（擲骰前/後、攻擊時、受傷時等），跟預兆卡的「持有被動加成」不同
  - [data/cards/event-cards.json](data/cards/event-cards.json)：**11 張已由開發者填完真實內容**。「駭人尖叫」原本誤寫成影響所有房間，已依開發者確認修正為只影響同房間
  - `item-cards.json` 已補上 `description` 欄位（跟房間/事件卡一致），目前留白待填
  - **`item-cards.json`／`event-cards.json` 留的空白項目是刻意保留**，方便開發者之後複製貼上格式繼續填，不是誤植，不用刪除
  - **全部 36 張已填內容的卡片（13 預兆+12 道具+11 事件）目前都標記 `needsCustomLogic: true`**：因為幾乎每張都遇到「肉體/精神損傷」這個還沒設計的傷害系統缺口，或是全域效果/持續性標記/多階骰結果這類尚未支援的機制——詳見下方參考文件
  - 三份 PDF 沒有事件卡/道具卡的完整內容庫，也沒有房間樓層對照表，已跟開發者確認用「JSON 範本讓開發者自己填」處理
  - **用詞已全專案統一**（`data/` 資料夾 + spec 文件，不含歷史 worklog/chatlog）：「作祟」→「邪祟」、「奸徒」→「叛徒」、「神智/神志/理智」→「意志」、「檢定」→「考驗」
  - **卡牌/房間文字的人稱慣例**：內文一律用「玩家」不用「你」；若代換後語意會混淆，要先跟開發者確認怎麼改寫，不要自己決定
- **卡片機制衍生的特殊系統，已整理成獨立參考文件**：[docs/superpowers/specs/2026-08-01-card-mechanics-reference.md](docs/superpowers/specs/2026-08-01-card-mechanics-reference.md)——彙整預兆卡+道具卡+事件卡（三種卡片都已整理完）內容揭露的機制模式共 17 項（觸發時機系統、持有中被動加成、不可轉移旗標、穿戴切換、牌堆偷看重排、消耗次數系統、目標選擇同房/全域、回復基本值、情境限定加骰、範圍攻擊與免疫、攻擊/傷害型態轉換、反噬風險、玩家主動選屬性、附著於玩家/房間的持續性標記、多階骰結果、無屬性純骰數判定），含 M2/M3 分工建議與**「AI主持人代勞」設計原則**。**這份文件也是之後設計原創劇本/卡片時遇到新機制的第一個參考來源**
- **⚠️ 傷害系統是目前最大的設計缺口**：「肉體損傷」「精神損傷」在三種卡片裡大量出現，但還沒定案要怎麼影響屬性（降哪個/哪幾個屬性、降多少），這是 M3 詳細設計時要優先定案的模型，定案前所有牽涉「損傷」的卡片效果都先標記 `needsCustomLogic: true`
- **已評估過、不採用的外部資源**：`Claude-Code-Game-Studios`（GitHub: donchitos/claude-code-game-studios）——整包遊戲工作室範本，技術棧/規模都跟本專案不符，已跟開發者說明並確認不採用

## 目前的瓶頸或停頓點 (Current Blocker/Status)
**三種卡片內容都已填完（預兆13/道具12/事件11），但還有收尾細節**：`rooms.json` 的 `description` 欄位還沒填；`item-cards.json`、`event-cards.json` 各有 1-2 筆空白項目待確認用途；`item-cards.json` 缺 `description` 欄位（跟房間/事件卡不一致）。更重要的是，M2 的效果詞彙/資料格式需要依 [card-mechanics-reference.md](docs/superpowers/specs/2026-08-01-card-mechanics-reference.md) 列出的 17 種機制模式擴充，且傷害系統（肉體/精神損傷）的模型還沒定案——這些都要先跟開發者討論定案，才能開始寫 M2 實作計畫（`writing-plans` skill 規定不能有佔位/編造內容）。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 只需讀 2026-08-01（今日）+ 2026-07-31（前一日）範圍
2. **收尾資料細節**：跟開發者確認 `rooms.json` 的 `description`、`item-cards.json`/`event-cards.json` 的空白項目、`item-cards.json` 補 `description` 欄位這幾件事要不要現在處理
3. **跟開發者討論 `card-mechanics-reference.md` 列出的機制模式要怎麼設計成具體的資料格式與程式介面**，尤其是傷害系統模型（肉體/精神損傷分別影響哪個/哪些屬性、多少）——這是目前最大的未定案項目
4. 資料與效果詞彙都確認無誤後，才開始撰寫 M2 詳細實作計畫（呼叫 `writing-plans` skill），計畫需以 M1 實際完成的程式碼介面為基礎延伸：
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
