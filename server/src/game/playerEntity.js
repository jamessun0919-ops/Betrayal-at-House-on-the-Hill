const STATS = ['might', 'speed', 'knowledge', 'sanity'];

function isValidTrackShape(track) {
  return Array.isArray(track) && track.length > 0 && track.every(Number.isInteger);
}

function isNonDecreasing(track) {
  for (let i = 1; i < track.length; i++) {
    if (track[i] < track[i - 1]) return false;
  }
  return true;
}

function createPlayer({ playerId, name, characterId, floor, x, y, stats, actionPoints }) {
  for (const stat of STATS) {
    const def = stats[stat];
    if (!def || !isValidTrackShape(def.track)) {
      throw new Error('MISSING_STAT_DEFINITION');
    }
    if (!isNonDecreasing(def.track)) {
      throw new Error('INVALID_STAT_TRACK');
    }
    if (!Number.isInteger(def.skullIndex) || def.skullIndex < 0 || def.skullIndex >= def.track.length) {
      throw new Error('INVALID_SKULL_INDEX');
    }
    if (!Number.isInteger(def.baseIndex) || def.baseIndex < 0 || def.baseIndex >= def.track.length) {
      throw new Error('INVALID_BASE_INDEX');
    }
  }

  const statTracks = {};
  for (const stat of STATS) {
    const def = stats[stat];
    statTracks[stat] = {
      track: def.track.slice(),
      currentIndex: def.baseIndex,
      baseIndex: def.baseIndex,
      skullIndex: def.skullIndex,
      overflow: 0,
    };
  }
  return {
    playerId,
    name,
    characterId: characterId || null,
    floor,
    x,
    y,
    stats: statTracks,
    actionPoints,
    inventory: [],
    visitedRooms: [{ floor, x, y }],
    enteredFromSide: null, // null = arrived by spawn/stairs (badge centered), else the door side entered through
  };
}

function getStatValue(player, stat) {
  const track = player.stats[stat];
  if (!track) {
    throw new Error('UNKNOWN_STAT');
  }
  return track.track[track.currentIndex] + track.overflow;
}

// `baseIndex` is the character sheet's fixed starting position — it never
// changes after createPlayer. Cards like 藥膏/嗅鹽 ("if below base value")
// check the current track position against this fixed reference point.
function isBelowBase(player, stat) {
  const track = player.stats[stat];
  if (!track) {
    throw new Error('UNKNOWN_STAT');
  }
  return track.currentIndex < track.baseIndex;
}

// `delta` moves the stat's track index (toward index 0 = lower, toward the
// last index = higher) — it is NOT added to the track's face value, because
// the physical game's stat tracks are non-decreasing but not strictly
// increasing (e.g. [3,3,4,5,6,6,7,7,7,8]): moving one level can leave the
// effective value unchanged when it lands on a repeated entry.
function changeStat(player, stat, delta, hauntStarted) {
  const track = player.stats[stat];
  if (!track) {
    throw new Error('UNKNOWN_STAT');
  }
  if (!Number.isInteger(delta)) {
    throw new Error('INVALID_STAT_DELTA');
  }
  if (typeof hauntStarted !== 'boolean') {
    throw new Error('INVALID_HAUNT_FLAG');
  }
  const maxIndex = track.track.length - 1;
  if (delta > 0) {
    const room = maxIndex - track.currentIndex;
    if (delta <= room) {
      track.currentIndex += delta;
    } else {
      track.currentIndex = maxIndex;
      track.overflow += delta - room;
    }
  } else if (delta < 0) {
    let amount = -delta;
    const fromOverflow = Math.min(track.overflow, amount);
    track.overflow -= fromOverflow;
    amount -= fromOverflow;
    const minIndex = hauntStarted ? track.skullIndex : track.skullIndex + 1;
    track.currentIndex = Math.max(track.currentIndex - amount, minIndex);
  }
}

function resetActionPoints(player) {
  player.actionPoints = getStatValue(player, 'speed');
}

function movePlayerTo(player, floor, x, y, enteredFromSide = null) {
  player.floor = floor;
  player.x = x;
  player.y = y;
  player.enteredFromSide = enteredFromSide;
  const alreadyVisited = player.visitedRooms.some(
    (r) => r.floor === floor && r.x === x && r.y === y
  );
  if (!alreadyVisited) {
    player.visitedRooms.push({ floor, x, y });
  }
}

function addItem(player, item) {
  if (!item || typeof item.id !== 'string' || item.id.length === 0) {
    throw new Error('INVALID_ITEM');
  }
  player.inventory.push(item);
}

function removeItem(player, itemId) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_FOUND');
  }
  return player.inventory.splice(index, 1)[0];
}

function countHeldItems(player, cardContent) {
  return player.inventory.filter((held) => cardContent.items.some((i) => i.id === held.id)).length;
}

module.exports = {
  STATS,
  createPlayer,
  changeStat,
  resetActionPoints,
  movePlayerTo,
  getStatValue,
  isBelowBase,
  addItem,
  removeItem,
  countHeldItems,
};
