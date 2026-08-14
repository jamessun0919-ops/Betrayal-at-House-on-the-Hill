import RoomTile from './RoomTile';
import PlayerBadge from './PlayerBadge';
import { getAvailableDirections, findRoomInfo } from './mapUtils';

const TILE_SIZE = 360;
const PEEK_SIZE = 90;
const DIRECTION_LABELS = { north: '北', east: '東', south: '南', west: '西' };

function peekStyle(direction) {
  const base = { position: 'absolute' };
  if (direction === 'north') {
    return {
      ...base,
      top: -PEEK_SIZE,
      left: 0,
      width: TILE_SIZE,
      height: PEEK_SIZE,
      backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
      backgroundPosition: 'bottom',
      maskImage: 'linear-gradient(to top, black, transparent)',
      WebkitMaskImage: 'linear-gradient(to top, black, transparent)',
    };
  }
  if (direction === 'south') {
    return {
      ...base,
      bottom: -PEEK_SIZE,
      left: 0,
      width: TILE_SIZE,
      height: PEEK_SIZE,
      backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
      backgroundPosition: 'top',
      maskImage: 'linear-gradient(to bottom, black, transparent)',
      WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
    };
  }
  if (direction === 'east') {
    return {
      ...base,
      top: 0,
      right: -PEEK_SIZE,
      width: PEEK_SIZE,
      height: TILE_SIZE,
      backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
      backgroundPosition: 'left',
      maskImage: 'linear-gradient(to right, black, transparent)',
      WebkitMaskImage: 'linear-gradient(to right, black, transparent)',
    };
  }
  // west
  return {
    ...base,
    top: 0,
    left: -PEEK_SIZE,
    width: PEEK_SIZE,
    height: TILE_SIZE,
    backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
    backgroundPosition: 'right',
    maskImage: 'linear-gradient(to left, black, transparent)',
    WebkitMaskImage: 'linear-gradient(to left, black, transparent)',
  };
}

const BADGE_SIZE = 24;
const BADGE_GAP = 28;

// Positions a player's badge at the edge of the room tile they entered
// through (enteredFromSide is the OPPOSITE of the move direction -- moving
// north means you walked in through the room's south wall). null means
// spawned here or arrived via stairs, so the badge sits centered.
function badgeStyle(enteredFromSide, index, total) {
  const mid = TILE_SIZE / 2 - BADGE_SIZE / 2;
  const stagger = (index - (total - 1) / 2) * BADGE_GAP;
  const edgeMargin = 8;
  switch (enteredFromSide) {
    case 'north':
      return { position: 'absolute', top: edgeMargin, left: mid + stagger };
    case 'south':
      return { position: 'absolute', bottom: edgeMargin, left: mid + stagger };
    case 'east':
      return { position: 'absolute', right: edgeMargin, top: mid + stagger };
    case 'west':
      return { position: 'absolute', left: edgeMargin, top: mid + stagger };
    default:
      return { position: 'absolute', top: mid + stagger, left: mid };
  }
}

function NeighborPeek({ direction, neighborRoom, roomContent }) {
  const info = findRoomInfo(neighborRoom.roomId, roomContent);
  const style = peekStyle(direction);
  if (info && info.filename) {
    return <div style={{ ...style, backgroundImage: `url(/images/rooms/${info.filename})` }} />;
  }
  // No art yet for this neighbor -- plain faded block, no image/mask needed.
  return <div style={{ ...style, backgroundImage: 'none', backgroundColor: '#8a8a8a', opacity: 0.4 }} />;
}

export default function FocusedRoomView({
  player,
  currentRoom,
  boardRooms,
  roomContent,
  roomsInSameSpot,
  allPlayers,
  hasRoomForFloor,
  onMove,
}) {
  const currentInfo = findRoomInfo(currentRoom.roomId, roomContent);
  const directions = getAvailableDirections(player, currentRoom, boardRooms).filter(
    (d) => d.kind === 'move' || hasRoomForFloor
  );

  return (
    <div style={{ position: 'relative', width: TILE_SIZE, height: TILE_SIZE, margin: `${PEEK_SIZE + 40}px` }}>
      {directions
        .filter((d) => d.kind === 'move')
        .map((d) => (
          <NeighborPeek key={d.direction} direction={d.direction} neighborRoom={d.neighborRoom} roomContent={roomContent} />
        ))}
      <RoomTile
        filename={currentInfo?.filename}
        name={currentInfo?.name}
        style={{ position: 'relative', width: TILE_SIZE, height: TILE_SIZE }}
      />
      {roomsInSameSpot.map((p, i) => {
        const colorIndex = allPlayers.findIndex((ap) => ap.playerId === p.playerId);
        return (
          <PlayerBadge
            key={p.playerId}
            name={p.name}
            colorIndex={colorIndex === -1 ? i : colorIndex}
            style={badgeStyle(p.enteredFromSide, i, roomsInSameSpot.length)}
          />
        );
      })}
      <div style={{ position: 'absolute', top: TILE_SIZE + 8, left: 0 }}>
        {directions.map((d) => (
          <button
            key={d.direction}
            onClick={() => onMove(d.direction)}
            style={{
              marginRight: 8,
              border: d.kind === 'move' ? '2px solid #2ecc71' : '2px dashed #888',
              backgroundColor: d.kind === 'move' ? '#eafaf1' : '#f0f0f0',
            }}
          >
            {DIRECTION_LABELS[d.direction]}
            {d.kind === 'open_door' ? '？' : ''}
          </button>
        ))}
      </div>
    </div>
  );
}
