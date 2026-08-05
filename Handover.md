# 交接文檔 Handover

最後更新：2026-08-05（第 1 次工作階段）

## 專案目標 (Project Goal)
將實體桌遊「山中小屋」(Betrayal at House on the Hill) 移植為可供多位使用者同時連線遊玩的網頁遊戲，兼具技術學習與朋友圈實際遊玩用途，並保留未來擴充原創劇本與 AI 玩家的彈性。

## 已完成進度 (Completed)
- 設計文件、MVP 里程碑拆分（M1-M4）、選定的兩個原版劇本，皆已確認（[spec 文件](docs/superpowers/specs/2026-07-31-web-multiplayer-design.md)）
- **M1（伺服器與大廳骨架）已全部完成並合併進 `main`**：PR [#1](https://github.com/jamessun0919-ops/Betrayal-at-House-on-the-Hill/pull/1)，已 merge
- **M2（探索引擎）內容範圍已確認**：M2/M3 邊界＝M2 房間拼圖/移動/屬性/卡片抽取/預兆計數，M3 鬼屋降臨＋劇本外掛＋劇本1/10；內容資料已全部由開發者填完（[data/rooms/rooms.json](data/rooms/rooms.json) 31筆、[data/cards/](data/cards/) 三類卡片）；兩份核心設計參考文件（[card-mechanics-reference.md](docs/superpowers/specs/2026-08-01-card-mechanics-reference.md)、[turn-flow-and-action-points.md](docs/superpowers/specs/2026-08-01-turn-flow-and-action-points.md)）
- **M2 拆成子計畫依序執行**（M2a/M2b/M2c，是 M2 內部分階段；M2c 又再細分 M2c-1~M2c-5，見下方「下一步行動」）：
  - **M2a：遊戲核心狀態＋房間版圖系統 —— 已完成並合併進 `main`**：`contentLoader.js`、`doorLayout.js`、`boardGenerator.js`、`playerEntity.js`（刻度制屬性）、`gameState.js`
  - **M2b：提問協定＋回合流程 —— 已全部完成並合併進 `main`**（M2b-1 核心邏輯、M2b-2 Socket 整合＋除錯頁面）：`roomDeck.js`、`promptState.js`、`characterSelection.js`/`characterSelectionManager.js`、`gameManager.js`、`turnFlow.js`（樓梯免費、`advanceTurn` 自動重設行動力）、`lobbyManager.js`（host 追蹤）、`socketHandlers.js` 選角色與回合事件、`DebugGameScreen.jsx`
  - **M2c：卡牌牌庫＋效果解析器**：
    - 設計文件：[docs/superpowers/specs/2026-08-05-m2c-card-effect-resolver-design.md](docs/superpowers/specs/2026-08-05-m2c-card-effect-resolver-design.md)
    - **M2c-1（純邏輯模組）—— 已完成並合併進 `main`**：[計畫](docs/superpowers/plans/2026-08-05-m2c1-card-effect-core-logic.md)，7 任務全數完成（inline execution）——`cardDeck.js`、`effectPipeline.js`（自訂骰面 **0/0/1/1/2/2**）、`modifiers.js`、`effectResolver.js`（`stat_change`/`grant_item`/`lose_item`/`persistent_modifier`/`dice_check`/`choice`；`peek_and_reorder` 故意留 `UNSUPPORTED_EFFECT_TYPE`，等有實際卡片需求再補）、`playerEntity.js` 新增 `addItem`/`removeItem`
    - **M2c-2（Socket 整合）—— 已完成並合併進 `main`**：[計畫](docs/superpowers/plans/2026-08-05-m2c2-socket-integration.md)，7 任務全數完成（inline execution）＋獨立整分支審查（見下方「除錯注意事項」）——`effectResolverManager.js`（`{promptState, pendingChoice}`，生命週期跟 `gameState` 一致）、`gameState.js`/`gameManager.js` 擴充事件/道具/預兆牌庫、`socketHandlers.js` 的 `game:move` 自動抽卡解析、`game:effectPromptRespond`＋真實逾時計時器、除錯頁面顯示。**移除**了 M2b-2 的 `game:pendingCardDraw` 廣播，改用 `game:cardDrawn`/`game:effectResolved`/`game:effectPendingChoice`
    - **M2c-4/M2c-5（道具/操作動作接線＋邪祟考驗機制）—— 6 任務全數完成（inline execution），在分支 `worktree-m2c4-m2c5-action-and-haunt` 上，測試全綠（288/288），尚未合併進 `main`、尚未經過獨立審查**：[spec](docs/superpowers/specs/2026-08-05-m2c4-m2c5-action-and-haunt-design.md)、[計畫](docs/superpowers/plans/2026-08-05-m2c4-m2c5-action-and-haunt.md)——`item-cards.json`/`omen-cards.json` 補 `category`（武器/消耗品/一般）/`canTargetOthers` 欄位（agent 草擬第一版，開發者尚未審核修正）、`effectResolver.js` 新增 `appliedCount` 回傳值、`turnFlow.js` 的 `selectAction` 接上道具/操作真實邏輯、`socketHandlers.js` 的 `cardId`→`sourceId` 改名（`game:cardDrawn` 例外保留 `cardId`）＋`consumeItemIfApplied` 參數、`game:selectAction` 接上真實效果解析、`resolveCardDraw` 加入邪祟考驗
    - **M2c-3（36 張卡片＋房間操作類 effects 內容）—— 尚未開始**（範圍已擴充，見下方）
- **角色資料範本**：[data/characters/characters.json](data/characters/characters.json)（6 個佔位角色位置），開發者尚未填寫真實內容
- **已評估過、不採用的外部資源**：`Claude-Code-Game-Studios`——技術棧/規模都跟本專案不符

## 除錯注意事項 (Debug Notes — 審查發現的問題與後續慣例)

**這一節記錄審查發現過的架構性錯誤，以及由此確立的通用慣例。任何開工前都應該先讀這一節，避免同類錯誤重複發生。**

**通用介面約定（往後所有里程碑都要遵守，不是 M2c-2 專屬）**：
任何會讓某個動作的效果解析「暫停等待玩家選擇」的流程（卡片 `choice` 效果、預兆/事件卡效果、道具/房間操作效果、未來 M3 戰鬥的傷害分配選擇等），在該選擇被實際解決（玩家回應，或逾時採用預設值）之前，**不可以呼叫任何會推進遊戲狀態的動作**（例如換下一位玩家的回合）。已確立的實作模式（見 `server/src/socketHandlers.js` 的 `hasPendingEffectChoice`/`EFFECT_CHOICE_IN_PROGRESS`）：
1. 任何會推進狀態的新動作，執行前先檢查該房間是否有未解決的選擇，有的話直接拒絕（回傳 `XXX_IN_PROGRESS` 類錯誤），不要讓新動作跟未解決的選擇擦身而過
2. 觸發選擇的原始動作本身**先不要**呼叫推進狀態的函式；改成把「推進狀態」延後到選擇真正解決（玩家回應、或逾時採用預設值）的那個 callback 裡才呼叫
3. 解析效果的呼叫要包一層 try/catch，避免任何一次效果解析拋錯就連帶讓「推進狀態」跟「廣播最新狀態」這兩件事被跳過

**M2c-2 最終獨立審查發現的實際案例（供未來同類流程參考）**：
- **Critical（已修復，`986fb64`）**：`game:move` 抽卡後，效果卡在 `choice` 提問未解決時，仍然無條件呼叫 `advanceTurnIfOver` 把回合交給下一位玩家。下一位玩家若立刻又抽到一張需要選擇的卡，會撞上 `promptState` 的「同時只能有一個待處理提問」限制而拋錯，例外進而讓收尾動作（推進回合、廣播狀態）整個被跳過——房間永久卡死，無法自我恢復。已用上述通用模式修復，並補了 item／event／omen 三種牌庫各自的實測回歸測試（`8d91e40`），不是只驗證 item 牌庫就假設其他兩種也對。
- **Important（已修復）**：未知的 `drawType`（房間資料打字錯誤等）原本會讓效果解析拋出未分類的原始 `TypeError`，而非專案慣例的 `UPPER_SNAKE_CASE Error`，且同樣會觸發上面的死鎖路徑——現在拋 `UNKNOWN_DECK_TYPE`，並且被 try/catch 保護，不會讓房間卡死。
- **M2c-4 已依此模式實作**：「道具」「操作」這兩個 `selectAction` 動作接上真實邏輯，需要玩家選擇的效果一律沿用 `pendingChoice`/`EFFECT_CHOICE_IN_PROGRESS` 機制，沒有另外設計一套
- **確認的規則（M2c-4 Task 5 執行期間跟開發者確認）**：進入新房間（開門）會讓行動力直接歸零，回合立刻結束——同一回合內不可能再有行動力觸發「操作」（`room_action`），必須等到該玩家下一次輪到行動才能在該房間操作／考驗。但**進房間自動觸發的卡片效果（抽卡）不受此限**，仍然必須解析完（含玩家選擇）才能結束回合，這是既有慣例，兩者是不同機制，不要混淆
- **M3 戰鬥階段的傷害分配**（依 [card-mechanics-reference.md](docs/superpowers/specs/2026-08-01-card-mechanics-reference.md)：肉體傷害在 might/speed 間自由分配、精神傷害在 knowledge/sanity 間自由分配，逾時預設平均分配）是同一種「需要玩家做選擇才能繼續」的模式，M3 設計戰鬥系統時要直接沿用這套機制，不要重新發明
- **Important（記錄為 M2c-3 才會浮現的缺口，不是實作偏差）**：`modifiers.js` 的 `checkRemoveConditions`（buff/debuff 移除判斷）目前在 `src/` 裡完全沒有呼叫點，只有測試用到。等 M2c-3 真的填入 `persistent_modifier` 卡片內容，任何持續性標記都會變成永久 buff，除非在那之前先接上呼叫點

**環境問題（M2c-4/M2c-5 執行期間發現）——`server/test/socketHandlers.test.js` 執行後 Jest 進程不會自然結束**：用 `-t` 篩選單一測試（例如 `npx jest test/socketHandlers.test.js -t "..."`）時，測試本身 1 秒內就跑完並印出正確結果，但 Jest 之後會卡住印出 `Jest did not exit one second after the test run has completed. ... asynchronous operations that weren't stopped`，導致包住它的 shell 指令永遠不會回傳（背景執行也一樣，指令本身「完成」但底層 node 進程持續存活）。已重複驗證兩次，結果一致，確認是這個測試檔案既有的非同步 handle（很可能是 socket.io client/server 或計時器）未關閉的問題，跟任何一次程式改動無關。**後續在這個檔案（或整個 `server` 測試套件）上跑測試時的因應方式**：加上 `--forceExit` 旗標（例如 `npx jest --forceExit`）即可正常在數秒內返回，已驗證有效（279/279 全數通過）。如果沒加這個旗標又不想背景執行，改用背景執行＋直接讀取輸出檔案內容判斷測試結果，不要等待指令本身回傳完成；如果懷疑跟先前殘留行程搶資源，先用 `Get-CimInstance Win32_Process | Where-Object CommandLine -like '*jest*'` 檢查並清掉舊的 jest 行程鏈。尚未排查 handle 洩漏的實際來源，也還沒決定要不要修（可能是刻意的 fire-and-forget 設計，也可能是遺漏的 teardown），如果要修，屬於架構決策，需要先跟開發者討論方向，不要自行動手

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無設計層面阻塞。M2c-4/M2c-5 六個任務已在分支 `worktree-m2c4-m2c5-action-and-haunt` 上 inline execution 全部完成，測試全綠（288/288，`server` 目錄要加 `--forceExit`，見上方除錯注意事項），但**尚未經過獨立審查、尚未合併回 `main`**——因為接近額度上限，開發者指示先收工，下一階段開場優先處理審查。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 讀 2026-08-05（今日）範圍即可
2. **優先**：對分支 `worktree-m2c4-m2c5-action-and-haunt` 觸發獨立審查（`/code-review ultra`），比照 M2c-2 的先例，不能只靠自己寫的 TDD 測試就假設沒問題。審查通過（或修正完）後再決定合併方式（merge/PR）
3. 審查通過並合併後，提醒開發者審核 Task 1 agent 草擬的 `item-cards.json`/`omen-cards.json` 的 `category`/`canTargetOthers` 第一版數值是否正確
4. **M2c-3（卡片＋房間操作 effects 內容，範圍已擴充）**：36 張事件/道具卡的 `effects` 內容 **加上**房間「操作」類 effects 內容（例如 `data/rooms/rooms.json` 的「保險庫」已有文字描述但 `effects:[]` 是空的）**加上** `omen-cards.json` 補 `needsCustomLogic` 欄位（目前完全沒有這個欄位，跟 event/item 卡的 schema 不一致）——agent 依 `card-mechanics-reference.md` 草擬 JSON，開發者審核修正
5. **M2d（簡易使用者介面，新里程碑）**：取代目前 JSON 傾印風格的除錯頁面，至少涵蓋：房間地圖視覺化（`board.ground`/`board.upper` 的相對位置＋已開門方向）、目前所在房間標示、屬性刻度視覺化（`track`/`currentIndex`/`baseIndex` 用長條圖＋刻度呈現，不要只顯示原始數字）、自身道具清單、其他玩家的位置標示、公開資訊（目前預兆數）、私人資訊區塊的預留版位（陣營/勝利條件，M3 後才有實際內容）、操控實體切換的預留版位（M3 叛徒切換多隻怪物用，現在不用做功能，只要介面結構預留空間）
6. **執行順序已跟開發者確認**：M2c-4/M2c-5（審查中）→ M2c-3 → M2d，依序完成，不要打亂
7. **M2c-3/M2d 全部完成後，開發者要手動從頭跑一次完整流程**：建房→加入→鎖門（目前是選角開始時隱含鎖門，不是獨立按鈕，已跟開發者確認這個理解一致）→隨機選角→開始遊戲→（迴圈）選擇行動/開門/移動/觸發房間效果/觸發卡片效果/改變狀態/結束回合換人，直到邪祟考驗觸發邪祟為止。邪祟觸發後的戰鬥內容是 M3，這次測試不涵蓋

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；純 JavaScript，不使用 TypeScript；單一程式碼庫同時支援區網與雲端部署
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**
- **輸入驗證慣例（M2a 確立，沿用至今）**：所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串，不可靜默失敗
- **角色屬性是刻度制，不是連續整數**：`track`/`currentIndex`/`baseIndex`/`skullIndex`
- **回合機制關鍵慣例**：樓梯移動免費、`advanceTurn` 自動重設行動力、所有回合內動作都要驗證 turn ownership、效果選擇未解決前不可推進回合（見上方「除錯注意事項」）
- **「架構性缺口」vs「防呆修正」的處理原則**：只是輸入驗證/防呆類（有明確既有慣例可套用）可以直接修正不用問；牽涉新的遊戲規則/架構設計決策，必須先跟開發者確認方向
- **「操作」跟「道具」的定義（8/1 `turn-flow-and-action-points.md` 已核准，容易混淆，注意）**：「道具」＝使用手上持有卡片的主動能力（面具戴脫、魔術方塊考驗等）；「操作」＝**房間本身**觸發的機制（例如保險庫知識考驗開鎖），不含卡片能力。兩者的 `effects` schema 相同，都可以直接用 `effectResolver.resolveEffects`
- **20 秒兩層計時提問 UI**：8/1 已核准的設計，M2b-2、M2c-4 都明確決定先不做，改用直接事件模式——**這是暫時簡化，不是取消，M2 完整測試跑完後要記得補回去**
- **邪祟觸發規則（M2c-5，已實作於 `resolveCardDraw`）**：每抽一張預兆卡，`omenCount` 遞增，骰 `omenCount` 顆骰子（0/0/1/1/2/2 面），總和 >5 觸發 `hauntStarted=true`——不是實體遊戲的「同名預兆抽第二張」規則
- **物品 `category` 三分類規則（M2c-4，已實作）**：`category` 為 `武器`/`消耗品`/`一般`（欄位值為英文 `weapon`/`consumable`/`general`）。消耗品是否移除看效果是否「生效」（`appliedCount > 0`），不是看玩家是否嘗試使用——考驗類道具（如魔術方塊）未通過視為未生效，不移除。預兆卡**沒有**消耗品分類（必須留在場上供 `omenCount` 計數），這是硬性不變量
- **「操作」（room_action）的行動力時機（M2c-4 Task 5 執行期間確認）**：開新房間會讓行動力歸零、回合立刻結束，同一回合不可能再觸發操作，必須等玩家下一次輪到行動才能對已開的房間操作／考驗；但進房間自動觸發的卡片效果（抽卡）不受此限，仍要解析完才能結束回合——兩者是不同機制
- **卡牌/房間內容分工**：agent 依 `card-mechanics-reference.md` 草擬 `effects` JSON，開發者審核修正（跟房間 `doors`/角色數值「開發者自己手填」不同，因為這是聲明式 schema 轉換）
- **MVP 兩個劇本**：劇本1〈神鬼痴漢 The Mummy Walks〉、劇本10〈闔家團圓 Family Gathering〉
- **未來階段**：Phase 2 為 AI 玩家（呼叫 Claude API 決策，選角色順序排真人之後、數量不可超過真人數量）；Phase 3+ 為原創劇本
- **PDF 內容抽取**：用 `pymupdf`（`import fitz`），不要用 `pypdf`。抽取結果不進版控
- **版權**：規則書/卡牌內容屬 Hasbro/Avalon Hill 版權，僅供私人非商業用途
- **語言偏好**：與開發者對話一律使用繁體中文
- **Worktree 慣例**：每個里程碑開獨立 worktree/分支，完成後合併回 `main`；`main` 分支保持乾淨可執行
- **大型計畫拆分**：單一里程碑若預估任務數明顯超過前一個里程碑，要主動跟開發者確認是否拆成多份計畫
- **測試競態的處理先例**：房間廣播事件（`game:prompt`/`game:promptResolved` 等），測試裡等待「下一次廣播」時若只用單一 client 的 `.once`，可能誤收到還在飛行中的前一次廣播——已確立的修法是 `Promise.all` 等所有相關 client 的 `.once` 都先收到才繼續；同類問題以後不用再問，直接套用
- **獨立審查慣例**：inline execution（非 subagent-driven-development）完成的里程碑，合併前應該補一次獨立整分支審查（`requesting-code-review` 技能），不能只靠自己寫的 TDD 測試就假設沒問題——M2c-2 就是靠這次審查才抓到 C1 這個 Critical bug
- **收工流程**：每階段收工前需生成/更新 worklog、chatlog、Handover，並推送至 GitHub repo；需確認本次 session 自行啟動的本機伺服器已關閉
