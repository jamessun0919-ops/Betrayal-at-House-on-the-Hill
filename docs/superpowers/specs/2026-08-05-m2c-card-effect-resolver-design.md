# M2c：卡牌牌庫＋效果解析器 — 設計文件

日期：2026-08-05
狀態：已與開發者確認，準備進入 `writing-plans` 撰寫實作計畫

## 背景

M2b（[M2b-1](../plans/2026-08-02-m2b1-core-game-logic.md)＋[M2b-2](../plans/2026-08-04-m2b2-socket-integration.md)）已完成並合併進 `main`：回合流程（`turnFlow.js`）、選角色（`characterSelectionManager.js`＋`characterSelection.js`）、提問狀態機（`promptState.js`）、Socket.IO 事件層全部就緒。`turnFlow.js` 的 `moveToRoom` 在玩家開門進入需要抽卡的房間時，回傳值裡會帶 `pendingCardDraw: {deck}`；`socketHandlers.js` 目前只把它原樣廣播成 `game:pendingCardDraw`，沒有實際抽卡；`selectAction(gameState, playerId, actionType)` 目前只回傳 `{kind: actionType, pending: true}`（沒有任何關聯 id），廣播成 `game:pendingAction`，同樣沒有實際效果。

M2c 要把這兩個掛勾點接上真正的抽卡與效果解析：`data/cards/{event,item,omen}-cards.json` 三份卡片資料（共 36 張非戰鬥卡＋少數戰鬥卡）目前 `effects` 全部是空陣列，[card-mechanics-reference.md](2026-08-01-card-mechanics-reference.md) 已經歸納出 17 種機制模式與建議的 M2/M3 分工。本文件記錄跟開發者逐項確認過的架構決策。

## 1. 框架範圍：M2c 建什麼、留什麼給 M3

依 `card-mechanics-reference.md` 的建議，M2c 現在就建**完整的非戰鬥效果框架**：擲骰修改器管線（`onBeforeRoll`/`onAfterRoll`/`onEventCardCheck`）、持續性標記（buff/debuff）、多階梯骰值結果——這幾個是探索階段（鬼屋降臨前）就會用到的機制，如果現在只做最簡單的效果解析、之後 M3 加戰鬥系統時才回頭補管線，會需要重做。

`onAttack`/`onDamageTaken` 這兩個戰鬥專屬的觸發點**本次不接**——戰鬥系統本身要到 M3 才存在，M2c 的效果解析器完全不處理這兩種 hook。36 張卡片中屬於這類的（斧頭、獻祭之劍、長矛、戒指、左輪手槍等武器/攻擊轉換卡）維持 `needsCustomLogic: true`，effects 內容留給 M3。

## 2. effectResolverManager：pendingPrompt 狀態放哪裡

M2b-2 已經確認 `gameState` 本身不掛 `promptState` 欄位（YAGNI）。M2c 需要「效果解析卡在需要玩家選擇（例如：受傷選擇分配到哪個屬性、聖符選擇丟棄哪張卡）」時的暫停狀態，做法比照 `characterSelectionManager.js` 的結構，新建 `server/src/game/effectResolverManager.js`：

```js
createEffectResolverManager() // -> { resolvers: Map() }
startResolver(manager, roomCode) // -> { promptState: createPromptState() }，roomCode 已存在則拋 RESOLVER_ALREADY_STARTED
getResolver(manager, roomCode)
endResolver(manager, roomCode) // 目前沒有呼叫點，見下方生命週期說明
```

**生命週期跟 `characterSelectionManager` 不同**：`characterSelectionManager` 是選角色這個短暫階段專用、選完就丟；`effectResolverManager` 的存活時間跟整個 `gameState` 一致——在 `finishCharacterSelection` 呼叫 `GameManager.startGame` 成功後，同時呼叫 `startResolver(effectResolverManager, roomCode)`。目前專案還沒有「遊戲結束」事件（`GameManager` 本身也沒有明確的 teardown），所以 `endResolver` 暫時沒有呼叫點，這不是 M2c 要解決的新缺口，是沿用現狀。

`index.js` 新增 `effectResolverManager = createEffectResolverManager()`，跟 `gameManager`/`characterSelectionManager` 一起傳進 `registerSocketHandlers`。

## 3. 抽卡觸發流程：自動，隨 `game:move` 一次做完

`game:move` 的 handler 收到 `moveToRoom` 回傳的 `pendingCardDraw` 後，**同一個處理流程內直接自動觸發抽卡＋解析效果**，不需要客戶端另外發事件請求抽卡（符合實體遊戲「進房間強制立即抽卡」的規則）：

```
game:move 收到 → moveToRoom() → 若有 pendingCardDraw:
  若該牌庫 hasCards() 為 false → 跳過（視為無事發生，見第4節）
  否則 drawCard(deck) → 廣播 game:cardDrawn {playerId, deckType, cardId, cardName}
    → effectResolver.resolveEffects(gameState, promptState, playerId, card.effects, context)
      → 全部跑完（沒有 choice）：廣播 game:effectResolved {playerId, cardId}
      → 卡在 choice：建立 pendingPrompt，廣播 game:effectPendingChoice（見第7節）
```

`selectAction`（道具/襲擊/操作殼子）**本次維持 M2b-2 的 stub 行為不變**——`turnFlow.selectAction` 目前的 `{kind, pending:true}` 只涵蓋「這個行動格被消耗了」，實際的道具使用/操作效果解析不在 M2c 範圍內（道具效果透過抽到道具卡「持有」後如何主動使用，屬於未來里程碑的回合行動流程設計，M2c 只確保道具被正確 `grant_item` 進 `inventory`）。

## 4. 牌庫抽空時的處理

事件/道具/預兆三個牌庫都只有 11~13 張（比實體遊戲少很多），比照房間磚牌庫 `roomDeck.js` 的「跳過對應步驟，遊戲繼續」慣例：牌庫抽空時**不重洗**（不做棄牌堆機制），直接跳過抽卡這一步，視為無事發生。`cardDeck.js` 因此不需要棄牌堆資料結構。

## 5. 模組切分

沿用 `server/src/game/` 下純邏輯、可獨立測試的分層慣例：

| 模組 | 職責 |
|---|---|
| `cardDeck.js` | 建立/洗牌/抽卡，比照 `roomDeck.js` 的 throw 慣例：`createCardDeck(cards)`、`hasCards(deck)`（唯讀）、`drawCard(deck)`（抽空拋 `CARD_DECK_EMPTY`，呼叫端先用 `hasCards` 判斷、空了就整段跳過，不呼叫 `drawCard`） |
| `effectPipeline.js` | 純函式：`rollDice(count, rng = Math.random)`（自訂骰面 **0/0/1/1/2/2**，`rng` 可注入以利測試）、`applyModifiers(baseRoll, modifiers, hookType, context)`（套用 `onBeforeRoll`/`onAfterRoll`/`onEventCardCheck` 修改器）、`evaluateTiers(rollResult, tiers)`（由上到下比對第一個 `min`/`max` 符合的 tier） |
| `modifiers.js` | 持續性標記：`attachModifier(entity, modifier)`／`removeModifier(entity, modifierId)`／`checkRemoveConditions(entity, context)`。`entity` 可以是玩家物件或房間物件，`entity.modifiers` 陣列 lazy init（`entity.modifiers = entity.modifiers \|\| []`），不改動 `boardGenerator.js` 的房間結構 |
| `effectResolver.js` | 核心：`resolveEffects(gameState, promptState, playerId, effects, context)` 依序執行一個 `effects` 陣列；遇到 `choice` 型別就用 `createPrompt` 建立暫停點並回傳 `{pending:true, promptId}`，其餘型別當場執行完 |
| `effectResolverManager.js` | 見第2節 |

**`playerEntity.js` 新增 inventory 函式**：目前 `player.inventory` 只是空陣列，沒有任何增減函式。延續 `playerEntity.js` 既有的「player 物件的所有 mutation 都放這裡」慣例（`movePlayerTo`/`changeStat`/`resetActionPoints` 都在這），新增 `addItem(player, item)`／`removeItem(player, itemId)`，`removeItem` 對不存在的 `itemId` 拋 `ITEM_NOT_FOUND`。`grant_item`/`lose_item` 效果呼叫這兩個函式。

## 6. 宣告式效果 JSON 語法

`effects` 陣列的每個元素依 `type` 決定結構：

| type | 欄位 | 說明 |
|---|---|---|
| `dice_check` | `stat`（可省略）、`diceCount`（`stat` 省略時必填，擲固定顆數）、`tiers: [{min, max, effects}]` | `stat` 存在時擲骰數＝`getStatValue(player, stat)`；`tiers` 由上到下比對第一個 `min<=sum<=max` 的套用其 `effects`（遞迴） |
| `stat_change` | `stat`、`delta`（跟 `restoreToBase` 二擇一）、`restoreToBase: true` | 呼叫 `changeStat`／依 `baseIndex` 回復 |
| `grant_item` / `lose_item` | `itemId` | 呼叫 `playerEntity.addItem`/`removeItem` |
| `persistent_modifier` | `appliesTo: "player"\|"room"`、`effects`、`removeWhen: {type, ...params}` | 呼叫 `modifiers.attachModifier`；`removeWhen.type` 開放詞彙：`meetsAnotherPlayer`、`holdsItem`（需 `itemId`）、`leavesRoom`（暫定，room-marker 持續到何時尚未有實際卡片驗證過，先保留詞彙不強制使用） |
| `peek_and_reorder` | `deckType`、`count` | 檢視牌庫前 N 張並可重新排序，不抽出（水晶球/通靈板） |
| `choice` | `description`、`options: [{optionId, label, effects}]`、`defaultOptionId`（逾時預設） | 暫停等玩家選擇；`effectResolver` 收到回應後遞迴執行被選中 option 的 `effects` |

`onEventCardCheck` 這類「情境限定加骰」（蠟燭：僅事件檢定加骰；斧頭：僅 might 攻擊加骰）不是卡片自己的 `effects`，而是 `persistent_modifier` 掛載後，`effectPipeline.applyModifiers` 依 `context`（呼叫端傳入，例如 `{hookType:'onEventCardCheck'}`）比對是否套用。

## 7. 新增 Socket 事件

沿用 M2b-2「獨立發射、提早準備接口」的慣例，不併入通用的 `game:stateUpdate`：

- **`game:cardDrawn`**（廣播）：`{playerId, deckType, cardId, cardName}`——抽卡動作實際發生
- **`game:effectPendingChoice`**（廣播）：`{playerId, promptId, description, options}`——效果解析卡在需要玩家選擇
- **`game:effectPromptRespond`**（client→server）：`{promptId, optionId}`——回應選擇，伺服器驗證後（`respondToPrompt`）遞迴解析被選中 option 的 `effects`
- **`game:effectResolved`**（廣播）：`{playerId, cardId}`——一張卡的效果全部解析完成（含經過 choice 暫停後最終完成的情況）

`game:effectPendingChoice` 的逾時處理比照選角色階段的既有模式：`socketHandlers.js` 排程真實 `setTimeout`，逾時後用 `defaultOptionId` 呼叫 `resolvePromptTimeout`，走跟正常回應相同的後續解析路徑。

所有上述動作完成後（不論是否經過 choice 暫停），廣播 `game:stateUpdate`（沿用既有 `serializeGameState`）同步狀態。

## 8. 卡牌內容分工

36 張非戰鬥卡（事件卡全部、道具卡扣除武器類、預兆卡扣除攻擊轉換類）的實際 `effects` 陣列內容，由 agent 依 `card-mechanics-reference.md` 的卡面文字與機制模式草擬 JSON，開發者審核修正——這跟 M2a/M2b「房間 `doors`、角色數值開發者自己手填」的模式不同，因為這次是把既有卡面文字轉換成聲明式 schema，屬於機械性轉換而非自由創作內容。戰鬥類卡片維持 `needsCustomLogic: true` 不動。

`omen-cards.json` 目前 13 筆完全沒有 `needsCustomLogic` 欄位（跟 event/item 卡的 schema 不一致，只有 `effects: []`）——M2c 統一補上這個欄位（有實際內容的填 `false`，戰鬥類的填 `true`），讓三份卡片資料的 schema 一致。

## 9. 任務拆分

規模跟 M2b 相當，拆成三份計畫，依序執行、後一份要等前一份完成並以其實際完成的介面為基礎撰寫：

1. **M2c-1（純邏輯模組）**：`cardDeck.js`、`effectPipeline.js`、`modifiers.js`、`effectResolver.js`、`playerEntity.js` 新增 inventory 函式——全部可獨立 Jest 單元測試，不涉及 Socket.IO
2. **M2c-2（Socket 整合）**：`effectResolverManager.js`、`socketHandlers.js` 接線（第3、7節的事件與流程）、除錯頁面（`DebugGameScreen.jsx`）擴充顯示抽卡/效果解析結果
3. **M2c-3（卡牌內容）**：36 張非戰鬥卡的 `effects` 實際內容（agent 草擬、開發者審核），`omen-cards.json` 補 `needsCustomLogic` 欄位

## 10. 測試策略

- M2c-1 延續 M2b-1 建立的純邏輯 Jest 模式：自建 fixture，不依賴 Socket.IO；`effectPipeline.rollDice` 透過注入 `rng` 參數讓測試能控制骰子結果，不依賴真實 `Math.random`
- M2c-2 延續 M1/M2b-2 建立的「起真實 server + 多個 client 連線互動」整合測試模式；`game:effectPendingChoice` 的逾時測試比照 M2b-2 character-select timeout 的做法（`characterSelectTimeoutMs` 可注入縮短秒數），沿用同一套機制不用重新設計
- M2c-3 是內容資料，不需要額外的自動化測試，但 M2c-2 的整合測試應該至少涵蓋一張真實卡片（例如一張純 `stat_change` 的事件卡）跑完整條 `game:move → 抽卡 → 效果解析 → game:stateUpdate` 路徑，確認 M2c-1/M2c-2 跟 M2c-3 的實際內容接得起來

## 範圍外事項（記錄供後續參考）

- `onAttack`/`onDamageTaken` 觸發點與所有戰鬥類卡片的 `effects` 內容——留給 M3
- 道具卡「持有後主動使用」的回合行動流程（例如玩家自己選擇何時使用蠟燭）——不在 M2c 範圍，`selectAction` 維持 M2b-2 的 stub
- 兩層 20 秒倒數的回合行動提問流程（M2b-2 已確認不實作）——`game:effectPendingChoice` 是效果解析專用的單層提問，不是這個
- `removeWhen.type: "leavesRoom"` 目前只是保留詞彙，沒有實際卡片驅動它的行為驗證，M2c 實作時如果真的用不到可以先不寫判斷邏輯，等有實際卡片需要時再補
- 遊戲結束（`GameManager.endGame`）事件與對應的 `effectResolverManager.endResolver` 呼叫點——現狀就沒有，不是 M2c 要補的缺口
