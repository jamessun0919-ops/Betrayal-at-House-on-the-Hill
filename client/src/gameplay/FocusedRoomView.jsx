import RoomTile from './RoomTile';
import PlayerBadge from './PlayerBadge';
import { getAvailableDirections, findRoomInfo } from './mapUtils';

// The room tile's size comes from the --tile-size CSS custom property set by
// an ancestor (DebugGameScreen), so this view fills whatever square space
// it's given -- see the DebugGameScreen comment on --total-square/--tile-size
// for how that's computed. Neighbor peeks are expressed as percentages of
// the tile (25% each side), matching the fixed PEEK_SIZE:TILE_SIZE ratio
// (90:360) this view used before going responsive.
const PEEK_PERCENT = 25;

function peekStyle(direction) {
  const base = { position: 'absolute' };
  if (direction === 'north') {
    return {
      ...base,
      top: `-${PEEK_PERCENT}%`,
      left: 0,
      width: '100%',
      height: `${PEEK_PERCENT}%`,
      backgroundSize: 'var(--tile-size) var(--tile-size)',
      backgroundPosition: 'bottom',
      maskImage: 'linear-gradient(to top, black, transparent)',
      WebkitMaskImage: 'linear-gradient(to top, black, transparent)',
    };
  }
  if (direction === 'south') {
    return {
      ...base,
      bottom: `-${PEEK_PERCENT}%`,
      left: 0,
      width: '100%',
      height: `${PEEK_PERCENT}%`,
      backgroundSize: 'var(--tile-size) var(--tile-size)',
      backgroundPosition: 'top',
      maskImage: 'linear-gradient(to bottom, black, transparent)',
      WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
    };
  }
  if (direction === 'east') {
    return {
      ...base,
      top: 0,
      right: `-${PEEK_PERCENT}%`,
      width: `${PEEK_PERCENT}%`,
      height: '100%',
      backgroundSize: 'var(--tile-size) var(--tile-size)',
      backgroundPosition: 'left',
      maskImage: 'linear-gradient(to right, black, transparent)',
      WebkitMaskImage: 'linear-gradient(to right, black, transparent)',
    };
  }
  // west
  return {
    ...base,
    top: 0,
    left: `-${PEEK_PERCENT}%`,
    width: `${PEEK_PERCENT}%`,
    height: '100%',
    backgroundSize: 'var(--tile-size) var(--tile-size)',
    backgroundPosition: 'right',
    maskImage: 'linear-gradient(to left, black, transparent)',
    WebkitMaskImage: 'linear-gradient(to left, black, transparent)',
  };
}

const BADGE_EDGE_MARGIN = 8;
const BADGE_STAGGER_PERCENT = 8;

// Positions a player's badge at the edge of the room tile they entered
// through (enteredFromSide is the OPPOSITE of the move direction -- moving
// north means you walked in through the room's south wall). null means
// spawned here or arrived via stairs, so the badge sits centered. Percentage
// + transform based so it works at any tile size.
function badgeStyle(enteredFromSide, index, total) {
  const stagger = (index - (total - 1) / 2) * BADGE_STAGGER_PERCENT;
  switch (enteredFromSide) {
    case 'north':
      return {
        position: 'absolute',
        top: BADGE_EDGE_MARGIN,
        left: `calc(50% + ${stagger}%)`,
        transform: 'translateX(-50%)',
      };
    case 'south':
      return {
        position: 'absolute',
        bottom: BADGE_EDGE_MARGIN,
        left: `calc(50% + ${stagger}%)`,
        transform: 'translateX(-50%)',
      };
    case 'east':
      return {
        position: 'absolute',
        right: BADGE_EDGE_MARGIN,
        top: `calc(50% + ${stagger}%)`,
        transform: 'translateY(-50%)',
      };
    case 'west':
      return {
        position: 'absolute',
        left: BADGE_EDGE_MARGIN,
        top: `calc(50% + ${stagger}%)`,
        transform: 'translateY(-50%)',
      };
    default:
      return {
        position: 'absolute',
        top: '50%',
        left: `calc(50% + ${stagger}%)`,
        transform: 'translate(-50%, -50%)',
      };
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

// Move/open-door buttons live in DebugGameScreen's left column now (not
// here) -- this view is purely the visual room square (tile + neighbor
// peeks + player badges). Only 'move' directions matter here, since only
// those get a neighbor peek; open_door directions have no neighbor room to
// peek at yet.
export default function FocusedRoomView({ player, currentRoom, boardRooms, roomContent, roomsInSameSpot, allPlayers }) {
  const currentInfo = findRoomInfo(currentRoom.roomId, roomContent);
  const moveDirections = getAvailableDirections(player, currentRoom, boardRooms).filter((d) => d.kind === 'move');

  return (
    <div style={{ position: 'relative', width: 'var(--tile-size)', height: 'var(--tile-size)' }}>
      {moveDirections.map((d) => (
        <NeighborPeek key={d.direction} direction={d.direction} neighborRoom={d.neighborRoom} roomContent={roomContent} />
      ))}
      <RoomTile
        filename={currentInfo?.filename}
        name={currentInfo?.name}
        style={{ position: 'relative', width: '100%', height: '100%' }}
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
    </div>
  );
}
