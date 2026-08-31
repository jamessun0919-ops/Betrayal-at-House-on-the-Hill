const STAT_LABELS = { might: '力量', speed: '速度', knowledge: '知識', sanity: '意志' };

const DIRECTION_DELTA = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

const OPPOSITE_SIDE = { north: 'south', south: 'north', east: 'west', west: 'east' };

// Mirrors server/src/game/turnFlow.js's getAvailableDirections. Keep this in
// sync if the server logic ever changes -- the server remains authoritative
// (game:move still validates for real), this is only for deciding which
// buttons to show.
const OPEN_DOOR_AP_COST = 2;

function hasBlocksOpenDoorModifier(player) {
  return (player.modifiers || []).some((m) =>
    (m.effects || []).some((e) => e.hookType === 'blocksOpenDoor')
  );
}

function getAvailableDirections(player, currentRoom, boardRooms) {
  const blockedFromOpeningDoors = hasBlocksOpenDoorModifier(player);
  const canAffordOpenDoor = player.actionPoints >= OPEN_DOOR_AP_COST;
  const doorSides = Array.isArray(currentRoom.doorSides) ? currentRoom.doorSides : [];
  const results = [];
  for (const direction of Object.keys(DIRECTION_DELTA)) {
    if (!doorSides.includes(direction)) continue;
    const delta = DIRECTION_DELTA[direction];
    const neighborX = currentRoom.x + delta.dx;
    const neighborY = currentRoom.y + delta.dy;
    const neighborRoom = boardRooms.find((r) => r.x === neighborX && r.y === neighborY);
    if (neighborRoom) {
      const facingSide = OPPOSITE_SIDE[direction];
      if (Array.isArray(neighborRoom.doorSides) && neighborRoom.doorSides.includes(facingSide)) {
        results.push({ direction, kind: 'move', neighborRoom });
      }
    } else if (!blockedFromOpeningDoors && canAffordOpenDoor) {
      results.push({ direction, kind: 'open_door' });
    }
  }
  return results;
}

function findRoomInfo(roomId, roomContent) {
  if (!roomContent) return null;
  return (
    roomContent.rooms.find((r) => r.id === roomId) ||
    roomContent.startingRooms.find((r) => r.id === roomId) ||
    null
  );
}

function findCardInfo(cardId, cardContent) {
  if (!cardContent) return null;
  return (
    (cardContent.items || []).find((c) => c.id === cardId) ||
    (cardContent.events || []).find((c) => c.id === cardId) ||
    (cardContent.omens || []).find((c) => c.id === cardId) ||
    null
  );
}

function findCardName(cardId, cardContent) {
  const card = findCardInfo(cardId, cardContent);
  return card ? card.name : cardId;
}

// 跟伺服器 socketHandlers.js 的 getRoomActions 同一套邏輯，前端自己重算一份
// （不新增 socket 事件）。roomDefinition 來自 roomContent（一次性靜態資料），
// placedRoom 是 gameState.board[floor] 裡目前房間的實體（含 collapseLink）。
function getRoomActions(roomDefinition, placedRoom) {
  const actions = (roomDefinition && Array.isArray(roomDefinition.actions) && roomDefinition.actions.length > 0)
    ? roomDefinition.actions
    : [{ label: '搜索', kind: 'search' }];
  return actions.filter((action) => {
    if (action.kind === 'teleport' && placedRoom.roomId === 'room_collapsed_room') {
      return Boolean(placedRoom.collapseLink);
    }
    return true;
  });
}

// 給「筆記資訊」畫面用：玩家去過、且該房間定義了 effectDescription 的房間清單，
// 橫跨玩家去過的所有樓層（不只是目前總覽選中的那個樓層），同一間房只列一次。
function getSpecialRoomEntries(visitedRooms, board, roomContent) {
  const entries = [];
  const seenRoomIds = new Set();
  for (const v of visitedRooms) {
    const floorRooms = board[v.floor];
    if (!Array.isArray(floorRooms)) continue;
    const boardRoom = floorRooms.find((r) => r.x === v.x && r.y === v.y);
    // seenRoomIds 是 roomId 層級的保險機制：目前 server（playerEntity.js 的
    // movePlayerTo）在寫入 visitedRooms 前已經用精確座標去重，所以這裡的重複
    // 目前不會被實際觸發；保留這道檢查是為了防範未來 server 端去重邏輯改變。
    if (!boardRoom || seenRoomIds.has(boardRoom.roomId)) continue;
    const info = findRoomInfo(boardRoom.roomId, roomContent);
    if (info && info.effectDescription) {
      seenRoomIds.add(boardRoom.roomId);
      entries.push({ roomId: boardRoom.roomId, name: info.name, effectDescription: info.effectDescription });
    }
  }
  return entries;
}

export { STAT_LABELS, DIRECTION_DELTA, OPPOSITE_SIDE, getAvailableDirections, findRoomInfo, findCardInfo, findCardName, getRoomActions, getSpecialRoomEntries };
