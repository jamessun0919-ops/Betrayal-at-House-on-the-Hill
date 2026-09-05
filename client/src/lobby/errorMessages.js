const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: '找不到這個房號，請確認後再試一次',
  INVALID_NAME: '暱稱不可為空白，且長度不可超過 20 個字',
  INVALID_PHASE_TIMEOUT: '每階段秒數必須是 20~90 之間的整數',
  ALREADY_IN_ROOM: '您已經在房間內了',
  ROOM_IN_PROGRESS: '這個大廳已經開始遊戲了，無法加入',
  NOT_IN_ROOM: '您目前不在任何房間內',
  TOO_FEW_PLAYERS: '至少需要 2 位玩家才能開始',
  CHARACTER_SELECT_NOT_YOUR_TURN: '還沒輪到你選擇',
  UNKNOWN_CHARACTER: '找不到這個角色',
  CHARACTER_ALREADY_TAKEN: '這個角色已經被選走了',
};

export function translateError(code) {
  return ERROR_MESSAGES[code] || '發生未知錯誤，請稍後再試';
}
