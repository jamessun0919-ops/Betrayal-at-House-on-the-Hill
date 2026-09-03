# NPC 操控機制實際實作 — 設計文件（Handover 項目14 子專案6）

> 延續並完成 [2026-09-01-npc-control-mechanism-design.md](2026-09-01-npc-control-mechanism-design.md) 保留不定案的兩塊（回合順序整合、NPC 回合的操控權授權），該文件已確認的部分（資料模型／NPC行動範圍／生命週期／icon整合）不重複列出，只列這次新增/變更的部分。

## 目標

讓 `omen_004`（獵犬）的「使用」真的能召喚出一個可操控的 NPC 實體，取代目前完全沒有前端程式碼、觸發就會卡死玩家的舊 `switch_control`／`player.summons` 一次性附身機制。同時完成 2026-09-01 文件明確保留待定的兩塊：

- **回合順序整合**：已由 2026-09-02 骨架設計文件解決——NPC 不插在操控者回合後面，而是有自己獨立的全局階段（`npc_move`／`npc_interact`），這份文件不重複討論
- **NPC 回合的操控權授權**：`phaseFlow.js` 的 `lockPlayerPhase`／`requirePhase` 目前對 `player.isNPC` 一律丟 `NOT_YOUR_PHASE`，程式碼註解明講這是留給這個子專案的——**這是這份文件真正要設計的核心**

## 一、資料模型與生命週期（技術設計，補完 2026-09-01 文件的 A/D/E/F）

- 新增 effect type `create_npc`（取代 `switch_control`），例如 `{ type: 'create_npc', npcID: 'npc_001' }`：以施放者（`targetForEffects`）為 `controlledBy`，複製其目前 `floor`/`x`/`y`，依 `data/characters/npcs.json` 對應資料列建立 NPC 物件（`isNPC:true`／`npcID`／`controlledBy`／`linkedImprintId`／`inventory: []`），加入 `gameState.players`
- **行動力**：`npcs.json` 的 `stats` 欄位已經跟 `characters.json` 同形狀（`might`/`speed`/`knowledge`/`sanity` 各自的 `track`/`baseIndex`/`skullIndex`，目前是空佔位）。建立 NPC 時直接把 `npcData.stats` 整包複製進 NPC 物件的 `stats` 欄位，`resetActionPoints`／`getStatValue`／`changeStat` 完全不用改，跟真人玩家共用同一套邏輯——開發者之後只需要把 `npc_001` 的 `speed.track` 填成單一固定數值（例如 `[6]`，`baseIndex:0`）即可達成「固定行動力」，不需要新增任何程式碼分支
- **移除**：既有 `remove_imprint` 效果解析邏輯新增一個連動——被移除的銘印 id 若等於某個 NPC 的 `linkedImprintId`，一併從 `gameState.players` 刪除該 NPC。操控者死亡時移除，維持 2026-09-01 文件的既有結論：規則記錄但不寫程式碼，等 M3 玩家淘汰機制做出來後補
- `omen_004` 的 `effects` 陣列把 `switch_control` 換成 `create_npc`；既有 2 個 `stat_change`（力量/意志各+1）維持不動（已查證是正確的，不受影響）

## 二、授權與階段整合

### 2.1 socket 層：`actingAsNpcId` 參數

`game:move`／`game:selectAction`（限 `mode:'pickup'`/`'leave'`）／`game:lockPhase`（含別名 `game:endTurn`）三類事件的 payload 新增可選欄位 `actingAsNpcId`。client 端有一個「操控實體」切換器（自己／NPC），選定後續動作都帶上對應值；不帶時完全比照現況（操控自己）。

新增共用函式：

```javascript
function resolveActingEntity(gameState, callerId, actingAsNpcId) {
  if (!actingAsNpcId) return callerId;
  const npc = getPlayer(gameState, actingAsNpcId);
  if (!npc || !npc.isNPC || npc.controlledBy !== callerId) {
    throw new Error('NPC_NOT_CONTROLLED_BY_YOU');
  }
  return actingAsNpcId;
}
```

`callerId` 一律來自 `socket.data.playerId`（既有機制，非 client payload 提供，不可偽造），`resolveActingEntity` 回傳值即為這次動作實際要套用的 `playerId`。

### 2.2 `phaseFlow.js` 的既有 NPC 拒絕檢查要拿掉

`requirePhase`／`lockPlayerPhase` 目前對 `player.isNPC` 無條件丟 `NOT_YOUR_PHASE`——這個檢查的目的（防止 NPC 自己被當成呼叫者）已經由 `resolveActingEntity` 在更上層做完（NPC 沒有自己的 socket 連線，`actingAsNpcId` 一定經過操控者身分驗證才會被採用），這裡改成單純比對階段/鎖定狀態，不再特別判斷是不是 NPC。

### 2.3 NPC 可執行的動作範圍限制（新錯誤碼 `NPC_ACTION_NOT_ALLOWED`）

比照 2026-09-01 文件已確認的「D. NPC 行動範圍」，`actingAsNpcId` 存在時：
- `game:selectAction` 只接受 `mode:'pickup'`/`'leave'`，其餘（`give`/`wield`/`wear`/`room_action`/道具使用/`attack`）一律丟 `NPC_ACTION_NOT_ALLOWED`
- `game:move` 只能走進已放置的鄰房，不能開新門

**實作方式（技術判斷，不影響前面已確認的行為範圍）**：`turnFlow.js` 現有的 `moveToRoom`（含 `leaveCheck`／崩塌房間／舞廳配對等大量與 NPC 無關的分支）與 `pickupItemAction`/`leaveItemAction`（會觸發 `openInventoryChoiceIfNeeded` 背包選擇彈窗）都不適合直接塞進 NPC 分支，會讓已經很複雜的函式更難讀，NPC 也用不到這些機制。改為新增一個獨立檔案 `server/src/game/npcFlow.js`，仿照舊 `moveSummon`（僅允許走進已放置鄰房，用同一套 `doorSides`/`canMoveBetween` 檢查）與舊 `selectSummonAction` 的 `pickup`/`leave` 分支（操作 `room.droppedItems`，但這次寫進 NPC 自己的 `inventory` 陣列而非單一 `carryingItemId` 欄位，並加一個 `inventory.length >= 1` 上限檢查對應 `NPC_INVENTORY_FULL`），純粹是把舊 `moveSummon`/`selectSummonAction` 的邏輯改套用在新的 NPC 資料結構上，行為範圍跟 2026-09-01 文件的確認完全一致。`socketHandlers.js` 在 `resolveActingEntity` 回傳 NPC id 時，改呼叫這個新檔案的函式而不是 `moveToRoom`/`pickupItemAction`。

### 2.4 `game:lockPhase` 帶 `actingAsNpcId`

鎖定該 NPC 自己的 `phaseLocked`，沿用 `lockPlayerPhase` 現有邏輯（2.2 移除 isNPC 拒絕後即可直接支援），只在 `npc_move`/`npc_interact` 階段有效——比照 `requirePhase` 同款相位檢查。

## 三、舊召喚機制刪除範圍

- 刪除 `turnFlow.js` 的 `moveSummon`／`selectSummonAction`／`SUMMON_ITEM_MODES`
- 刪除 `effectResolver.js` 的 `switch_control`／`handleSwitchControl`
- 刪除 `player.summons` 欄位與其初始化／清理邏輯（`playerEntity.js`）
- 刪除對應 socket 事件（`game:moveSummon`／`game:selectSummonAction`，若存在獨立事件名）
- **`getCurrentTurnPlayerId`／`requireTurnOrder` 會失去唯一消費端，一併刪除**。但 `gameState.turnOrder`／`currentPlayerIndex` 欄位本身與 `gameManager.js` 開局洗牌邏輯**保留不動**——寫計畫時查證發現，幾乎所有雙人測試共用的輔助函式（`setUpStartedGame`／`setUpStartedGameWithContent`）都是靠 `startedPayload.turnOrder[startedPayload.currentPlayerIndex]` 決定 `currentPlayerId`／`currentClient`／`otherClient`，這個模式雖然是舊制沿用下來的（現在已經沒有語意上的必要性，純粹拿來固定選一位玩家當測試裡的稱呼），但砍掉這兩個欄位會讓幾乎所有既有測試的共用輔助函式壞掉，遠超過這個子專案的範圍。開發者確認：欄位＋洗牌保留，只刪除真正的消費函式
- 既有測試：`turnFlow.test.js`／`socketHandlers.test.js` 裡涉及 `moveSummon`/`selectSummonAction`/`switch_control`/`turnOrder`/`getCurrentTurnPlayerId` 的既有測試，全部刪除或改寫成對應新模型的測試

## 四、前端 UI

- `DebugGameScreen` 新增「操控實體」切換器（自己／該玩家控制的 NPC，清單依 `gameState.players` 篩選 `controlledBy === myPlayerId` 取得，目前最多 1 隻）
- 切換到 NPC 時：
  - `FocusedRoomView` 改顯示該 NPC 所在房間，移動按鈕呼叫帶 `actingAsNpcId` 的 `game:move`
  - 新建簡化版 NPC 專屬面板（顯示 NPC 自己的行動力／背包，比照 `CharacterPanel` 但精簡）
  - 操作按鈕只保留移動／拾取／遺留，隱藏開門／房間行動／攻擊
  - 「階段結束」按鈕改為鎖定 NPC 自己的階段（帶 `actingAsNpcId` 呼叫 `game:lockPhase`），只有目前是 `npc_move`／`npc_interact` 時才可點
- 切換回「自己」時，畫面與行為完全比照現況不變

## 範圍排除

- 怪物 NPC 的具體行動範圍／攻擊機制——M3 範圍
- 操控者死亡時 NPC 移除的實際程式碼——規則已記錄（2026-09-01 文件 E），需要 M3 玩家淘汰機制才能實作
- NPC 本身受到考驗／傷害——目前設計裡 NPC 不會觸發任何考驗（只能走已放置鄰房、拾取/遺留），不在範圍內
