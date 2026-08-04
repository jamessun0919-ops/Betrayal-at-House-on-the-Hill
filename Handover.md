# 交接文檔 Handover

最後更新：2026-08-04（第 1 次工作階段）

## 專案目標 (Project Goal)
將實體桌遊「山中小屋」(Betrayal at House on the Hill) 移植為可供多位使用者同時連線遊玩的網頁遊戲，兼具技術學習與朋友圈實際遊玩用途，並保留未來擴充原創劇本與 AI 玩家的彈性。

## 已完成進度 (Completed)
- 設計文件、MVP 里程碑拆分（M1-M4）、選定的兩個原版劇本，皆已確認（[spec 文件](docs/superpowers/specs/2026-07-31-web-multiplayer-design.md)）
- **M1（伺服器與大廳骨架）已全部完成並合併進 `main`**：[docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md](docs/superpowers/plans/2026-07-31-m1-server-lobby-skeleton.md)（PR [#1](https://github.com/jamessun0919-ops/Betrayal-at-House-on-the-Hill/pull/1)，已 merge）
- **M2（探索引擎）內容範圍已確認**：M2/M3 邊界＝M2 房間拼圖/移動/屬性/卡片抽取/預兆計數，M3 鬼屋降臨＋劇本外掛＋劇本1/10；內容資料已全部由開發者填完（[data/rooms/rooms.json](data/rooms/rooms.json) 31筆含 `doors`、[data/cards/](data/cards/) 三類卡片）；兩份核心設計參考文件（[card-mechanics-reference.md](docs/superpowers/specs/2026-08-01-card-mechanics-reference.md)、[turn-flow-and-action-points.md](docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md)）
- **M2 拆成三個子計畫依序執行**（M2a/M2b/M2c，是 M2 內部分階段）：
  - **M2a：遊戲核心狀態＋房間版圖系統 —— 已完成並合併進 `main`**（commit range `fa7f493..559884d`）：`contentLoader.js`、`doorLayout.js`、`boardGenerator.js`、`playerEntity.js`（刻度制屬性）、`gameState.js`
  - **M2b：提問協定＋回合流程 —— 已全部完成並合併進 `main`**：
    - 設計文件：[docs/superpowers/specs/2026-08-02-m2b-turn-flow-design.md](docs/superpowers/specs/2026-08-02-m2b-turn-flow-design.md)
    - **M2b-1（核心邏輯模組）**（commit range `2aa45df..0dd7b22`）：[docs/superpowers/plans/2026-08-02-m2b1-core-game-logic.md](docs/superpowers/plans/2026-08-02-m2b1-core-game-logic.md)——`roomDeck.js`（樓層感知牌庫，抽到不符樓層放回牌底重抽）、`promptState.js`（純邏輯提問狀態機，`now`/計時器由呼叫端注入）、`characterSelection.js`、`gameManager.js`、`turnFlow.js`（樓梯免費、`advanceTurn` 自動重設行動力、全動作驗證 turn ownership）
    - **M2b-2（Socket.IO 事件層整合＋除錯測試頁面）**：[docs/superpowers/specs/2026-08-04-m2b2-socket-integration-design.md](docs/superpowers/specs/2026-08-04-m2b2-socket-integration-design.md) / [計畫](docs/superpowers/plans/2026-08-04-m2b2-socket-integration.md)——5 任務全數完成，`subagent-driven-development` 執行，已合併進 `main`：
      - 選角色階段狀態放在新建、用完即丟的 `server/src/game/characterSelectionManager.js`（`{selections: Map()}`，`startSelection`/`getSelection`/`endSelection`），**不**擴充 `GameManager`；`gameState` 本身沒有 `promptState` 欄位（YAGNI，M2b-1/M2b-2 都不需要）
      - `server/src/lobbyManager.js` 新增 `hostPlayerId`/`isHost`
      - `server/src/socketHandlers.js` 大幅擴充：`game:startCharacterSelect`（房主觸發）、`game:promptRespond`、`game:move`/`game:selectAction`/`game:useStairs`（回合動作，成功後廣播 `game:stateUpdate`）、`game:pendingCardDraw`/`game:pendingAction`（**獨立廣播的 hook point**，非併入通用狀態廣播）；`setTimeout` 逾時排程直接寫在 `socketHandlers.js`（per-`registerSocketHandlers`-call 的 `characterSelectTimeouts` Map，非模組層級單例）
      - 新增階段防護：`lobby:join` 若該房已開始選角或已開局回傳 `ROOM_IN_PROGRESS`；重複 `game:startCharacterSelect` 回傳 `GAME_ALREADY_STARTED`；`finishCharacterSelection` 用凍結的 `characterSelectionState.order` 組遊戲名單（不是即時大廳名單）
      - `client/src/DebugGameScreen.jsx`（新）＋ `client/src/LobbyScreen.jsx`（除錯模式入口）
      - `turnFlow.js` 的 `selectAction(gameState, playerId, actionType)` 目前只回傳 `{kind: actionType, pending: true}`——**沒有任何關聯/correlation id**，M2c 若要做「等玩家回應才解析」的模式，這裡的回傳簽名需要擴充
  - **M2c：卡牌牌庫＋效果解析器 —— 設計討論已完成並定案，尚未寫成 spec 文件**（見下方「下一步行動」）
- **角色資料範本**：[data/characters/characters.json](data/characters/characters.json)（6 個佔位角色位置）＋ [README](data/characters/README.md)，開發者尚未填寫真實內容
- **已評估過、不採用的外部資源**：`Claude-Code-Game-Studios`——技術棧/規模都跟本專案不符，已確認不採用

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無設計層面阻塞。M2b（M2b-1+M2b-2）已完整合併進 `main`。M2c 的架構討論已經跟開發者逐項確認完畢（見下），但**設計 spec 文件本身還沒寫**——這是下一階段的第一件事，不是新的設計討論。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 只需讀 2026-08-04（今日）+ 2026-08-03（前一日）範圍
2. **把 M2c 討論定案的內容寫成完整設計 spec 文件**（`docs/superpowers/specs/2026-08-0X-m2c-card-effect-resolver-design.md`），涵蓋下方「M2c 已定案的架構決策」全部內容，自我審查（placeholder/一致性/範圍/模糊性掃描）後給開發者看過確認，才進入 `writing-plans`
3. 因為規模跟 M2b 相當，計畫階段預期會拆成：**M2c-1**（純邏輯模組，可獨立單元測試）→ **M2c-2**（Socket 整合）→ **M2c-3**（36 張卡片的實際 effects 內容，agent 草擬、開發者審核修正）——這個拆分已經跟開發者確認過，寫計畫時直接照拆，不用重新問
4. 每份後續計畫（M2c-2 尤其）要等前一份完成、以其實際完成的程式碼介面為基礎撰寫，不要用假設的介面

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；純 JavaScript，不使用 TypeScript；單一程式碼庫同時支援區網與雲端部署
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**
- **輸入驗證慣例（M2a 確立，沿用至今）**：所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串，不可靜默失敗；優先於計畫文件裡附的參考程式碼，不需要每次都重新跟開發者確認
- **角色屬性是刻度制，不是連續整數**：`track`/`currentIndex`/`baseIndex`/`skullIndex`，M2c 卡片效果、M3 戰鬥都要延用這個模型
- **回合機制關鍵慣例（M2b-1 確立）**：樓梯移動免費、`advanceTurn` 自動重設行動力、所有回合內動作都要驗證 turn ownership
- **「架構性缺口」vs「防呆修正」的處理原則**：最終審查發現的問題如果只是輸入驗證/防呆類（有明確既有慣例可套用）可以直接修正不用問；如果牽涉新的遊戲規則/架構設計決策，必須先跟開發者確認方向（M2b-1 的樓層機制、M2b-2 的 `ROOM_IN_PROGRESS` 規則都是後者的實際案例）
- **M2c 已定案的架構決策（下階段寫 spec 文件時直接採用，不用重新討論）**：
  - **框架範圍**：先建完整的擲骰修改器管線（`onBeforeRoll`/`onAfterRoll`/`onEventCardCheck`）、持續性標記（buff/debuff）、多階梯骰值結果這些基礎框架；`onAttack`/`onDamageTaken` 這類戰鬥專屬 hook **留給 M3**（戰鬥系統還不存在）
  - **自訂骰子面值是 0/0/1/1/2/2**（開發者親自更正過，不是 0/0/0/1/1/2，之前的對話摘要曾誤記過一次）
  - **pendingPrompt 狀態放在新建的獨立 `effectResolverManager.js`**（`{resolvers: Map()}`，仿 `characterSelectionManager` 的結構），**不**在 `gameState` 上加欄位；生命週期跟 `gameState` 一致（`finishCharacterSelection` 呼叫 `startGame` 時同時建立，目前專案還沒有「遊戲結束」事件，跟 `gameManager` 一樣沒有明確 teardown，這不是新缺口）
  - **抽卡觸發方式**：伺服端在 `game:move` 處理內偵測到 `pendingCardDraw` 後，**同一個處理流程直接自動觸發抽卡＋解析效果**（不需要客戶端另外發事件請求抽卡）；若效果需要玩家選擇，才在 `effectResolverManager` 建立 pendingPrompt 暫停，否則當場解析完成
  - **事件/道具/預兆牌庫抽空時**：比照房間磚牌庫「跳過對應步驟，視為無事發生」，**不做棄牌堆重洗機制**（牌少，很快會抽完，先簡化）
  - **卡牌內容分工**：36 張非戰鬥卡的實際 `effects` 陣列內容由 agent 依 `card-mechanics-reference.md` 草擬 JSON，開發者審核修正（跟 M2a/M2b 的房間/角色數值「開發者自己手填」模式不同——這次因為是聲明式 schema 轉換，agent 先草擬）
  - **模組切分**：`cardDeck.js`（比照 `roomDeck.js` 的 throw 慣例，抽空拋 `CARD_DECK_EMPTY`，呼叫端先用 `hasCards(deck)` 判斷跳過）、`effectPipeline.js`（擲骰＋修改器套用＋多階梯比對，純函式）、`modifiers.js`（`attachModifier`/`removeModifier`/`checkRemoveConditions`，`entity.modifiers` 陣列 lazy init，可套用在玩家或房間物件上，不改動 `boardGenerator.js` 的房間結構）、`effectResolver.js`（讀 `effects` 陣列依序執行，遇到 `choice` 型別暫停等玩家回應）、`effectResolverManager.js`
  - **效果 JSON 語法**：`dice_check`（`stat`+`tiers`，`min`/`max`/`effects`，上到下比對第一個符合的）、`stat_change`（`delta` 或 `restoreToBase:true`）、`grant_item`/`lose_item`、`persistent_modifier`（`appliesTo:"player"|"room"`＋`removeWhen`，開放詞彙：`meetsAnotherPlayer`/`holdsItem`(`itemId`)/`leavesRoom`(暫定)）、`peek_and_reorder`（水晶球/通靈板類）、`choice`（暫停等玩家選擇，`options`，選完套用被選中的 `effects`）
  - **新增 Socket 事件**（沿用「獨立發射、提早準備接口」慣例）：`game:cardDrawn`（廣播，抽卡動作實際發生）、`game:effectPendingChoice`（廣播，效果解析卡在需要玩家選擇）、`game:effectPromptRespond`（client→server，回應選擇）、`game:effectResolved`（廣播，一張卡效果全部跑完）
  - **任務拆分**：M2c-1（純邏輯，可獨立單元測試）→ M2c-2（Socket 整合：`effectResolverManager.js`＋`socketHandlers.js` 接線＋除錯頁面擴充）→ M2c-3（36 張卡片實際內容）
  - `playerEntity.js` 目前沒有 inventory 增減函式（`player.inventory` 只是空陣列），`grant_item`/`lose_item` 效果需要新增對應函式——寫 spec 時要決定放在 `playerEntity.js`（延續現有模組邊界）還是別處
- **MVP 兩個劇本**：劇本1〈神鬼痴漢 The Mummy Walks〉、劇本10〈闔家團圓 Family Gathering〉
- **未來階段**：Phase 2 為 AI 玩家（呼叫 Claude API 決策，選角色順序排真人之後、數量不可超過真人數量）；Phase 3+ 為原創劇本，需要把 M2 的地下室簡化、內容抽取範圍縮減都復原成完整版
- **PDF 內容抽取**：用 `pymupdf`（`import fitz`），不要用 `pypdf`。抽取結果不進版控，只有結構化 JSON 遊戲資料（`data/` 資料夾）才進版控
- **版權**：規則書/卡牌內容屬 Hasbro/Avalon Hill 版權，僅供私人非商業用途，PDF 原檔已列入 `.gitignore`
- **語言偏好**：與開發者對話一律使用繁體中文
- **Worktree 慣例**：`subagent-driven-development` 執行每個里程碑都應該開獨立 worktree/分支，完成後合併回 `main`；`main` 分支保持乾淨可執行
- **資料檔案編輯注意事項**：開發者有時會直接編輯工作目錄裡的 `data/` 檔案而不透過 git commit——如果在 worktree 外的主目錄工作，記得檢查 `git status` 是否有未提交的內容資料變更，跟功能程式碼分開單獨 commit
- **大型計畫拆分**：單一里程碑若預估任務數明顯超過前一個里程碑，要主動跟開發者確認是否拆成多份計畫，拆分後的後續計畫要等前一份完成、以其實際程式碼介面為基礎撰寫
- **測試競態的處理先例**：`game:prompt` 這類房間廣播事件，測試裡等待「下一次廣播」時若只用單一 client 的 `.once`，可能誤收到還在飛行中的前一次廣播——這個問題在 M1、M2b-2 的 Task 3/Task 4 都各自出現過，已確立的修法是 `Promise.all` 等所有相關 client 的 `.once` 都先收到第一次廣播再繼續；同類問題以後不用再問，直接套用
- **收工流程**：每階段收工前需生成/更新 worklog、chatlog、Handover，並推送至 GitHub repo；chatlog 同一天多次工作階段要併在同一個日期檔案裡（用「## 第 N 次工作階段」分節，段落用三級標題），不同天則各自開新檔；需確認本次 session 自行啟動的本機伺服器已關閉——**本階段未啟動任何長駐伺服器，worktree 測試殘留的 2 個 jest 程序已於階段中診斷並關閉**
