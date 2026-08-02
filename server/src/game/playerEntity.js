const STATS = ['might', 'speed', 'knowledge', 'sanity'];

function createPlayer({ playerId, name, floor, x, y, stats, actionPoints }) {
  // Validate that all required stats are defined with a complete shape
  for (const stat of STATS) {
    const def = stats[stat];
    if (!def || !Number.isInteger(def.current) || !Number.isInteger(def.max) || !Number.isInteger(def.skullValue)) {
      throw new Error('MISSING_STAT_DEFINITION');
    }
  }

  const statTracks = {};
  for (const stat of STATS) {
    const def = stats[stat];
    statTracks[stat] = {
      current: def.current,
      max: def.max,
      skullValue: def.skullValue,
      overflow: 0,
    };
  }
  return {
    playerId,
    name,
    floor,
    x,
    y,
    stats: statTracks,
    actionPoints,
    inventory: [],
  };
}

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
  if (delta > 0) {
    const room = track.max - track.current;
    if (delta <= room) {
      track.current += delta;
    } else {
      track.current = track.max;
      track.overflow += delta - room;
    }
  } else if (delta < 0) {
    let amount = -delta;
    const fromOverflow = Math.min(track.overflow, amount);
    track.overflow -= fromOverflow;
    amount -= fromOverflow;
    const minStat = hauntStarted ? track.skullValue : track.skullValue + 1;
    track.current = Math.max(track.current - amount, minStat);
  }
}

function resetActionPoints(player) {
  player.actionPoints = player.stats.speed.current;
}

function movePlayerTo(player, floor, x, y) {
  player.floor = floor;
  player.x = x;
  player.y = y;
}

module.exports = { STATS, createPlayer, changeStat, resetActionPoints, movePlayerTo };
