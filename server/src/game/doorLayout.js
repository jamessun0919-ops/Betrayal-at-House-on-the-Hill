const SIDES = ['north', 'east', 'south', 'west'];
const OPPOSITE_SIDE = { north: 'south', south: 'north', east: 'west', west: 'east' };

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

// All distinct k-length combinations of `array` (order within each
// combination preserved from `array`; array is small — at most 3 elements
// in this module's usage — so a simple recursive generator is sufficient.
function combinations(array, k) {
  if (k === 0) return [[]];
  if (k > array.length) return [];
  const result = [];
  function helper(start, combo) {
    if (combo.length === k) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i < array.length; i++) {
      combo.push(array[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

function computeDoorLayout(doorCount, entrySide, getNeighborRequirement, doorPattern = null) {
  if (!Number.isInteger(doorCount) || doorCount < 1 || doorCount > 4) {
    throw new Error('INVALID_DOOR_COUNT');
  }
  if (!SIDES.includes(entrySide)) {
    throw new Error('INVALID_ENTRY_SIDE');
  }
  if (typeof getNeighborRequirement !== 'function') {
    throw new Error('INVALID_NEIGHBOR_REQUIREMENT_FN');
  }
  if (doorPattern !== null && doorPattern !== 'opposite' && doorPattern !== 'adjacent') {
    throw new Error('INVALID_DOOR_PATTERN');
  }
  const otherSides = SIDES.filter((side) => side !== entrySide);

  // A declared doorPattern only disambiguates the 2-door case (opposite vs.
  // adjacent are two genuinely different shapes that can't be reached from
  // one another by rotation -- see the room-art generation prompt doc). For
  // any other door count, or when no pattern is declared, every other side
  // stays a candidate, preserving the original unrestricted behavior.
  let candidateSides = otherSides;
  if (doorCount === 2 && doorPattern) {
    const opposite = OPPOSITE_SIDE[entrySide];
    candidateSides = doorPattern === 'opposite'
      ? otherSides.filter((side) => side === opposite)
      : otherSides.filter((side) => side !== opposite);
  }

  // Exhaustively try every distinct way to pick the extra doors (at most 3
  // possible sides, so at most 3 combinations), in random order, so a
  // satisfiable layout is never missed just because a shuffle-with-replacement
  // happened not to sample it within a fixed number of attempts.
  const candidateCombos = shuffle(combinations(candidateSides, doorCount - 1));

  for (const combo of candidateCombos) {
    const extraDoors = new Set(combo);
    const hasConflict = otherSides.some((side) => {
      const requirement = getNeighborRequirement(side);
      if (requirement === null) return false;
      if (requirement !== 'door' && requirement !== 'wall') {
        throw new Error('INVALID_NEIGHBOR_REQUIREMENT_VALUE');
      }
      const wantsDoor = extraDoors.has(side);
      return (requirement === 'door') !== wantsDoor;
    });
    if (!hasConflict) {
      return new Set([entrySide, ...extraDoors]);
    }
  }

  // Fallback: entry side is guaranteed a door; every other side becomes a
  // wall, regardless of what a neighbor wanted. This is a deliberate,
  // rare-case rule confirmed with the developer.
  return new Set([entrySide]);
}

// 把單一方向依順時針旋轉 steps 個 90 度（steps 0~3）。SIDES 本身就是順時針順序。
function rotateSide(side, steps) {
  return SIDES[(SIDES.indexOf(side) + steps) % 4];
}

// 找出讓 canonicalDoors（房間圖片畫死的門位置）旋轉幾次 90 度後，會等於這個房間實例
// 真實的 doorSides。canonicalDoors 缺席時代表沒有旋轉資料，回傳 0（不旋轉）。
//
// computeDoorLayout 有一條既有的、刻意設計的 fallback（見其函式內註解）：當所有候選門
// 位置組合都跟已放置的鄰房衝突時，會放棄湊出宣告的門數，把房間強制退化成只剩入口那一
// 扇門——這是引擎既有的合法行為，不是 canonicalDoors 資料填錯，此時 doorSides 的數量
// 會比 canonicalDoors 少，直接回傳 0（不旋轉），不拋錯。已知限制（開發者已確認接受）：
// 這種情況下房間美術圖仍會畫出原本宣告的門數，但只有入口方向的行動按鈕真的可以互動；
// 玩家主要依賴方向按鈕辨認可走方向，不是靠美術圖數門，不需要額外處理。
//
// 門數相同、但四個角度都對不出真實 doorSides 的情況，才是真的資料填錯（例如
// doors:2 opposite 的房間，canonicalDoors 卻填成相鄰的兩側），維持拋錯，讓填錯的資料
// 在測試/實際遊玩時就爆出來，不要悄悄用錯的角度顯示。
function computeRotation(canonicalDoors, doorSides) {
  if (!Array.isArray(canonicalDoors) || canonicalDoors.length === 0) {
    return 0;
  }
  const target = new Set(doorSides);
  if (target.size !== canonicalDoors.length) {
    return 0;
  }
  for (let steps = 0; steps < 4; steps++) {
    const rotated = new Set(canonicalDoors.map((side) => rotateSide(side, steps)));
    if (rotated.size === target.size && [...rotated].every((side) => target.has(side))) {
      return steps * 90;
    }
  }
  throw new Error('ROTATION_NOT_FOUND');
}

module.exports = { SIDES, OPPOSITE_SIDE, computeDoorLayout, computeRotation };
