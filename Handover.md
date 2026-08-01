# 交接文檔 Handover

最後更新：2026-08-01（第 3 次工作階段）

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
- **兩份核心設計參考文件已完成，M2/M3 需要的規則設計大致齊全**：
  - [docs/superpowers/specs/2026-08-01-card-mechanics-reference.md](docs/superpowers/specs/2026-08-01-card-mechanics-reference.md)：卡片機制模式（17項）、**傷害系統（已定案：物理傷害扣力量/速度、精神傷害扣知識/意志，邪祟前不死）**、**戰鬥規則（M3：同房攻防對擲、平手無事、偷竊條件、攻擊分兩層選擇—先選攻擊屬性再選武器）**、**觸發時機分類表（36張卡全部分類完，含哪些卡是「同時機點擇一使用」）**、多階骰結果的門檻陣列格式、持續性標記/buff-debuff通用機制（`removeWhen` 可擴充詞彙）
  - [docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md](docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md)（**新文件**）：核心回合流程狀態機——行動力＝當下速度值，第一層20秒選「移動/道具/襲擊/操作」逾時放棄本回合，選道具/襲擊/操作會再跳第二層20秒選具體項目且不可返回上一步（防止拖延漏洞），移動含開門判斷，開門後行動力歸零；沒有主動結束回合按鈕（逾時即表態）；傷害分配逾時的預設規則。**「操作」專指房間本身觸發的機制（如保險庫），面具/魔術方塊這類卡片主動能力歸在「道具」選項下，不是「操作」**（開發者已更正這點）。設計上刻意讓這些參數（20秒、行動力算法）可被劇本模組覆寫，保留原創劇本調整回合流程的彈性
  - 房間門/連接系統：`rooms.json` 新增 `size`（固定`"1x1"`）與 `doors`（1~4，開發者手動填，目前 `null`）欄位；門的實際朝向由引擎動態計算（進入方向必有門＋剩餘隨機＋衝突旋轉＋四向都衝突就強制對齊、其餘當牆）
- **已評估過、不採用的外部資源**：`Claude-Code-Game-Studios`（GitHub: donchitos/claude-code-game-studios）——整包遊戲工作室範本，技術棧/規模都跟本專案不符，已跟開發者說明並確認不採用

## 目前的瓶頸或停頓點 (Current Blocker/Status)
規則設計已大致完備（傷害系統、戰鬥、回合流程、房間連接都定案）。還剩收尾資料細節：`rooms.json` 的 `doors` 欄位還沒填（`description` 欄位開發者說可暫時略過，不用管）。**技術上還沒決定的是：怎麼把「20秒彈窗詢問玩家」這種互動模式，具體轉成 Socket.IO 事件設計**——這是 M1 只有簡單請求/回應模式（`lobby:create`等）沒遇過的新通訊型態，**開發者指定下一階段工作就是討論這個**。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 只需讀 2026-08-01（今日）+ 2026-07-31（前一日）範圍
2. **一開始先檢查 `data/rooms/rooms.json` 的 `doors` 欄位是否還是 `null`，如果是，提醒開發者補上**（開發者要求每次階段開始都要檢查提醒；`description` 欄位不用提醒，開發者說可以先略過）
3. **開發者指定的下一步：討論「20秒彈窗詢問」怎麼設計成 Socket.IO 事件**（例如伺服器 emit 一個帶 `deadline` 的 prompt 事件給特定玩家、玩家端倒數並送出選擇或逾時預設值）——規則設計都定案了，這是最後的技術設計討論
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
