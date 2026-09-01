# NPC 操控機制（犬靈／未來怪物）— 設計文件

## 目標

取代現有的 `switch_control`／`player.summons` 一次性附身機制，改成「召喚出一個結構上等同玩家的 NPC 實體，由原本的玩家操控」的新模型（M2D3 細節③「操控實體切換完整 UI」的架構前提）。

**這份文件只記錄目前已確認的部分**（資料模型、NPC 行動範圍、生命週期、跟角色 icon 定位系統的銜接）。**回合順序如何插入 NPC、以及操控權判斷的協定調整，開發者明確要求保留不定案**，留給之後「回合制改為各自回合同時行動＋互動堆疊機制」（Handover 項目 14）的討論一併決定——沒有回合機制可以依附，NPC 實際上還沒辦法真的行動。**這份文件因此不完整，暫時不進 `writing-plans`，等保留待定的部分定案後再補完整、寫實作計畫。**

## 已確認架構

### A. NPC 資料模型

`gameState.players` 新增與 Player 結構一致的物件（不是另開一個獨立集合），額外欄位：
- `isNPC: true`
- `controlledBy: <操控者的 playerId>`
- `npcID`：對應 `data/characters/npcs.json` 的資料列，取代原本 `switch_control` 效果裡的 `summonType` 字串
- `linkedImprintId`：例如 `"omen_004"`，讓移除銘印時能找到對應要清除的 NPC（見下方 E）
- `floor`/`x`/`y`：召喚當下複製操控者當時的位置
- `actionPoints`／`inventory`：跟玩家物件同樣欄位形狀，實際數值依 NPC 類型而定（例如犬靈固定行動力、背包上限 1 件）

### D. NPC 行動範圍

比照現有 `moveSummon`／`selectSummonAction` 的既有限制範圍，**不是**升級成完整玩家行動選單：
- `move`：只能走進已經放置的鄰房，不能開新門、不能搜索
- `item`，`mode:'pickup'`／`'leave'`：僅限操作房間的 `droppedItems`，背包上限 1 件
- 不同 NPC 類型各自定義自己的行動範圍（這次只確認犬靈；之後怪物 NPC 出現時，行動範圍由當時的機制/劇本另外定義，不預設繼承犬靈這一套）

### E. 生命週期

**建立**：`omen_004`（犬靈）的「使用」按鈕觸發一個新效果類型（取代現有的 `switch_control`），建立上述 NPC 物件，加進 `gameState.players`。

**移除**，已確認兩個觸發條件：
1. 玩家失去「犬靈」銘印時，透過既有的銘印反向套用邏輯（跟 `remove_imprint` 掛鉤），連帶把對應的 NPC 從遊戲中移除
2. 操控玩家死亡時，NPC 也一併消失——**這個條件目前沒有對應機制可以掛（玩家死亡/淘汰系統是 M3 範圍，現在完全不存在），這裡先把規則記下來，不寫任何程式碼，等 M3 玩家淘汰機制做出來後再回頭補上這個連動**

### F. NPC 資料檔與角色 icon 定位系統整合

新增 `data/characters/npcs.json`（已建立並 commit，欄位比照既有 `data/characters/characters.json`：`codename`/`filename`/`fileicon`/`gender`/`age`/`tall`/`occupation`/`itemID`/`itemname`/`stats`，唯一差異是 `id` 改名 `npcID`）。目前只有一筆佔位資料 `npc_001`（犬靈），欄位值留空，開發者之後手動填入實際內容與美術素材檔名。

跟 2026-09-01 剛完成、合併進 `main` 的角色 icon 定位機制（`client/src/gameplay/FocusedRoomView.jsx`）整合，已確認兩點：
- 圖示查找：現有 `findCharacterIcon(characterId, characterContent)` 只查 `characters.json`，需要擴充成能依 `npcID` 查 `npcs.json` 拿 `fileicon`（NPC 物件沒有 `characterId`，改用 `npcID`）
- 3 人以上格線置中的排序規則：NPC 一律排在所有真人玩家（依 `characterId` 由小到大）之後；NPC 彼此之間依 `npcID` 由小到大排序

（這兩點屬於銜接既有系統的必要調整，實際程式碼待這份文件的「保留待定」部分定案、真正進入 `writing-plans` 階段時一併處理，不需要開發者現在決定更多細節）

## 保留待定（等「回合制改為各自回合同時行動」討論時一併確認）

### B. 回合順序整合

開發者構想已口頭確認：NPC 召喚後**永久插入** `turnOrder`，緊接在操控者本人的位置之後，之後每一輪都固定是「操控者回合→NPC回合→下一位玩家」。`advanceTurn` 離開 NPC 回合時的行動力重置，需要依 `npcID` 查固定數字（不是像真人玩家一樣用屬性推算）。

**保留原因**：實際插入時機、跟 `turnOrder` 既有洗牌/推進邏輯的互動細節，尤其是「如果回合制真的改成各自回合同時行動，NPC 插入回合順序的意義可能整個改變（同時行動的情境下『插在操控者後面』還有沒有意義）」——這些都要等回合機制正式討論時才能真正定案，現在先動手會做出之後可能整個要重來的東西。

### C. NPC 回合的操控權授權（新發現的既有機制調整點）

現有回合擁有權檢查（`server/src/socketHandlers.js` 多處）是 `getCurrentTurnPlayerId(gameState) !== playerId`，這裡的 `playerId` 來自 `socket.data.playerId`——也就是這個 socket 連線對應的**真人玩家**自己的 ID。NPC 有自己獨立的 `playerId`（見 A），輪到 NPC 的回合時，`getCurrentTurnPlayerId()` 回傳的是 NPC 的 ID，但操控者的連線送出動作時帶的還是自己的 `playerId`，兩者直接比對會對不上，被誤判成「不是你的回合」。

需要修改回合擁有權檢查邏輯，改成判斷「這是不是你自己的回合，或是你控制的 NPC 的回合」（透過 `controlledBy` 反查）。**保留原因**：實際怎麼改、要不要新增一個共用的授權判斷函式取代目前分散在多個 handler 裡的直接比對，都要等 B 定案——如果回合制整個改掉，這裡的檢查邏輯本來就要一起重寫，現在改一次、之後可能又要改一次是白工。

## 範圍排除

- 攻擊/戰鬥機制、怪物 NPC 的實際資料內容——M3 範圍
- 完整的回合順序插入與操控權協定——見上方「保留待定」，這份文件不含這兩塊的實作內容
- 犬靈以外的其他 NPC 類型的具體行動範圍——之後真的有其他 NPC（M3 怪物）時再個別定義，不預先設計成通用框架
- 操控玩家死亡時 NPC 移除的實際程式碼——規則已記錄（見 E），需要 M3 玩家淘汰機制才能實作
