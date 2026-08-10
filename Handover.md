# 交接文檔 Handover

最後更新：2026-08-10（第 5 次工作階段，房間獨立小任務＋`dice-interjection` Part A 全部完成並合併進 `main`）

**`summon-control-and-item-drop`、房間獨立小任務、`dice-interjection-part-a` 皆已完成並合併進 `main`**：所有 worktree 與分支（本機與遠端）都已依標準流程清理刪除。目前工作目錄就是 `main`，無待接續的 worktree。

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
      其餘卡片維持 `needsCustomLogic:true`（M3 傷害/攻擊系統、房間結束回合/離開考驗觸發點等機制缺口，詳見下方除錯注意事項）
    - **M2c-3 附屬功能：召喚物操控切換＋道具給予/遺留/撿取（`summon-control-and-item-drop`）—— 全部完成，已合併進 `main`**：設計文件 [docs/superpowers/specs/2026-08-09-summon-control-and-item-drop-design.md](docs/superpowers/specs/2026-08-09-summon-control-and-item-drop-design.md)、實作計畫 [docs/superpowers/plans/2026-08-10-summon-control-and-item-drop.md](docs/superpowers/plans/2026-08-10-summon-control-and-item-drop.md)（7 任務，用 `subagent-driven-development` 在獨立 worktree 執行，每任務都經過獨立審查）：
      - Task 1（`droppedItems` 房間欄位）、Task 2（`switch_control` 效果類型）、Task 3（道具 give/leave/pickup，一般玩家）、Task 4（`moveSummon`/`selectSummonAction`，含一輪修正：`advanceTurn` 安全網原本會弄丟召喚物身上攜帶的道具）、Task 6（`socketHandlers.js` 接上 `player.summons` 分流＋`mode` 透傳）、Task 7（`omen_004` 犬靈卡片內容）——皆完成並通過審查
      - **Task 5（回合手動結束機制，全體玩家）—— 執行期間新增的任務，不在原計畫裡**：Task 4 審查時發現，犬靈道具（`switch_control`）本身要花 1 點行動力，若玩家使用當下剩 1 點，行動力歸零會自動觸發回合結束，剛建立的召喚物瞬間被摧毀。跟開發者確認後決定**全面改為手動結束回合**（不限召喚物情境）：新增 `endTurn`/`game:endTurn`，移除 `advanceTurnIfOver` 及其 4 個呼叫點，`isTurnOver` 保留但不再被自動呼叫。**前端「結束回合」按鈕本來規劃留到 M2d，但全分支審查發現除錯頁面完全無法結束回合會讓多回合遊玩完全跑不動，已補了一個最小按鈕到 `DebugGameScreen.jsx`（見下方全分支審查段落），完整的行動選單 UI 仍留給 M2d**
      - **全分支最終審查（合併前，見下方除錯注意事項的新段落）發現 1 個 Critical＋4 個 Important，已全數修復並重新審查通過，349/349→358/358**
    - **房間獨立小任務（結束回合被動加成＋離開房間前考驗）—— 已完成並合併進 `main`**：直接在 `main` 上用 TDD 逐項實作（範圍小，未開 worktree）。禮拜堂/圖書室/食品儲藏室/健身房的「結束回合獲得加成」（`onceOnlyPerPlayer`）終於接上 `game:endTurn` 觸發點；塔橋/雜亂的房間/藤蔓糾纏的溫室的「離開房間前考驗」用新的 `leaveCheck` 房間欄位＋`moveToRoom` 新參數實作，兩種離開方式（移動到已知房間／開新門）都會被擋，失敗只扣 1 點行動力（跟正常移動花費一樣，不會多扣），可以當回合重試。3 個 commit，364/364 測試全綠。
    - **`dice-interjection-part-a`（可被道具介入的擲骰，卡片/房間操作觸發的 `dice_check` 路徑）—— 已完成並合併進 `main`**：設計文件 [docs/superpowers/specs/2026-08-10-dice-interjection-design.md](docs/superpowers/specs/2026-08-10-dice-interjection-design.md)、實作計畫 [docs/superpowers/plans/2026-08-10-dice-interjection-part-a.md](docs/superpowers/plans/2026-08-10-dice-interjection-part-a.md)（7 任務，`subagent-driven-development` 在獨立 worktree 執行）。天使羽毛（`item_005`，擲骰前自選 0~8 覆蓋結果）、詭異人偶（`item_006`，擲骰前多骰兩顆，代價意志-1，每回合限一次）、蠟燭（`item_010`，僅事件卡觸發的考驗可用，多骰一顆）三張卡現在能在擲骰前跳出詢問視窗讓玩家決定要不要介入。幸運兔腳（`item_007`，擲骰後重骰）已依開發者指示直接從遊戲移除，不做。**只涵蓋 `dice_check` 路徑，`leaveCheck`（塔橋等房間）的道具介入是 Part B，尚未開始**，`diceInterjection.js` 刻意保持無外部依賴的純函式模組供 Part B 直接沿用。全分支最終審查發現 3 個 Important（`overrideValue` 未驗證就先消耗道具、`pendingRollChoice`／`pendingChoice` 共存導致永久卡死房間、除錯頁面完全沒有新事件監聽）＋1 個 Minor（`sourceDeckType` 沒有在恢復流程中保留），全數修復並重新審查通過，391/391 測試全綠。
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

**`summon-control-and-item-drop` 全分支最終審查發現的實際案例（已修復，`9f79511`/`e00660b`/`36e5aea`/`cb0b953`，供未來同類流程參考）——這批問題是 7 個任務個別審查時各自看不到的跨任務組合問題，只有把整個分支放在一起看才浮現**：
- **Critical（架構性問題，已修復）：卡片「抽到即觸發」跟「持有後主動使用才觸發」共用同一組 `effects` 欄位，沒有區分**。`resolveCardDraw`（`socketHandlers.js`）不管卡片類型，抽到就無條件解析 `card.effects`；但 `game:selectAction` 的 `item` 使用路徑（`content.cards.omens.find(...).effects`）解析的是**同一組**欄位。水晶球（`preview_and_choose`）／面具（`toggle_active`）卡面文字明明是「當玩家使用...時」，卻在抽到當下就先跑過一次——原本影響較小（多跳一次選擇視窗、面具被動預先啟動），但犬靈的 `switch_control` 一旦在抽卡瞬間自動觸發，會立刻凍結玩家操作，且**手動結束回合機制上線後（Task 5）＋除錯頁面原本沒有消散/結束回合按鈕，會讓整場遊戲永久卡死無法復原**。**修復方向（已跟開發者確認）**：卡片內容新增 `activatedOnUse: true` 旗標（`omen_003`/`omen_004`/`omen_008` 三張都有標），`resolveCardDraw` 看到這個旗標就跳過 `resolveEffects`（卡片仍會加入背包、仍計入邪祟考驗，只是不解析效果），效果只在玩家之後主動「使用道具」時才解析。**這是一個通用機制，不是犬靈專屬——之後任何「持有後才主動使用」的卡片都要記得加這個旗標**，否則會重現同一類問題（只是嚴重程度視效果內容而定）
- **Important（已修復）**：操控召喚物期間 `game:useStairs` 沒有跟 `game:move`/`game:selectAction` 一樣被 `player.summons` 分流擋下，玩家可以用樓梯免費傳送本體，違反「本體完全凍結」的設計。已在 `useStairs` 加上 `SUMMON_ACTIVE` 拒絕
- **Important（已修復）**：設計文件明確要求「一回合只能切換一次來回」，但 `switch_control` 完全沒有限制，玩家可以無限次消散再召喚換取免費移動。已新增 `player.summonUsedThisTurn` 旗標（`switch_control` 檢查並設定，`advanceTurn` 於離開玩家身上重置），`handleSwitchControl` 同時補上輸入驗證（`INVALID_SWITCH_CONTROL_EFFECT`）與重複啟用防呆（`SUMMON_ALREADY_ACTIVE`）
- **Important（已修復，含審查後追加修正）**：`leaveItemAction` 遺留道具到房間時，原本會重建一個只有 `{id}` 的新物件，丟失道具本身的狀態（例如已啟動的面具的 `active` 標記）。第一輪修復只補了「遺留」這半邊，重新審查時發現「撿取」（`pickupItemAction`）同樣有這個問題，兩邊都補齊物件狀態保留（比照 `giveItemAction` 既有的正確作法），並補了一個遺留＋撿取往返不遺失狀態的測試
- **Important（已修復）**：`DebugGameScreen.jsx` 完全沒有「結束回合」按鈕——Task 5 把自動結束回合機制拿掉後，除錯頁面連過第二回合都做不到。補了一個最小的 `結束回合` 按鈕（跟既有 `handleUseStairs` 同樣寫法），完整的行動選單／召喚物操控 UI 仍然是 M2d 的範圍
- **Minor（已記錄，暫不處理）**：`SUMMON_ALREADY_USED_THIS_TURN` 這類新拋錯目前會被 `game:selectAction` 既有的 catch-and-log 模式吞掉（玩家端看不到錯誤訊息，但行動力已經被扣），這是既有的吞錯模式，不是這次新增的缺陷，但這次新的拋錯讓它第一次在正常遊玩中可能被踩到，前端做出對應 UI 提示前先记录

**`dice-interjection-part-a` 全分支最終審查發現的實際案例（已修復，供未來同類流程參考）**：
- **Important（已修復）：consume-before-validate 模式——道具先被消耗，驗證失敗才拋錯，導致玩家永久失去道具且擲骰結果憑空消失**。天使羽毛的 `overrideValue`（玩家自選 0~8 覆蓋擲骰結果）原本只在 `computeInterjectedRoll` 深處驗證，但**驗證之前**就已經呼叫 `respondToPrompt`（消耗提示）跟移除道具——玩家送出缺漏或超出範圍的 `overrideValue`，道具就永久消失，擲骰也不會有結果。修復：在 `game:diceChoiceRespond` 的**最前面**（`respondToPrompt` 之前，提示狀態都還完整保留時）先驗證 `overrideValue`，驗證失敗直接回錯誤讓玩家可以重新送出正確的值。**通用教訓：任何「先扣資源、後驗證輸入」的順序都要反過來——驗證永遠要在消耗/移除任何東西之前**
- **Important（已修復）：新的暫停狀態（`pendingRollChoice`）沒有清掉舊的暫停狀態（`pendingChoice`），兩者同時存在會讓房間永久卡死**。`handleRollChoicePending` 建立 `pendingRollChoice` 時沒有把既有的 `pendingChoice` 清空——如果一張卡片的 `choice` 效果選項本身又包含一個會跳出道具介入的 `dice_check`（目前沒有卡片這樣寫，但架構上可行），兩個暫停狀態會同時存在，導致回應其中一個會讓另一個指向一個已經不存在的提示，永久卡死房間（`game:move`/`game:selectAction`/`game:endTurn`/`game:useStairs` 全部被 `ROLL_CHOICE_IN_PROGRESS` 擋死，逾時計時器的防呆分支也沒有清掉卡死的狀態）。修復：建立新暫停狀態時明確清空舊的，逾時的提早return分支也要防呆補清。**通用教訓：任何新增的「暫停等待玩家回應」狀態，都要檢查會不會跟既有的暫停狀態共存衝突，不能只顧自己這一個狀態**
- **確立的規則**：這次是本專案第二次新增獨立的「暫停等待玩家回應」狀態（第一次是 M2c-2 的 `pendingChoice`），兩次都不是靠「重用既有欄位」而是「開一個新的、平行的欄位＋各自獨立的逾時計時器 map＋各自獨立的 socket 回應事件」——這是刻意的架構選擇（兩種暫停的「恢復邏輯」本質不同），但也代表每次新增暫停狀態都要重新檢查「這個新狀態會不會跟其他既有的暫停狀態衝突」，不會自動免疫

**M2c-3 盤點期間發現的架構缺口（已跟開發者確認方向，記錄供 M3 或未來小任務參考）**：
- **傷害系統完全沒有實作，且不只是 M3 combat 需要，好幾張 M2 階段就會抽到的事件/預兆卡也需要**（駭人尖叫、蜘蛛失敗分支、濕滑的地板、天花板塌陷、噬咬）。**開發者已定案的設計**：多點傷害＝跳出 N 次單點選擇視窗（N＝傷害總點數），每次讓玩家選「力量或速度」（肉體傷害）／「知識或意志」（精神傷害）其中一項扣 1 點，且每次視窗都要顯示兩個候選屬性**當下**的級別與實際數值（角色屬性是刻度制，降級不代表數值一定下降，且邪祟後降到最低級別＝死亡，玩家需要真實數據才能判斷）。**逾時規則**：只要其中一點逾時（不管第幾點），從那一點開始（含當次）剩下的全部點數，改用 8/1 規則書原案「儘量平均分配，無法平分則給數值較高的屬性」批次處理，不再繼續逐點跳窗。需要新增：(1) 新效果類型 `damage`（`damageType`+`amount`，`amount` 可能是固定數字或卡片內部先擲一次獨立骰子決定）；(2) `effectResolverManager` 的 `pendingChoice` 要能記住「連續提示鏈」的進度（第幾點/還剩幾點/傷害類型），不是只記一個待解決選擇；(3) 提示廣播要能即時查詢並附上兩個候選屬性的當下級別+數值，不是卡片作者預先寫死的選項。**確認放在 M3 實作**（駭人尖叫等目前卡在這個缺口的卡片，`needsCustomLogic:true` 空著等 M3）
- **房間「結束回合被動加成」跟「離開房間前考驗」都沒有觸發點**：`rooms.json` 裡禮拜堂/圖書室/食品儲藏室/健身房已經有 `effects`（`onceOnlyPerPlayer:true`），塔橋/雜亂的房間/藤蔓糾纏的溫室的文字是「離開房間前要考驗」——這兩種都不是「進房自動觸發」也不是「玩家主動操作」，目前完全沒有對應的觸發點，`onceOnlyPerPlayer` 欄位在程式碼裡也完全沒被讀取。**開發者已確認**：這是需要新增程式碼的獨立小任務，不算在 M2c-3 內容撰寫範圍內，有空再處理，不影響其他內容撰寫
- **`draw_card` 效果的已知限制**：目前只有透過同步流程（`game:selectAction`/`game:move` 的 ack 回呼，或 `game:effectPromptRespond` 的 ack）才能私下通知玩家抽到什麼卡（`game:cardsDrawn` 私人事件）；如果未來卡片把 `draw_card` 放在**逾時自動觸發**的選擇路徑裡（`handleEffectChoiceTimeout`），目前沒有機制可以私訊——因為那條路徑是伺服器計時器觸發、沒有對應的 socket 可用。目前沒有任何卡片用到這個路徑，遇到了再回頭補
- **保險庫（`room_vault`）的效果本體已經可以用 `dice_check`+`draw_card` 表達，但「開一次後永久變空房間」的一次性標記還沒有追蹤機制**（跟上面「房間結束回合/離開考驗」是同一類缺口）——`needsCustomLogic` 先保持 `true`，效果內容已經寫好可用，等追蹤機制做出來就完整了
- **`peek_and_reorder`（原本 M2c-1 就故意留空的「偷看牌堆+洗牌重排」效果）仍未實作**：水晶球原本需要這個機制，但開發者已經把水晶球簡化成「展示牌庫前 3 張供選 1 張，牌庫順序完全不調整」（見下方 `preview_and_choose`），改用更簡單的新機制解決，不需要真的做 `peek_and_reorder`。唯一還卡在這個缺口的只剩通靈板，已確認整張延後到 M3
- **預兆牌現在會在抽到時加進玩家背包（跟道具共用同一個 `inventory`）**：原本抽到預兆牌只會解析一次性 `effects` 就結束，牌本身完全不會被追蹤持有。但水晶球/面具這類卡片文字是「當玩家**使用**...時」，代表需要「持有後、之後某回合主動使用」的道具式流程——`resolveCardDraw` 現在對 `deckType==='omen'` 一律 `addItem`，`game:selectAction` 的 `item` 分支查找內容時同時查 `content.cards.items` 跟 `content.cards.omens`。**副作用**：預兆牌現在也會出現在玩家背包清單裡，前端顯示道具清單時要注意這點（M2d 待辦）

**環境問題（M2c-4/M2c-5 執行期間發現）——`server/test/socketHandlers.test.js` 執行後 Jest 進程不會自然結束**：用 `-t` 篩選單一測試（例如 `npx jest test/socketHandlers.test.js -t "..."`）時，測試本身 1 秒內就跑完並印出正確結果，但 Jest 之後會卡住印出 `Jest did not exit one second after the test run has completed. ... asynchronous operations that weren't stopped`，導致包住它的 shell 指令永遠不會回傳（背景執行也一樣，指令本身「完成」但底層 node 進程持續存活）。已重複驗證兩次，結果一致，確認是這個測試檔案既有的非同步 handle（很可能是 socket.io client/server 或計時器）未關閉的問題，跟任何一次程式改動無關。**後續在這個檔案（或整個 `server` 測試套件）上跑測試時的因應方式**：加上 `--forceExit` 旗標（例如 `npx jest --forceExit`）即可正常在數秒內返回，已驗證有效（279/279 全數通過）。如果沒加這個旗標又不想背景執行，改用背景執行＋直接讀取輸出檔案內容判斷測試結果，不要等待指令本身回傳完成；如果懷疑跟先前殘留行程搶資源，先用 `Get-CimInstance Win32_Process | Where-Object CommandLine -like '*jest*'` 檢查並清掉舊的 jest 行程鏈。尚未排查 handle 洩漏的實際來源，也還沒決定要不要修（可能是刻意的 fire-and-forget 設計，也可能是遺漏的 teardown），如果要修，屬於架構決策，需要先跟開發者討論方向，不要自行動手

## 目前的瓶頸或停頓點 (Current Blocker/Status)
無設計層面阻塞。`summon-control-and-item-drop`、房間獨立小任務、`dice-interjection-part-a` 皆已完成並合併進 `main`（worktree／分支皆已清理），目前工作目錄就是 `main`。

**舊的 worktree 清理問題已解決**：`.claude/worktrees/m2c4-m2c5-action-and-haunt` 已不存在（`git worktree list`/`git branch -a` 皆確認），不需要再處理。

**commit `52cdd1d` 的歷史備註（僅供之後對照 commit 歷史時參考，非待辦）**：該筆提交因操作疏失把「`modifiers.js` 的 `removeWhen` 改可選」這個程式碼修正跟「M2c-3 第一批內容草稿」合併成同一筆——功能跟測試都正確，只是 commit 訊息只提到程式碼修正沒提到內容。

**`data/cards/item-cards.json` 尾端有 2 筆空白佔位資料**（`id`/`name`/`text` 都是空字串）——本次全分支審查合併時發現，已確認這是**分支開始前就存在**的既有資料（不是這次改動造成的），維持原樣沒有動它，僅記錄供之後留意。

## 下一步行動 (Next Steps)
1. 讀取本 Handover；worklog 讀最近一次工作階段範圍即可
2. **M2c-3 其餘卡片**仍卡在幾個機制缺口（見上方除錯注意事項），依開發者已確認的方向處理——傷害系統（`damage` 效果類型＋連續提示鏈＋即時數值顯示）與武器攻擊類卡片留給 M3；通靈板整張延後到 M3；`item_008`（中世紀鎧甲，減傷＋防偷竊）也綁在 M3 傷害/偷竊機制上
3. **`dice-interjection` Part B（`leaveCheck` 路徑的道具介入）**：讓天使羽毛/詭異人偶也能用在塔橋/雜亂的房間/藤蔓糾纏的溫室這類「離開房間前考驗」，目前只有 `dice_check`（卡片/房間操作觸發）路徑做完，`leaveCheck` 路徑完全還沒接。`diceInterjection.js` 已刻意設計成無外部依賴的純函式，Part B 可以直接沿用 `findInterjectionOptions`/`resolveFinalRoll`，不用重寫。獨立計畫，等開發者排入順序
4. **M2d（簡易使用者介面，新里程碑）**：取代目前 JSON 傾印風格的除錯頁面，至少涵蓋：房間地圖視覺化（`board.ground`/`board.upper` 的相對位置＋已開門方向）、目前所在房間標示、屬性刻度視覺化（`track`/`currentIndex`/`baseIndex` 用長條圖＋刻度呈現，不要只顯示原始數字）、自身道具清單（**現在也會包含預兆牌**，見上方除錯注意事項）、其他玩家的位置標示、公開資訊（目前預兆數）、私人資訊區塊的預留版位（陣營/勝利條件，M3 後才有實際內容）、操控實體切換的完整 UI（犬靈是第一個真實案例，目前只有除錯頁面的最小按鈕，之後 M3 叛徒切換多隻怪物沿用同一套）、完整的「結束回合」按鈕與行動選單、完整的「擲骰道具介入」選擇畫面（目前除錯頁面都只有最小可用版本）
5. **執行順序已跟開發者確認**：M2c-3 → M2d，依序完成，不要打亂（`dice-interjection` Part B 何時排入待開發者決定）
6. **全部完成後，開發者要手動從頭跑一次完整流程**：建房→加入→鎖門（目前是選角開始時隱含鎖門，不是獨立按鈕，已跟開發者確認這個理解一致）→隨機選角→開始遊戲→（迴圈）選擇行動/開門/移動/觸發房間效果/觸發卡片效果/改變狀態/**手動呼叫結束回合換人（注意不是行動力歸零自動換人）**，直到邪祟考驗觸發邪祟為止。邪祟觸發後的戰鬥內容是 M3，這次測試不涵蓋

## 關鍵設定 (Key Context & Rules)
- **技術棧**：Node.js + Express + Socket.IO（伺服器持有權威遊戲狀態）＋ React (Vite) 前端；純 JavaScript，不使用 TypeScript；單一程式碼庫同時支援區網與雲端部署
- **開發者背景**：新手，主要靠 Claude Code 協作開發；**除錯時遇到非顯而易見的錯誤必須停下列出可能原因與開發者討論，不可自行試錯修改後重跑**
- **輸入驗證慣例（M2a 確立，沿用至今）**：所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串，不可靜默失敗
- **角色屬性是刻度制，不是連續整數**：`track`/`currentIndex`/`baseIndex`/`skullIndex`
- **回合機制關鍵慣例**：樓梯移動免費、`advanceTurn` 自動重設行動力、所有回合內動作都要驗證 turn ownership、效果選擇未解決前不可推進回合（見上方「除錯注意事項」）
- **回合結束機制（`summon-control-and-item-drop` Task 5，已合併進 `main`）**：行動力歸零**不再**自動結束回合，全體玩家都要手動呼叫新的 `game:endTurn` 才會換人（即使行動力還沒用完也可以提前結束）。`advanceTurnIfOver` 已整個移除；`turnFlow.js` 新增 `endTurn(gameState, playerId)`（`NOT_YOUR_TURN`/`SUMMON_ACTIVE` 兩種拒絕情境，`SUMMON_ACTIVE`＝操控召喚物期間必須先消散才能結束回合）。`useStairs` 也一併補上 `SUMMON_ACTIVE` 檢查（全分支審查發現的漏網之魚，見上方除錯注意事項）。**除錯頁面 `DebugGameScreen.jsx` 已補上最小的「結束回合」按鈕**（否則除錯頁面連過第二回合都做不到），完整的行動選單 UI 仍是 M2d 的範圍
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
- **犬靈操控切換＋道具給予/遺留/撿取（已全部完成並合併進 `main`）**：玩家物件新增 `summons` 欄位（單一物件不是陣列，`type` 欄位分辨召喚物種類，之後可擴充不限犬靈，`undefined`／`null`＝無召喚物；`{type, floor, x, y, actionPoints, carryingItemId}`）跟 `summonUsedThisTurn` 布林欄位（一回合限一次切換，`advanceTurn` 於離開玩家身上重置，兩者都是 lazy-optional，`createPlayer` 不初始化）；房間動態狀態（`gameState.board` 裡的房間物件，不是靜態 `rooms.json`）新增 `droppedItems` 陣列。新效果類型 `switch_control`（`{summonType, actionPoints}`，建立 `summons`，含 `INVALID_SWITCH_CONTROL_EFFECT`/`SUMMON_ALREADY_ACTIVE`/`SUMMON_ALREADY_USED_THIS_TURN` 三種拒絕情境）。`turnFlow.js` 新增 `moveSummon`/`selectSummonAction`（操控召喚物期間限定 移動/撿取/遺留/消散，消散＝純狀態切換不算結束回合，行動力歸零不影響消散）；`selectAction` 的 `item` 動作新增 `mode: 'give'|'leave'|'pickup'`（預設/`'use'`＝原本邏輯，`leave`/`pickup` 都會保留道具物件本身的狀態，不會重建成只剩 `{id}`）。`socketHandlers.js` 的 `game:move`/`game:selectAction`/`game:useStairs` 依 `player.summons` 是否存在分流／擋下。**新增 `activatedOnUse` 卡片旗標**（`resolveCardDraw` 看到就跳過抽卡當下的效果解析，只在玩家之後主動用 `game:selectAction actionType:'item'` 使用時才解析）——這是全分支審查抓到的通用機制，任何「持有後才主動使用」的卡片都要記得標，不是犬靈專屬（詳見上方除錯注意事項的 Critical 案例）。詳見 [設計文件](docs/superpowers/specs/2026-08-09-summon-control-and-item-drop-design.md)、[實作計畫](docs/superpowers/plans/2026-08-10-summon-control-and-item-drop.md)
- **房間「結束回合被動加成」（`onceOnlyPerPlayer`，已合併進 `main`）**：房間 `effects` 裡的 `stat_change` 效果可以帶 `onceOnlyPerPlayer:true`，`game:endTurn` 結束回合時會檢查玩家所在房間，套用尚未領過的加成，記錄進玩家新欄位 `player.roomBonusesReceived`（房間 id 陣列，lazy-optional）——每人每間房限一次，不限這次結束回合是不是第一次進這間房
- **房間「離開前考驗」（`leaveCheck`，已合併進 `main`）**：房間內容新增 `leaveCheck: {stat, min}` 欄位（塔橋/雜亂的房間/藤蔓糾纏的溫室），`moveToRoom`（`turnFlow.js`）新增參數，離開房間前（不管是移動到已知房間還是開新門）先用該屬性當下數值擲骰考驗，通過才正常移動；沒通過扣 1 點行動力（跟正常移動花費一樣，不會多扣），原地不動，行動力夠可以當回合重試；開新門失敗**不會**抽卡也不會歸零行動力，只有真的開門成功才會
- **可被道具介入的擲骰（`dice-interjection-part-a`，已合併進 `main`，只涵蓋 `dice_check` 路徑）**：卡片新增頂層欄位 `diceInterjection`（`{scope:"any"|"eventTriggered", bonusDice?, override?, cost?, consumesItem}`，跟 `effects` 平行，不是塞進 `effects` 陣列），宣告這張道具能介入「別人正在進行的擲骰」。`dice_check` 擲骰前（`effectResolver.js` 的 `handleDiceCheck`）會掃描玩家背包，透過 `context.itemCatalog`（呼叫端從 `content.cards.items` 準備好往下傳，`effectResolver.js` 本身不直接讀內容目錄）找符合條件的道具，有的話**不擲骰**，改跳出新的獨立暫停狀態 `pendingRollChoice`（跟既有 `pendingChoice` 平行、各自獨立的逾時計時器 map 與 socket 回應事件 `game:diceChoiceRespond`，兩者絕對不能共用同一個欄位），玩家選好（或逾時預設不使用）後接續原本的擲骰／`tiers` 評估邏輯。純邏輯部分（`findInterjectionOptions`/`resolveFinalRoll`）獨立成 `server/src/game/diceInterjection.js`，刻意不依賴 `gameState`/`content`，供之後的 Part B（`leaveCheck` 路徑）直接沿用。`player.diceInterjectionUsedThisTurn`（道具 id 陣列，lazy-optional）追蹤「這回合已經用過」的非消耗品道具，`advanceTurn` 對離開玩家重置。**重要教訓（詳見上方除錯注意事項）**：任何會消耗玩家資源（扣道具、扣行動力）的動作，驗證輸入永遠要排在消耗之前；任何新增的暫停狀態都要主動清空可能共存的其他暫停狀態，不會自動免疫。詳見 [設計文件](docs/superpowers/specs/2026-08-10-dice-interjection-design.md)、[實作計畫](docs/superpowers/plans/2026-08-10-dice-interjection-part-a.md)
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
