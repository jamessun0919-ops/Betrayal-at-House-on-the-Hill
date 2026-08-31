import { findRoomInfo, getSpecialRoomEntries } from './mapUtils';

const CELL_SIZE = 48;

export default function OverviewMap({ visitedRooms, floor, onFloorChange, boardRooms, board, roomContent, playerX, playerY }) {
  const onThisFloor = visitedRooms.filter((v) => v.floor === floor);
  const specialRoomEntries = getSpecialRoomEntries(visitedRooms, board, roomContent);

  return (
    <div>
      <div>
        <button onClick={() => onFloorChange('ground')} disabled={floor === 'ground'}>
          地面層
        </button>
        <button onClick={() => onFloorChange('upper')} disabled={floor === 'upper'}>
          樓上
        </button>
        <button onClick={() => onFloorChange('basement')} disabled={floor === 'basement'}>
          地下室
        </button>
      </div>
      {onThisFloor.length === 0 ? (
        <p>這個樓層還沒探索過</p>
      ) : (
        (() => {
          const xs = onThisFloor.map((v) => v.x);
          const ys = onThisFloor.map((v) => v.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const cols = maxX - minX + 1;
          const rows = maxY - minY + 1;
          return (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, ${CELL_SIZE}px)`,
                gridTemplateRows: `repeat(${rows}, ${CELL_SIZE}px)`,
                gap: 2,
              }}
            >
              {onThisFloor.map((v) => {
                const boardRoom = boardRooms.find((r) => r.x === v.x && r.y === v.y);
                const info = boardRoom ? findRoomInfo(boardRoom.roomId, roomContent) : null;
                const isPlayerHere = v.x === playerX && v.y === playerY;
                return (
                  <div
                    key={`${v.x},${v.y}`}
                    style={{
                      gridColumn: v.x - minX + 1,
                      gridRow: v.y - minY + 1,
                      backgroundColor: '#8a8a8a',
                      color: '#fff',
                      fontSize: '0.65em',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      overflow: 'hidden',
                      border: isPlayerHere ? '2px solid #f1c40f' : '1px solid #555',
                    }}
                  >
                    {info?.name || '?'}
                  </div>
                );
              })}
            </div>
          );
        })()
      )}
      <div>
        <h4>所在陣營</h4>
        <p>冒險陣營</p>
      </div>
      <div>
        <h4>勝利條件</h4>
        <p>未揭露</p>
      </div>
      <div>
        <h4>特殊房間紀錄</h4>
        {specialRoomEntries.length === 0 ? (
          <p>尚未發現任何特殊房間效果</p>
        ) : (
          <ul>
            {specialRoomEntries.map(({ roomId, name, effectDescription }) => (
              <li key={roomId}>
                <strong>{name}</strong>：{effectDescription}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
