# 角色死亡判定設計文件

**日期**：2026-09-10
**範圍**：邪祟降臨後，真人玩家角色的死亡判定（四項能力中任一項降到骷髏頭刻度）；死亡當回合起不再擋任何階段推進；回合結束時系統主動把死亡玩家移出遊戲（比照斷線處理，重用既有的「所有真人斷線即回收房間」機制）。**不包含**：邪祟降臨本身（叛徒/生還者分陣營、劇本查表）——這部分已記錄為獨立待辦，等到要做時才展開；陣營勝利條件的實際判斷邏輯——這次只在該掛鉤的兩個點留註解，不寫任何程式碼；NPC死亡/淘汰——NPC沒有client/socket，「死亡移出遊戲」對NPC沒有意義，這次的死亡機制明確只套用在真人玩家身上。

## 背景

查證確認目前完全沒有死亡判定機制。`playerEntity.js`的`changeStat`（[playerEntity.js:112](../../../server/src/game/playerEntity.js)）已經實作刻度制屬性的邊界規則：`minIndex = hauntStarted ? track.skullIndex : track.skullIndex + 1`——邪祟降臨前，屬性不可能降到骷髏頭刻度（`skullIndex`）本身，最低只能停在上一格；降臨後，這個地板才會鬆綁到骷髏頭刻度。但降到骷髏頭刻度之後，**沒有任何程式碼偵測這代表角色死亡並做出反應**。

`gameState.hauntStarted`（[socketHandlers.js:1167-1174](../../../server/src/socketHandlers.js)）目前只是一個單純的布林旗標，由預兆抽卡數與擲骰門檻觸發翻成`true`並廣播`game:hauntStarted`，之後完全沒有任何後續行為——沒有叛徒/生還者分陣營、沒有劇本查表、沒有勝利條件。這部分屬於最早設計文件（2026-07-31）規劃的「劇本模組」系統核心，工作量等同M3骨架本身，開發者已確認這次不處理，列入未來待辦。

死亡判定規則確認自實體版規則（開發者口述）：**兩個條件必須同時成立——邪祟已降臨，且某項能力的刻度落在骷髏頭刻度**。這帶出一個轉換瞬間的特例：邪祟降臨那一刻本身不是一次扣屬性事件（只是規則門檻鬆綁），如果某項能力在降臨當下就已經卡在降臨前的最低格（骷髏頭上一格），不會立刻死；但如果到那個回合的`settlement`階段時仍然卡在那格（沒有被治療），才會死亡。降臨之後的所有其他情況（含降臨當下如果有新的扣血事件直接命中骷髏頭刻度），都是扣血當下立即死亡，不用等待。

## 核心設計

### ① 死亡判定掛在`changeStat`（唯一的扣屬性入口）

`changeStat`是專案裡**唯一**的屬性刻度mutate函式，所有卡片/房間/道具效果的扣血都經過它，是死亡判定的正確掛鉤點——不需要在任何呼叫端加邏輯。負向分支算出新的`currentIndex`後，補上死亡判定：

```javascript
} else if (delta < 0) {
  let amount = -delta;
  const fromOverflow = Math.min(track.overflow, amount);
  track.overflow -= fromOverflow;
  amount -= fromOverflow;
  const minIndex = hauntStarted ? track.skullIndex : track.skullIndex + 1;
  track.currentIndex = Math.max(track.currentIndex - amount, minIndex);
  if (!player.isNPC && hauntStarted && track.currentIndex === track.skullIndex) {
    player.isDead = true;
  }
}
```

`createPlayer`（[playerEntity.js:44](../../../server/src/game/playerEntity.js)）新增`isDead: false`預設值，比照`connected`欄位的風格。NPC不需要這個欄位（明確排除在死亡機制之外，見上方範圍）。

### ② 邪祟降臨當下的特例——一次性`settlement`階段檢查

`gameState`新增`pendingHauntGraceCheck: false`預設值（[gameState.js](../../../server/src/game/gameState.js)的`createGameState`）。`hauntStarted`翻`true`的同一行補上這個旗標：

```javascript
if (rollSum > 5) {
  gameState.hauntStarted = true;
  gameState.pendingHauntGraceCheck = true;
  io.to(roomCode).emit('game:hauntStarted', { omenCount: gameState.omenCount, rollSum });
}
```

`phaseFlow.js`的`enterPhase`（[phaseFlow.js:56](../../../server/src/game/phaseFlow.js)）新增：進入`settlement`階段時，如果這個旗標是`true`，掃描所有真人玩家的四項能力，凡是還卡在骷髏頭上一格（`currentIndex === skullIndex + 1`）的標記`isDead = true`，然後把旗標清掉（只會觸發這一次）。**插入位置很重要**：必須放在`resetPhaseLocks(gameState, phase)`之後、`enterPhase`結尾那段既有的`if (allParticipantsLocked(gameState, phase)) { advancePhase(gameState); }`級聯檢查之前——這樣如果這次死亡判定剛好讓`settlement`階段的參與者全數滿足條件（`phaseLocked || isDead`），才能正確級聯推進到下一輪`player_move`，而不是卡在`settlement`等一個已經死亡的人手動鎖定：

```javascript
if (phase === 'settlement' && gameState.pendingHauntGraceCheck) {
  for (const p of gameState.players.values()) {
    if (p.isNPC || p.isDead) continue;
    for (const stat of STATS) {
      const track = p.stats[stat];
      if (track.currentIndex === track.skullIndex + 1) {
        p.isDead = true;
        break;
      }
    }
  }
  gameState.pendingHauntGraceCheck = false;
}
```

（`STATS`已經從`playerEntity.js`export，`phaseFlow.js`只需要加進現有的`require`。之所以只檢查`=== skullIndex + 1`而不是`<=`：任何降臨後真的被扣到骷髏頭刻度本身的角色，都已經在①被即時判定死亡並跳過這個迴圈，活著的人不可能比`skullIndex + 1`更低。）

### ③ 死亡角色不擋任何階段推進（含死亡當下所在的那個階段）

跟斷線刻意不同——斷線只在「下一個新階段」透過`resetPhaseLocks`自動鎖定（當下階段仍等逾時，因為斷線可能只是暫時的，需要靠既有逾時機制正確收尾懸置中的選擇）；死亡是確定且不可逆的，不需要這層保留。做法是修改`allParticipantsLocked`（[phaseFlow.js:34](../../../server/src/game/phaseFlow.js)），讓死亡角色直接視為滿足鎖定條件，不管他有沒有真的被鎖定過、也不管死在哪個階段：

```javascript
function allParticipantsLocked(gameState, phase) {
  return getParticipants(gameState, phase).every((p) => p.phaseLocked || p.isDead);
}
```

這樣不需要在死亡發生的當下額外呼叫任何鎖定函式——下一次任何人觸發`allParticipantsLocked`的檢查（無論是另一個玩家主動鎖定、還是逾時強制鎖定），死亡的人都會被自動跳過。

`resetPhaseLocks`（[phaseFlow.js:50](../../../server/src/game/phaseFlow.js)）跟`handlePhaseTimeout`的懸置提示強制決議sweep（[socketHandlers.js:768](../../../server/src/socketHandlers.js)）也一併把`isDead`納入判斷，跟斷線用同樣的方式合併：

```javascript
// phaseFlow.js
function resetPhaseLocks(gameState, phase) {
  for (const p of getParticipants(gameState, phase)) {
    p.phaseLocked = isParticipantDisconnected(gameState, p) || p.isDead;
  }
}
```

```javascript
// socketHandlers.js handlePhaseTimeout
const unresolved = getParticipants(gameState, phase).filter(
  (p) => !p.phaseLocked || isParticipantDisconnected(gameState, p) || p.isDead
);
```

前者純粹是為了讓`game:stateUpdate`廣播給前端的`phaseLocked`欄位保持準確（死亡角色顯示為已鎖定，不影響邏輯正確性，因為`allParticipantsLocked`已經靠OR判斷自行涵蓋）；後者是避免死亡角色身上如果還有懸置中的提示（例如死前一刻被其他玩家開的道具給予選擇）永久卡住，跟這次修過的斷線案例是同一類問題。

**操控中的NPC**：如果死亡玩家操控著NPC，不需要額外處理——`isParticipantDisconnected`的NPC分支已經是查操控者的`connected`狀態，死亡玩家在④被移出遊戲時會被標記`connected:false`，NPC自動跟著被視為「操控者已離開」，沿用現有機制。

### ④ 回合結束移出遊戲

「回合結束」定義為：階段從`settlement`推進回下一輪`player_move`的那一刻。真正能讓`gameState.currentPhase`變成`'player_move'`的地方只有兩處：`handleLockPhase`（[socketHandlers.js:470](../../../server/src/socketHandlers.js)，玩家主動鎖定階段觸發）跟`handlePhaseTimeout`（[socketHandlers.js:755](../../../server/src/socketHandlers.js)，逾時強制鎖定觸發）——這兩處各自呼叫`lockPlayerPhase`/內部的強制鎖定邏輯後，都會呼叫`scheduleOrRefreshPhaseTimeout`重新安排下一次逾時。新增一個函式，在這兩處各自呼叫`scheduleOrRefreshPhaseTimeout`之後接著呼叫：

```javascript
async function removeDeadPlayersAtRoundStart(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode) {
  if (gameState.currentPhase !== 'player_move') {
    return;
  }
  const toRemove = Array.from(gameState.players.values()).filter((p) => !p.isNPC && p.isDead && p.connected);
  for (const player of toRemove) {
    // 未來勝利條件系統要掛在這裡：許多劇本的勝利條件是「另一陣營全滅」，
    // 這個移出動作發生的當下就是檢查這類條件的正確時機點。
    await removePlayerFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, player.playerId, 'died');
  }
}

async function removePlayerFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId, reason) {
  const sockets = await io.in(roomCode).fetchSockets();
  const targetSocket = sockets.find((s) => s.data.playerId === playerId);
  if (targetSocket) {
    targetSocket.emit('game:removedFromGame', { reason });
    targetSocket.leave(roomCode);
    targetSocket.data.roomCode = null;
    targetSocket.data.playerId = null;
  }
  await handlePlayerDisconnectedFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId);
}
```

`removePlayerFromGame`直接重用既有的`handlePlayerDisconnectedFromGame`（[socketHandlers.js:1513](../../../server/src/socketHandlers.js)）——它已經做了「標記`connected:false`＋檢查是否所有真人都斷線＋是的話呼叫`closeLobbyRoom`回收房間」，跟死亡移出需要的後半段完全一樣，不用重寫。`removePlayerFromGame`只多做disconnect handler不需要做的部分：死亡玩家的socket還活著（不像真的斷線，socket早就斷了），需要主動讓它離開io房間、清空`socket.data`、並推播新事件`game:removedFromGame`（帶`reason:'died'`）讓那個玩家的client知道發生了什麼事，不能只是靜默斷開。

`removeDeadPlayersAtRoundStart`本身是冪等的（篩選條件包含`p.connected`，處理過的人`connected`已經是`false`，重複呼叫不會重複處理），也正確處理「同一輪所有真人玩家一起死亡」的情境——迴圈依序移出，`handlePlayerDisconnectedFromGame`的`anyoneStillConnected`檢查每次都看的是當下最新狀態，只有移出最後一個時才會真的觸發`closeLobbyRoom`，不會有房間被提前收掉、後面的移出操作在已拆除的房間上執行的問題。

**呼叫點**：`handleLockPhase`的兩個分支、以及`handlePhaseTimeout`各自在`scheduleOrRefreshPhaseTimeout`之後加一行`await removeDeadPlayersAtRoundStart(...)`。`handleLockPhase`本身是`registerSocketHandlers`裡的closure，直接拿得到所有需要的manager，不用改參數。**`scheduleOrRefreshPhaseTimeout`／`handlePhaseTimeout`目前是模組層級函式**（[socketHandlers.js:740](../../../server/src/socketHandlers.js)、[socketHandlers.js:755](../../../server/src/socketHandlers.js)），簽名只有`(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content)`，不含`lobbyManager`/`gameManager`/`characterSelectionManager`/`characterSelectTimeouts`——這幾個是`removeDeadPlayersAtRoundStart`必須要有的（萬一移出後房間要回收）。因為逾時是非同步觸發（`setTimeout`回呼跟哪個socket handler呼叫`scheduleOrRefreshPhaseTimeout`來啟動計時器無關），**兩個函式的簽名都需要新增這4個參數**，連帶現有10個呼叫`scheduleOrRefreshPhaseTimeout`的地方都要多傳這4個引數。這是這次改動裡影響範圍最大的一塊，但都是機械性的參數傳遞（呼叫端本來就都在同一個closure裡，直接就拿得到這些manager），不涉及邏輯改動。

### ⑤ 房間回收與勝利條件掛鉤——重用既有機制，不寫新邏輯

不需要額外判斷「是否所有玩家都死亡」——死亡移出走的正是`connected:false`這個訊號，跟現有的「最後一個真人玩家斷線」判斷（`handlePlayerDisconnectedFromGame`裡的`anyoneStillConnected`）共用同一套邏輯。死亡角色被移出後，如果所有真人都變成`connected:false`（不管是死亡還是真的斷線混合），`closeLobbyRoom`會被自動觸發，資源回收機制完全不用改。

`handlePlayerDisconnectedFromGame`本身也補一句註解，標明未來勝利條件系統要掛在這裡（跟④裡的註解呼應——「回合結束移出遊戲」跟「偵測到玩家斷線」是開發者指定的兩個勝利條件檢查觸發點）。

## 新增的client端事件

`game:removedFromGame`（`{reason: 'died'}`）——這次只在死亡移出時用到，只定義這一個reason值，不做成通用的多reason設計（沒有其他呼叫端需要）。前端要不要做對應的「你已死亡」畫面是後續UI工作，這次範圍只到伺服器正確推播這個事件為止。

## 測試計畫

**`server/test/game/playerEntity.test.js`**：
- `changeStat`：`hauntStarted:true`且扣血扣到`skullIndex`，真人玩家的`isDead`變`true`；扣到`skullIndex`以上（沒真的到）則`isDead`維持`false`；`hauntStarted:false`時永遠不會扣到`skullIndex`（既有邊界規則的回歸驗證）；NPC（`isNPC:true`）即使扣到`skullIndex`也不會被標記`isDead`

**`server/test/game/phaseFlow.test.js`**：
- `enterPhase`進入`settlement`時，`pendingHauntGraceCheck:true`且某玩家某項能力卡在`skullIndex+1`，該玩家被標記`isDead`；旗標被清成`false`；沒有旗標時進入`settlement`不會做任何額外檢查
- `allParticipantsLocked`：某參與者`isDead:true`但`phaseLocked:false`，仍然視為條件滿足
- `resetPhaseLocks`：死亡玩家進入新階段時`phaseLocked`直接是`true`

**`server/test/socketHandlers.test.js`**：
- 玩家在`player_interact`階段用掉行動力前，因為某效果扣血扣到骷髏頭刻度死亡——同一回合的`player_interact`（如果死在`player_move`）或既有其他真人玩家不用等他就能推進到`settlement`
- 死亡玩家在下一輪`player_move`開始時，被移出遊戲：收到`game:removedFromGame`、其他玩家收到的`game:stateUpdate`裡該玩家`connected:false`、`fetchSockets()`確認該socket已離開io房間
- 邪祟降臨當下已經卡在骷髏頭上一格、該回合`settlement`前有治療效果把能力救回`skullIndex+2`以上——不會死亡
- 同一情境但沒有治療——`settlement`階段時被標記`isDead`，下一輪`player_move`開始時被移出
- 兩位真人玩家在同一輪雙雙死亡——下一輪`player_move`開始時，兩人依序被移出，房間在移出第二人時才真正被`closeLobbyRoom`回收（`getGameState`變成`undefined`）

## 自我檢查

- 無占位符／待定事項
- 死亡判定的兩種情況（即時死亡／邪祟降臨當下特例）在背景與核心設計①②兩節的說明一致
- `allParticipantsLocked`的死亡bypass跟斷線刻意採用不同時機（當下階段立即不等 vs 下一階段才不等），已在③明確對比說明原因
- 範圍單一：只處理死亡判定本身、死亡不擋階段推進、回合結束移出遊戲三件事；邪祟降臨（叛徒/生還者分陣營）、勝利條件實際邏輯、NPC死亡皆明確排除並已在文件開頭列出
- 已知較大的改動範圍：`scheduleOrRefreshPhaseTimeout`/`handlePhaseTimeout`簽名擴充＋10個既有呼叫點都要多傳4個參數——純機械性改動，已在④說明原因（逾時是非同步觸發，無法只從`handleLockPhase`單一路徑涵蓋所有「回合結束」的情況）
