# 遊戲進行中斷線視同一般玩家設計文件

**日期**：2026-09-05
**範圍**：`game:started`之後，房主斷線/離開不再有特殊待遇（跟一般玩家斷線處理方式相同）；一個已知斷線的玩家，從他斷線之後的**下一個新階段**開始，不再擋著其他玩家推進階段（他斷線當下所在的那個階段，仍照舊靠既有的階段逾時機制處理）；操控中的NPC比照其操控者的連線狀態；已開始的對局，最後一個還連著的真人玩家也斷線時，觸發跟現有房主離開完全相同的房間清理（沿用上次已完成的[房間清空時資源回收](2026-09-05-room-teardown-on-close-design.md)機制，不寫新的清理邏輯）。`lobby:leave`套用完全相同的判斷邏輯。**不包含**：斷線通知/UI提示（已記錄為獨立待辦「全局廣播訊息清單及UI」）、重連機制、AI代管斷線玩家/NPC（皆已記錄為長期待辦）。

## 背景

查證確認`isHost`在整個`server/src`只有3個呼叫點，其中2個是`lobby:leave`／`disconnect`handler目前無條件把「房主離開」跟「收掉整個房間」綁在一起，完全沒有檢查遊戲是否已經開始。`server/src/game/`（真正的遊戲引擎邏輯）完全沒有`isHost`／`hostPlayerId`的痕跡——房主純粹是`lobbyManager`這一層的概念，遊戲引擎本身不知道誰是房主。這代表「進入遊戲之後房主等同一般玩家」這個規則不需要在遊戲引擎裡拆解任何房主特權，只需要修正`socketHandlers.js`裡這兩個handler的判斷邏輯本身。

`phaseFlow.js`目前的`allParticipantsLocked`（[phaseFlow.js:35](../../../server/src/game/phaseFlow.js)）要求該階段**每一個**參與者都`phaseLocked`才會推進，斷線玩家永遠無法主動觸發這個動作（沒有連線），只能靠既有的階段逾時機制（`handlePhaseTimeout`）強制鎖定他，等於每個有斷線玩家的階段都要跑滿整個逾時秒數才能推進。

## 核心設計：只改`resetPhaseLocks`，不改`allParticipantsLocked`

原本考慮直接修改`allParticipantsLocked`排除斷線玩家，但這樣會讓玩家**斷線當下正在進行的那個階段**也提早結束——不符合開發者的規則（「一個玩家首次斷線的那個階段…仍保持走原先規劃的逾時機制」，因為這個階段可能還有該玩家懸置中的道具介入/道具遺留選擇，需要靠既有逾時機制的強制決議邏輯正確收尾）。

改用更精準對應規則的做法：**只改`resetPhaseLocks`**（[phaseFlow.js:39](../../../server/src/game/phaseFlow.js)，每次`enterPhase`進入新階段時呼叫，負責把所有參與者的`phaseLocked`重設）。目前無條件重設成`false`；改成「進入這個新階段的當下，這個參與者如果已經是斷線狀態，直接視為已鎖定」：

```javascript
function resetPhaseLocks(gameState, phase) {
  for (const p of getParticipants(gameState, phase)) {
    p.phaseLocked = p.isNPC
      ? !(getPlayer(gameState, p.controlledBy)?.connected ?? true)
      : !p.connected;
  }
}
```

（NPC比照操控者的`connected`狀態，找不到操控者時預設視為連線中，避免誤鎖——這種情況理論上不會發生，因為玩家永遠不會從`gameState.players`被移除，只會被標記斷線）

這樣完全不用改`allParticipantsLocked`／`lockPlayerPhase`／逾時機制本身，兩種情境自然分流：

- **玩家斷線當下所在的階段**：他是在連線狀態下進入這個階段的（`resetPhaseLocks`當時把他設成`false`），斷線後沒有任何程式碼會重新評估這個值，所以這個階段照舊要等到逾時才會被強制鎖定——完全符合「這次斷線狀態仍保持走原先規劃的逾時機制」
- **下一個新階段開始**：`resetPhaseLocks`發現他已經是斷線狀態，直接把他設成已鎖定，其他真人玩家確認完就能直接推進，不用等他

`phaseFlow.js:22-26`有一段關於NPC的舊註解（「Handover item 8 -- not implemented in this codebase yet」）已經過時（NPC操控機制已於2026-09-03實作完成），這次不順手修正（跟這次改動無關，不在範圍內，僅記錄供之後注意）。

## `connected`欄位

`createPlayer`（[playerEntity.js:44](../../../server/src/game/playerEntity.js)）新增`connected: true`預設值，比照同一函式裡其他欄位的風格。NPC（`createNpc`，[playerEntity.js:69](../../../server/src/game/playerEntity.js)）**不需要**自己的`connected`欄位——它已經有`controlledBy`欄位記錄操控者是誰，NPC的連線狀態直接查操控者的即可，不維護第二份重複資料。

## `disconnect`／`lobby:leave` handler改法

兩個handler套用完全相同的判斷邏輯（開發者已確認`lobby:leave`也要套用，防禦不會有client繞過前端直接送這個事件）：判斷式從「是不是房主」改成「遊戲是否已經開始」（`getGameState(gameManager, roomCode)`是否有entry）。

**`disconnect`**（[socketHandlers.js:648-661](../../../server/src/socketHandlers.js)），從：

```javascript
    socket.on('disconnect', async () => {
      const { roomCode, playerId } = socket.data;
      if (roomCode && playerId) {
        if (lobbyManager.isHost(roomCode, playerId)) {
          await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
        } else {
          // No teardownRoom call here: the host is never removed via this path,
          // so the room's io membership can never reach zero this way -- see
          // closeLobbyRoom, which is the only place that can happen.
          lobbyManager.leaveRoom(roomCode, playerId);
          broadcastPlayers(io, lobbyManager, roomCode);
        }
      }
    });
```

改成：

```javascript
    socket.on('disconnect', async () => {
      const { roomCode, playerId } = socket.data;
      if (roomCode && playerId) {
        const gameState = getGameState(gameManager, roomCode);
        if (gameState) {
          await handlePlayerDisconnectedFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId);
        } else if (lobbyManager.isHost(roomCode, playerId)) {
          await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
        } else {
          // No teardownRoom call here: the host is never removed via this path,
          // so the room's io membership can never reach zero this way -- see
          // closeLobbyRoom, which is the only place that can happen.
          lobbyManager.leaveRoom(roomCode, playerId);
          broadcastPlayers(io, lobbyManager, roomCode);
        }
      }
    });
```

`lobby:leave`（[socketHandlers.js:627-646](../../../server/src/socketHandlers.js)）比照同樣的改法，`if (lobbyManager.isHost(...))`分支前面插入同樣的`gameState`檢查（差異只在於這個handler本來就有`ack({})`要在最後呼叫，其餘一致）。

新增共用函式`handlePlayerDisconnectedFromGame`（放在`closeLobbyRoom`附近）：

```javascript
async function handlePlayerDisconnectedFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId) {
  const player = getPlayer(gameState, playerId);
  if (player) {
    player.connected = false;
  }
  const anyoneStillConnected = Array.from(gameState.players.values())
    .filter((p) => !p.isNPC)
    .some((p) => p.connected);
  if (!anyoneStillConnected) {
    // Every real player of this already-started game has now disconnected --
    // closeLobbyRoom doesn't care who triggered it or how many sockets are
    // actually still in the room (it kicks whoever's left, which is
    // correctly zero here), so reusing it is exactly the same teardown path
    // the host-leaves-the-lobby case already uses.
    await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
  }
}
```

`getPlayer`已經在`socketHandlers.js`頂端匯入（`require('./game/gameState')`），不用新增import。

**這次不做**：標記斷線的同時廣播`game:stateUpdate`／UI提示——已確認記錄為獨立待辦「全局廣播訊息清單及UI」，這次純粹是後端邏輯，不牽涉前端或新的廣播事件。

## 測試計畫

**`server/test/game/phaseFlow.test.js`（或既有涵蓋`resetPhaseLocks`/`enterPhase`的測試檔案）**：
- 玩家在某階段被標記`connected:false`後，同一個階段（`resetPhaseLocks`已經跑過、`phaseLocked`已經是`false`）**不會**自動被視為已鎖定，仍需要逾時才能推進（既有行為，回歸驗證用）
- 進入下一個新階段時，已知斷線的玩家的`phaseLocked`在`resetPhaseLocks`跑完後直接是`true`
- 操控中的NPC，操控者標記斷線後，NPC所在的下一個`npc_move`/`npc_interact`階段開始時`phaseLocked`也直接是`true`

**`server/test/socketHandlers.test.js`**：
- 房主在遊戲已經開始後斷線，驗證：**不會**觸發`lobby:closed`廣播（跟目前既有測試「the host disconnecting…also closes the room」的行為在game-started情境下相反，需要新增一個獨立的game-started版本，不修改既有的lobby-stage測試）、`getPlayer(gameState, aliceId).connected`變成`false`、`getGameState(gameManager, roomCode)`**依然存在**（房間沒有被收掉，因為還有另一個真人玩家連著）
- 兩個真人玩家的已開始對局，兩人依序都斷線後，驗證第二個人斷線時才觸發`closeLobbyRoom`的完整效果（`getGameState`/`getResolver`變成`undefined`，複用上次已經驗證過的斷言模式）
- `lobby:leave`（不是`disconnect`）在遊戲已經開始後被送出，驗證行為跟`disconnect`版本一致（同一個共用函式）
- 大廳階段（遊戲還沒開始）房主離開/斷線，既有4個測試（[socketHandlers.test.js:373](../../../server/test/socketHandlers.test.js)起）維持不動，驗證仍然全部通過

## 自我檢查

- 無占位符／待定事項
- 核心設計段落（只改`resetPhaseLocks`）跟背景段落對「為什麼不改`allParticipantsLocked`」的理由前後一致
- 範圍單一：只處理「房主斷線視同一般玩家」＋「斷線玩家不擋下一階段」＋NPC比照操控者＋沿用既有房間清理機制，斷線通知/UI、重連機制、AI代管均明確排除在外並已記錄為獨立待辦
