import { useEffect, useRef, useState } from 'react';
import RoomTile from './RoomTile';
import PlayerBadge from './PlayerBadge';
import { findRoomInfo } from './mapUtils';

// 房間圖片局部縮放（跟瀏覽器原生縮放脫鉤，只影響中心房間格本身）：固定五段倍率，
// 每次點擊放大鏡圖示跳一級，不是連續縮放。
const ZOOM_STEPS = [100, 150, 200, 250, 300];

// 縮放後允許單指/滑鼠拖動查看四角，但不能拖到圖片邊緣露出房間格外的空白——
// 圖片被放大 zoom/100 倍後，單邊多出來的可拖動範圍是 (zoom/100 - 1) * tileSizePx / 2。
function clampPan(pan, zoomLevel, tileSizePx) {
  const maxOffset = ((zoomLevel / 100) - 1) * tileSizePx / 2;
  return {
    x: Math.max(-maxOffset, Math.min(maxOffset, pan.x)),
    y: Math.max(-maxOffset, Math.min(maxOffset, pan.y)),
  };
}

// The room tile's size comes from --tile-size, and each neighbor peek's
// thickness from --peek-size -- both CSS custom properties set by an
// ancestor (DebugGameScreen) as fractions of --total-square (0.7 and 0.15
// respectively, per the developer's spec), so this view fills whatever
// square space it's given without needing to know the actual pixel values.
const NEG_PEEK = 'calc(-1 * var(--peek-size))';

function peekStyle(direction) {
  const base = { position: 'absolute' };
  if (direction === 'north') {
    return {
      ...base,
      top: NEG_PEEK,
      left: 0,
      width: '100%',
      height: 'var(--peek-size)',
      backgroundSize: 'var(--tile-size) var(--tile-size)',
      backgroundPosition: 'bottom',
    };
  }
  if (direction === 'south') {
    return {
      ...base,
      bottom: NEG_PEEK,
      left: 0,
      width: '100%',
      height: 'var(--peek-size)',
      backgroundSize: 'var(--tile-size) var(--tile-size)',
      backgroundPosition: 'top',
    };
  }
  if (direction === 'east') {
    return {
      ...base,
      top: 0,
      right: NEG_PEEK,
      width: 'var(--peek-size)',
      height: '100%',
      backgroundSize: 'var(--tile-size) var(--tile-size)',
      backgroundPosition: 'left',
    };
  }
  // west
  return {
    ...base,
    top: 0,
    left: NEG_PEEK,
    width: 'var(--peek-size)',
    height: '100%',
    backgroundSize: 'var(--tile-size) var(--tile-size)',
    backgroundPosition: 'right',
  };
}

const BADGE_EDGE_MARGIN = 8;
const BADGE_STAGGER_PERCENT = 8;

// Positions a player's badge at the edge of the room tile they entered
// through (enteredFromSide is the OPPOSITE of the move direction -- moving
// north means you walked in through the room's south wall). null means
// spawned here or arrived via stairs, so the badge sits centered. Percentage
// + transform based so it works at any tile size.
// Diameter's radius (half of the 75%-of-door-frame diameter below) -- the
// edge-anchored positions below add this on top of BADGE_EDGE_MARGIN, so the
// badge sits one radius further into the room from where it used to touch
// the edge (per the developer's visual adjustment).
const BADGE_RADIUS = 'calc(var(--peek-size) * 0.375)';
const BADGE_INSET = `calc(${BADGE_EDGE_MARGIN}px + ${BADGE_RADIUS})`;

function badgeStyle(enteredFromSide, index, total) {
  const stagger = (index - (total - 1) / 2) * BADGE_STAGGER_PERCENT;
  // Diameter is 75% of the door frame's width, i.e. the neighbor-peek band
  // thickness (--peek-size) -- the same strip the room art's door opening
  // renders into, scaled down per the developer's visual adjustment.
  const size = { width: 'calc(var(--peek-size) * 0.75)', height: 'calc(var(--peek-size) * 0.75)' };
  switch (enteredFromSide) {
    case 'north':
      return {
        position: 'absolute',
        top: BADGE_INSET,
        left: `calc(50% + ${stagger}%)`,
        transform: 'translateX(-50%)',
        ...size,
      };
    case 'south':
      return {
        position: 'absolute',
        bottom: BADGE_INSET,
        left: `calc(50% + ${stagger}%)`,
        transform: 'translateX(-50%)',
        ...size,
      };
    case 'east':
      return {
        position: 'absolute',
        right: BADGE_INSET,
        top: `calc(50% + ${stagger}%)`,
        transform: 'translateY(-50%)',
        ...size,
      };
    case 'west':
      return {
        position: 'absolute',
        left: BADGE_INSET,
        top: `calc(50% + ${stagger}%)`,
        transform: 'translateY(-50%)',
        ...size,
      };
    default:
      return {
        position: 'absolute',
        top: '50%',
        left: `calc(50% + ${stagger}%)`,
        transform: 'translate(-50%, -50%)',
        ...size,
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

// Breaks a label into chunkSize-character lines, mirroring DebugGameScreen's
// corner-button treatment so direction labels share the same per-character
// sizing. East/west sit in a peek-size-*wide* band (chunkSize 1 stacks the
// 2 characters vertically so they fit the narrow width); north/south sit in
// a peek-size-*tall*-but-full-width band (chunkSize 2 keeps them on one line).
function wrapLabel(text, chunkSize) {
  if (text.length <= chunkSize) return text;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize));
  return chunks.map((chunk, i) => (
    <span key={i}>
      {chunk}
      {i < chunks.length - 1 && <br />}
    </span>
  ));
}

// Centers a move/open-door button inside the 15%-wide neighbor-peek band on
// the given side, floating just above the room image / neighbor peek so it's
// always clickable and never covered. Font size is a fixed 24px, matching
// DebugGameScreen's corner buttons, so all these small floating buttons
// read at a consistent size.
function directionButtonStyle(direction) {
  const base = { position: 'absolute', zIndex: 10, fontSize: 20, lineHeight: 1, textAlign: 'center' };
  if (direction === 'north') {
    return { ...base, top: 'calc(-1 * var(--peek-size) / 2)', left: '50%', transform: 'translate(-50%, -50%)' };
  }
  if (direction === 'south') {
    return { ...base, bottom: 'calc(-1 * var(--peek-size) / 2)', left: '50%', transform: 'translate(-50%, 50%)' };
  }
  if (direction === 'east') {
    return { ...base, right: 'calc(-1 * var(--peek-size) / 2)', top: '50%', transform: 'translate(50%, -50%)' };
  }
  // west
  return { ...base, left: 'calc(-1 * var(--peek-size) / 2)', top: '50%', transform: 'translate(-50%, -50%)' };
}

function findCharacterIcon(characterId, characterContent) {
  if (!characterContent || !characterId) return null;
  const character = characterContent.find((c) => c.id === characterId);
  return character?.fileicon ? `/images/${character.fileicon}` : null;
}

export default function FocusedRoomView({
  currentRoom,
  boardRooms,
  roomContent,
  roomsInSameSpot,
  allPlayers,
  characterContent,
  directions,
  onMove,
}) {
  const currentInfo = findRoomInfo(currentRoom.roomId, roomContent);

  const [zoomLevel, setZoomLevel] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const tileClipRef = useRef(null);
  const dragRef = useRef(null); // { startClientX, startClientY, startPan } while a drag is in progress

  // 離開這間房間（座標或房間本身變了）就重置縮放/拖動，避免玩家回到同一間房卻卡在
  // 上次的縮放狀態、搞混方向。
  useEffect(() => {
    setZoomLevel(100);
    setPan({ x: 0, y: 0 });
  }, [currentRoom.roomId, currentRoom.x, currentRoom.y]);

  function stepZoom(delta) {
    setZoomLevel((z) => {
      const idx = ZOOM_STEPS.indexOf(z);
      const nextIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + delta));
      const next = ZOOM_STEPS[nextIdx];
      const tileSizePx = tileClipRef.current ? tileClipRef.current.getBoundingClientRect().width : 0;
      setPan((p) => clampPan(p, next, tileSizePx));
      return next;
    });
  }

  function handlePointerDown(e) {
    if (zoomLevel <= 100) return;
    // setPointerCapture can throw (e.g. stale/invalid pointerId) -- that must not
    // stop dragRef from being set below, or the drag silently never starts.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nice-to-have (keeps receiving move events if the pointer
      // leaves the element); dragging still works without it.
    }
    dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startPan: pan };
  }
  function handlePointerMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startClientX;
    const dy = e.clientY - dragRef.current.startClientY;
    const tileSizePx = tileClipRef.current.getBoundingClientRect().width;
    setPan(clampPan({ x: dragRef.current.startPan.x + dx, y: dragRef.current.startPan.y + dy }, zoomLevel, tileSizePx));
  }
  function handlePointerUp() {
    dragRef.current = null;
  }

  return (
    <div style={{ position: 'relative', width: 'var(--tile-size)', height: 'var(--tile-size)' }}>
      {directions
        .filter((d) => d.kind === 'move')
        .map((d) => (
          <NeighborPeek key={d.direction} direction={d.direction} neighborRoom={d.neighborRoom} roomContent={roomContent} />
        ))}
      <div
        ref={tileClipRef}
        style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <RoomTile
          filename={currentInfo?.filename}
          name={currentInfo?.name}
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel / 100})`,
            transformOrigin: 'center',
            touchAction: zoomLevel > 100 ? 'none' : 'auto',
          }}
        />
        {zoomLevel < ZOOM_STEPS[ZOOM_STEPS.length - 1] && (
          <button
            onClick={() => stepZoom(1)}
            style={{ position: 'absolute', top: 4, right: 4, zIndex: 10, fontSize: 14, lineHeight: 1, padding: '2px 4px', borderRadius: 4, border: '1px solid #999', backgroundColor: 'rgba(255,255,255,0.85)', cursor: 'pointer' }}
          >
            🔍+
          </button>
        )}
        {zoomLevel > 100 && (
          <button
            onClick={() => stepZoom(-1)}
            style={{ position: 'absolute', bottom: 4, left: 4, zIndex: 10, fontSize: 14, lineHeight: 1, padding: '2px 4px', borderRadius: 4, border: '1px solid #999', backgroundColor: 'rgba(255,255,255,0.85)', cursor: 'pointer' }}
          >
            🔍-
          </button>
        )}
      </div>
      {roomsInSameSpot.map((p, i) => {
        const colorIndex = allPlayers.findIndex((ap) => ap.playerId === p.playerId);
        return (
          <PlayerBadge
            key={p.playerId}
            name={p.name}
            colorIndex={colorIndex === -1 ? i : colorIndex}
            iconSrc={findCharacterIcon(p.characterId, characterContent)}
            style={badgeStyle(p.enteredFromSide, i, roomsInSameSpot.length)}
          />
        );
      })}
      {directions.map((d) => (
        <button
          key={d.direction}
          onClick={() => onMove(d.direction)}
          style={{
            ...directionButtonStyle(d.direction),
            border: d.kind === 'move' ? '2px solid #2ecc71' : '2px solid #e74c3c',
            backgroundColor: d.kind === 'move' ? '#eafaf1' : '#fadbd8',
            borderRadius: 4,
            padding: '2px 6px',
          }}
        >
          {wrapLabel(d.kind === 'move' ? '移動' : '解鎖', d.direction === 'east' || d.direction === 'west' ? 1 : 2)}
        </button>
      ))}
    </div>
  );
}
