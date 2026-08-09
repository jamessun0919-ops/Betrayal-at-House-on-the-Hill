# 交接文檔 Handover

最後更新：2026-08-09（第 3 次工作階段，M2c-3 進行中）

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
    - **M2c-4/M2c-5（道具/操作動作接線＋邪祟考驗機制）—— 已完成、已通過獨立審查（含 1 輪修正）、已合併進 `main`**：[spec](docs/superpowers/specs/2026-08-05-m2c4-m2c5-action-and-haunt-design.md)、[計畫](docs/superpowers/plans/2026-08-05-m2c4-m2c5-action-and-haunt.md)——`item-cards.json`/`omen-cards.json` 補 `category`（武器/消耗品/一般）/`canTargetOthers` 欄位（開發者已對照實體卡片全數確認正確，無需修改）、`effectResolver.js` 新增 `appliedCount` 回傳值、`turnFlow.js` 的 `selectAction` 接上道具/操作真實邏輯、`socketHandlers.js` 的 `cardId`→`sourceId` 改名（`game:cardDrawn` 例外保留 `cardId`）＋`consumeItemIfApplied` 參數、`game:selectAction` 接上真實效果解析、`resolveCardDraw` 加入邪祟考驗。測試全綠（290/290）
    - **M2c-3（36 張卡片＋房間操作類 effects 內容）—— 進行中，22 張已草擬並驗證，等開發者審核；2 張（犬靈＋道具給予/遺留機制）的設計文件已寫完等開發者過目**：agent 依 `card-mechanics-reference.md` 逐卡分類，跟開發者確認多個機制缺口的處理方向後，草擬了 22 張卡片/房間的 `effects` 內容——`item_003`（治療藥膏）/`item_004`（嗅鹽）/`item_009`（魔術方塊）、`omen_002`（書）/`omen_003`（水晶球）/`omen_005`（女孩）/`omen_006`（聖符）/`omen_007`（瘋漢）/`omen_008`（面具）/`omen_009`（徽章，維持無效果）、`event_001`（腐敗惡臭）/`event_004`（電池耗盡）/`event_005`（不起眼的櫃子）/`event_006`（滴答聲）/`event_007`（祈禱聲）/`event_009`（挑釁的幻覺）/`event_010`（電話鈴聲）、`room_vault`（保險庫）。已用一次性腳本載入真實內容、多組骰值/選項分支實際跑過 `resolveEffects` 驗證無誤才提交。`omen-cards.json` 全部 13 張已補上 `needsCustomLogic` 欄位（原本完全沒有這個欄位）。
      過程中新增的機制（詳見下方除錯注意事項）：`draw_card`（隨機抽 N 張卡）、`preview_and_choose`/`take_previewed_card`（水晶球：展示牌庫前 3 張供選一張，牌庫順序不調整）、`toggle_active`（面具：可泛用的「生效狀態」切換）、**預兆牌現在會跟道具一樣被加進玩家背包**（水晶球/面具這類需要「持有後主動使用」的預兆牌因此可以透過 `game:selectAction actionType:'item'` 使用）、`removeWhen` 可以填陣列（OR 邏輯）、`persistent_modifier` 新增 `blocksOpenDoor` 效果（電池耗盡）、`checkRemoveConditions` 終於接上真實呼叫點（移動後檢查同房間、任何效果解析後檢查持有道具）。也修好 3 個既有缺口：`restoreToBase` 會誤降已達基本值以上的數值、`dice_check` 的骰數調整沒有 `[1,8]` 上下限、`persistent_modifier` 的 `removeWhen` 原本被誤設為強制欄位。
      **狗（改名犬靈）＋道具給予/遺留/撿取機制**：範圍已超出單純內容撰寫（多實體操控切換＋新的道具子動作＋房間動態狀態），跟開發者逐項確認設計後寫成獨立設計文件 [docs/superpowers/specs/2026-08-09-summon-control-and-item-drop-design.md](docs/superpowers/specs/2026-08-09-summon-control-and-item-drop-design.md)，**尚未實作，等開發者過目確認後才進 `writing-plans`**。
      其餘卡片維持 `needsCustomLogic:true`（M3 傷害/攻擊系統、房間結束回合/離開考驗觸發點等機制缺口，詳見下方除錯注意事項）
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

**M2c-4/M2c-5 獨立審查發現的實際案例（已修復，`7eca839`，供未來同類流程參考）**：
- **Important**：`handleEffectResolveResult` 裡 `consumeItemIfApplied` 觸發的 `removeItem` 呼叫原本沒有包 try/catch。如果某個消耗品道具的 `effects` 本身也包含一個指向自己的 `lose_item`（例如魔術方塊卡面文字「魔術方塊消失」，若照字面直接加一個 `lose_item` 效果），該道具會被移除兩次，第二次 `removeItem` 拋 `ITEM_NOT_FOUND`。這個拋錯在 `game:selectAction` 的同步路徑剛好有外層 try/catch擋住，但在 `game:effectPromptRespond`／逾時這兩條非同步路徑沒有，會導致「推進回合」跟「廣播 `game:stateUpdate`」被跳過——**跟 M2c-2 的 C1 是同一類問題，透過一個新增的呼叫點（`removeItem`）重新出現**。已修復：`removeItem` 包一層 try/catch，「已經不存在」視為良性 no-op。**寫 M2c-3 內容時要注意**：`category:"consumable"` 的道具，`effects` 不應該再額外寫一個指向自己的 `lose_item`（移除交給 `consumeItemIfApplied` 自動處理，不用、也不該在 effects 裡重複寫）

**M2c-3 盤點期間發現的架構缺口（已跟開發者確認方向，記錄供 M3 或未來小任務參考）**：
- **傷害系統完全沒有實作，且不只是 M3 combat 需要，好幾張 M2 階段就會抽到的事件/預兆卡也需要**（駭人尖叫、蜘蛛失敗分支、濕滑的地板、天花板塌陷、噬咬）。**開發者已定案的設計**：多點傷害＝跳出 N 次單點選擇視窗（N＝傷害總點數），每次讓玩家選「力量或速度」（肉體傷害）／「知識或意志」（精神傷害）其中一項扣 1 點，且每次視窗都要顯示兩個候選屬性**當下**的級別與實際數值（角色屬性是刻度制，降級不代表數值一定下降，且邪祟後降到最低級別＝死亡，玩家需要真實數據才能判斷）。**逾時規則**：只要其中一點逾時（不管第幾點），從那一點開始（含當次）剩下的全部點數，改用 8/1 規則書原案「儘量平均分配，無法平分則給數值較高的屬性」批次處理，不再繼續逐點跳窗。需要新增：(1) 新效果類型 `damage`（`damageType`+`amount`，`amount` 可能是固定數字或卡片內部先擲一次獨立骰子決定）；(2) `effectResolverManager` 的 `pendingChoice` 要能記住「連續提示鏈」的進度（第幾點/還剩幾點/傷害類型），不是只記一個待解決選擇；(3) 提示廣播要能即時查詢並附上兩個候選屬性的當下級別+數值，不是卡片作者預先寫死的選項。**確認放在 M3 實作**（駭人尖叫等目前卡在這個缺口的卡片，`needsCustomLogic:true` 空著等 M3）
- **房間「結束回合被動加成」跟「離開房間前考驗」都沒有觸發點**：`rooms.json` 裡禮拜堂/圖書室/食品儲藏室/健身房已經有 `effects`（`onceOnlyPerPlayer:true`），塔橋/雜亂的房間/藤蔓糾纏的溫室的文字是「離開房間前要考驗」——這兩種都不是「進房自動觸發」也不是「玩家主動操作」，目前完全沒有對應的觸發點，`onceOnlyPerPlayer` 欄位在程式碼裡也完全沒被讀取。**開發者已確認**：這是需要新增程式碼的獨立小任務，不算在 M2c-3 內容撰寫範圍內，有空再處理，不影響其他內容撰寫
- **`draw_card` 效果的已知限制**：目前只有透過同步流程（`game:selectAction`/`game:move` 的 ack 回呼，或 `game:effectPromptRespond` 的 ack）才能私下通知玩家抽到什麼卡（`game:cardsDrawn` 私人事件）；如果未來卡片把 `draw_card` 放在**逾時自動觸發**的選擇路徑裡（`handleEffectChoiceTimeout`），目前沒有機制可以私訊——因為那條路徑是伺服器計時器觸發、沒有對應的 socket 可用。目前沒有任何卡片用到這個路徑，遇到了再回頭補
- **保險庫（`room_vault`）的效果本體已經可以用 `dice_check`+`draw_card` 表達，但「開一次後永久變空房間」的一次性標記還沒有追蹤機制**（跟上面「房間結束回合/離開考驗」是同一類缺口）——`needsCustomLogic` 先保持 `true`，效果內容已經寫好可用，等追蹤機制做出來就完整了
- **`peek_and_reorder`（原本 M2c-1 就故意留空的「偷看牌堆+洗牌重排」效果）仍未實作**：水晶球原本需要這個機制，但開發者已經把水晶球簡化成「展示牌庫前 3 張供選 1 張，牌庫順序完全不調整」（見下方 `preview_and_choose`），改用更簡單的新機制解決，不需要真的做 `peek_and_reorder`。唯一還卡在這個缺口的只剩通靈板，已確認整張延後到 M3
- **預兆牌現在會在抽到時加進玩家背包（跟道具共用同一個 `inventory`）**：原本抽到預兆牌只會解析一次性 `effects` 就結束，牌本身完全不會被追蹤持有。但水晶球/面具這類卡片文字是「當玩家**使用**...時」，代表需要「持有後、之後某回合主動使用」的道具式流程——`resolveCardDraw` 現在對 `deckType==='omen'` 一律 `addItem`，`game:selectAction` 的 `item` 分支查找內容時同時查 `content.cards.items` 跟 `content.cards.omens`。**副作用**：預兆牌現在也會出現在玩家背包清單裡，前端顯示道具清單時要注意這點（M2d 待辦）

**環境問題（M2c-4/M2c-5 執行期間發現）——`server/test/socketHandlers.test.js` 執行後 Jest 進程不會自然結束**：用 `-t` 篩選單一測試（例如 `npx jest test/socketHandlers.test.js -t "..."`）時，測試本身 1 秒內就跑完並印出正確結果，但 Jest 之後會卡住印出 `Jest did not exit one second after the test run has completed. ... asynchronous operations that weren't stopped`，導致包住它的 shell 指令永遠不會回傳（背景執行也一樣，指令本身「完成」但底層 node 進程持續存活）。已重複驗證兩次，結果一致，確認是這個測試檔案既有的非同步 handle（很可能是 socket.io client/server 或計時器）未關閉的問題，跟任何一次程式改動無關。**後續在這個檔案（或整個 `server` 測試套件）上跑測試時的因應方式**：加上 `--forceExit` 旗標（例如 `npx jest --forceExit`）即可正常在數秒內返回，已驗證有效（279/279 全數通過）。如果沒加這個旗標又不想背景執行，改用背景執行＋直接讀取輸出檔案內容判斷測試結果，不要等待指令本身回傳完成；如果懷疑跟先前殘留行程搶資源，先用 `Get-CimInstance Win32_Process | Where-Object CommandLine -like '*jest*'` 檢查並清掉舊的 jest 行程鏈。尚未排查 handle 洩漏的實際來源，也還沒決定要不要修（可能是刻意的 fire-and-forget 設計，也可能是遺漏的 teardown），如果要修，屬於架構決策，需要先跟開發者討論方向，不要自行動手

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無設計層面阻塞。M2c-3 已有 22 張卡片/房間草擬並驗證完成，**開發者審核中**；犬靈（原「狗」）＋道具給予/遺留/撿取機制的設計文件已寫完，**等開發者過目確認後才進 `writing-plans`**。**待辦**：
1. **worktree 清理，已確認多次無法在 Claude Code session 內完成**：`.claude/worktrees/m2c4-m2c5-action-and-haunt`（分支 `worktree-m2c4-m2c5-action-and-haunt`）被鎖定為「進行中 session 的作業目錄」，只要是還在用這個 worktree 當作業目錄的 Claude Code session，`git worktree remove` 一律會被 `locked working tree` 擋下（強制解鎖有風險：這是 session 自己正在使用的環境，強制移除可能讓當下 session 壞掉，不能貿然執行）。**內容/分支都已安全合併進 `main`，這個 worktree 只是收尾清潔，不影響任何功能，不急**。真的要清掉的話，兩個辦法：(a) 開發者自己在 Claude Code **之外**的終端機執行：
   ```bash
   git worktree remove --force "C:/Users/User/Desktop/Betrayal at House on the Hill/.claude/worktrees/m2c4-m2c5-action-and-haunt"
   git branch -D worktree-m2c4-m2c5-action-and-haunt
   ```
   (b) 開一個**不使用**這個 worktree 當作業目錄的全新 Claude Code session 執行同樣指令
2. commit `52cdd1d` 因操作疏失把「`modifiers.js` 的 `removeWhen` 改可選」這個程式碼修正跟「M2c-3 第一批內容草稿」這個資料變更合併成同一筆提交了——功能跟測試都正確，只是這筆 commit 訊息只提到程式碼修正沒提到內容，之後看 commit 歷史對照時要注意這點，不是漏推或漏提交

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 讀最近一次工作階段範圍即可
2. 開新 session 前先確認上方「worktree 待清理」是否還被鎖定，能清就清掉
3. **確認開發者是否已審核完 M2c-3 已完成的 22 張卡片/房間**（見上方「已完成進度」），有修正意見就照著改
4. **確認開發者是否已看過** [docs/superpowers/specs/2026-08-09-summon-control-and-item-drop-design.md](docs/superpowers/specs/2026-08-09-summon-control-and-item-drop-design.md)（犬靈操控切換＋道具給予/遺留/撿取），核准後呼叫 `writing-plans` 轉成實作計畫再執行
5. **M2c-3 剩餘卡片**：卡在幾個機制缺口（見上方除錯注意事項），依開發者已確認的方向處理——傷害系統（`damage` 效果類型＋連續提示鏈＋即時數值顯示）與武器攻擊類卡片留給 M3；房間結束回合/離開考驗的觸發點是獨立小任務，有空再補；通靈板整張延後到 M3
6. **M2d（簡易使用者介面，新里程碑）**：取代目前 JSON 傾印風格的除錯頁面，至少涵蓋：房間地圖視覺化（`board.ground`/`board.upper` 的相對位置＋已開門方向）、目前所在房間標示、屬性刻度視覺化（`track`/`currentIndex`/`baseIndex` 用長條圖＋刻度呈現，不要只顯示原始數字）、自身道具清單（**現在也會包含預兆牌**，見上方除錯注意事項）、其他玩家的位置標示、公開資訊（目前預兆數）、私人資訊區塊的預留版位（陣營/勝利條件，M3 後才有實際內容）、操控實體切換的預留版位（犬靈是第一個真實案例，之後 M3 叛徒切換多隻怪物沿用同一套）
7. **執行順序已跟開發者確認**：M2c-3 → M2d，依序完成，不要打亂（犬靈設計文件核准後何時實作，待開發者排入順序）
8. **全部完成後，開發者要手動從頭跑一次完整流程**：建房→加入→鎖門（目前是選角開始時隱含鎖門，不是獨立按鈕，已跟開發者確認這個理解一致）→隨機選角→開始遊戲→（迴圈）選擇行動/開門/移動/觸發房間效果/觸發卡片效果/改變狀態/結束回合換人，直到邪祟考驗觸發邪祟為止。邪祟觸發後的戰鬥內容是 M3，這次測試不涵蓋

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
- **`draw_card` 效果類型（M2c-3，已實作）**：`{type:"draw_card", deck:"item"|"event"|"omen", count:N}`，從指定牌庫隨機抽 N 張加入背包，牌庫抽空時中途停止；抽到的卡透過 `game:cardsDrawn` 私人事件只通知抽卡玩家本人，不廣播給其他人（僅限同步流程，見上方除錯注意事項的已知限制）
- **傷害系統設計（已跟開發者定案，確認放在 M3 實作，見上方除錯注意事項）**：多點傷害＝連續跳出 N 次單點選擇視窗，每次顯示候選屬性當下級別+數值，逾時後剩餘點數改用「儘量平均分配」批次處理
- **`persistent_modifier` 的 `removeWhen`（M2c-3 已修正為可選，且已接上真實呼叫點）**：省略＝永久不解除；可以填單一物件或陣列（陣列＝符合任一個條件就解除）；`checkRemoveConditions` 現在會在每次 `game:move` 完成後（檢查同房間所有玩家的 `meetsAnotherPlayer`）跟每次效果解析完成後（檢查解析玩家目前背包裡每一件道具的 `holdsItem`）真的執行，不再是純資料
- **`preview_and_choose`/`take_previewed_card` 效果類型（M2c-3，水晶球用）**：展示牌庫最前面 N 張（牌庫本身建立時就洗過牌，等同隨機展示），動態產生選項讓玩家選一張直接拿走，其餘完全不動、不重排。完全沿用既有 `choice`/`pendingChoice` 機制，只是選項是即時算出來的
- **`toggle_active` 效果類型（M2c-3，面具用，可泛用）**：背包道具項目多一個 `active` 布林欄位，`{itemId, activeEffects, inactiveEffects}` 依目前狀態套用其中一組並切換狀態，之後其他「有生效狀態」的道具可以直接沿用
- **`persistent_modifier` 的 `blocksOpenDoor` 效果（M2c-3，電池耗盡用）**：`{hookType:"blocksOpenDoor"}`，`turnFlow.js` 的 `getAvailableDirections` 檢查到就不列出開新房間的選項，但已存在的相鄰房間仍可移動
- **犬靈操控切換＋道具給予/遺留/撿取（設計已定案，尚未實作）**：玩家物件新增 `summons` 欄位（單一物件不是陣列，`type` 欄位分辨召喚物種類，之後可擴充不限犬靈）；房間動態狀態（`gameState.board` 裡的房間物件，不是靜態 `rooms.json`）新增 `droppedItems` 陣列。詳見 [設計文件](docs/superpowers/specs/2026-08-09-summon-control-and-item-drop-design.md)
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
