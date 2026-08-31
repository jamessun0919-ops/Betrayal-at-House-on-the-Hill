# 筆記資訊（私人資訊區塊）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「筆記資訊」私人資訊區塊併入既有的地圖總覽畫面：15 間特殊機制房間補上 `effectDescription` 資料欄位，前端按鈕改名，`OverviewMap.jsx` 新增所在陣營／勝利條件（固定文字）／特殊房間紀錄（跨樓層讀取玩家已去過、有 `effectDescription` 的房間）三段。

**Architecture:** 資料層在 `data/rooms/rooms.json` 15 間房上新增 `effectDescription: null` 欄位（開發者之後自行填寫文字內容）；前端完全不需要新的後端廣播（`roomContent` 本來就是整份房間原始資料，新欄位會自動隨 `game:started` 送達），只需要在 `mapUtils.js` 新增一個純函式 `getSpecialRoomEntries` 推導「玩家去過、有效果說明的房間」清單，`OverviewMap.jsx` 用它渲染第三段。

**Tech Stack:** React (Vite) 前端；純 JavaScript；資料層 JSON。這次範圍完全不涉及伺服器端邏輯（`effectDescription` 沒有任何伺服器程式碼讀取）。

## Global Constraints

- 15 間房清單（已與開發者確認，不可增減）：`room_chapel`／`room_library`／`room_bridge`／`room_kitchen`／`room_larder`／`room_gymnasium`／`room_vault`／`room_messy`／`room_vine_entangled`／`room_attic`／`room_pentagram`／`room_graveyard`／`room_junk`／`room_gallery`／`room_collapsed_room`
- 新欄位命名固定為 `effectDescription`（camelCase，比照既有 `feedbacktextOccur`／`needsCustomLogic` 慣例），值先填 `null` 給開發者之後自己填
- 前端按鈕文字：`'總覽地圖'` → `'筆記資訊'`；`'目前房間'`（返回鍵）維持不變
- 所在陣營／勝利條件這次只顯示邪祟降臨前的固定文字（「冒險陣營」／「未揭露」），不寫任何依邪祟狀態切換的分支邏輯——M3 範圍
- 特殊房間紀錄：只列「已去過」且 `effectDescription` 非空的房間，`effectDescription` 是 `null` 就整間跳過不顯示（不顯示「待補充」）；同一間房重複去過只列一次；要橫跨玩家去過的所有樓層，不能只看目前總覽選中的樓層
- **修改 `data/rooms/rooms.json` 一律使用精準文字取代（Edit 工具 exact old_string/new_string），絕對不可以「解析成物件→`JSON.stringify`整檔寫回」**——這是本專案已經發生過一次嚴重事故（開發者未提交的編輯被整檔重寫覆蓋掉）立下的鐵律，寫完後務必用 `node -e "JSON.parse(require('fs').readFileSync('data/rooms/rooms.json','utf8'))"` 確認整份檔案仍是合法 JSON

---

## File Structure

- **`data/rooms/rooms.json`**（修改）：15 間房各自新增 `"effectDescription": null` 欄位
- **`client/src/gameplay/mapUtils.js`**（修改）：新增 `getSpecialRoomEntries(visitedRooms, board, roomContent)` 純函式並加入 `export`
- **`client/src/gameplay/OverviewMap.jsx`**（修改）：新增 `board` prop，呼叫 `getSpecialRoomEntries`，渲染所在陣營／勝利條件／特殊房間紀錄三段
- **`client/src/DebugGameScreen.jsx`**（修改）：按鈕文字改名；`<OverviewMap>` 呼叫新增 `board={gameState.board}` prop

---

### Task 1: `data/rooms/rooms.json` 新增 15 間房的 `effectDescription` 欄位

**Files:**
- Modify: `data/rooms/rooms.json`

**Interfaces:**
- Produces: 15 間房各自多一個 `"effectDescription": null` 欄位，供 Task 2 的 `getSpecialRoomEntries` 讀取（`info.effectDescription`）

- [ ] **Step 1: 逐一新增欄位（15 次精準文字取代）**

以下每一項都用 Edit 工具的精準 old_string/new_string 取代，**不要用其他方式批次處理**。13 間用「`needsCustomLogic` 到房間物件結尾」這段當 old_string 已經足夠唯一；`room_bridge`／`room_vine_entangled` 兩間的這段文字完全相同（都是 `"needsCustomLogic": false,\n    "item": null\n  }`），所以這兩間額外把上面的 `text`／`leaveCheck` 欄位一併包進 old_string 來區分。

**執行前務必先用 Read 工具讀一次 `data/rooms/rooms.json` 該房間附近的實際內容**，逐字比對下面列出的 old_string 是否跟檔案裡的實際文字（含縮排、逗號、換行）完全一致再送出 Edit——這份計畫裡的 old_string 是從檔案內容擷取後手動轉謄到這份 Markdown 裡的，理論上應該一致，但**如果 Edit 回報找不到匹配字串，不要自己猜測或改用整段搜尋替換等其他方式**，先重新讀取該房間當下的真實文字，以檔案裡的實際內容為準調整 old_string 後再重試。

**1. room_chapel：**
```
old_string:
    "needsCustomLogic": false,
    "item": "item_050"
  }

new_string:
    "needsCustomLogic": false,
    "item": "item_050",
    "effectDescription": null
  }
```

**2. room_library：**
```
old_string:
    "needsCustomLogic": false,
    "item": "item_027"
  }

new_string:
    "needsCustomLogic": false,
    "item": "item_027",
    "effectDescription": null
  }
```

**3. room_bridge（old_string 往上多包 `text`/`leaveCheck` 避免跟 room_vine_entangled 撞在一起）：**
```
old_string:
    "text": "牆圍崩塌、大風呼呼吹嘯，這房間被分成兩側，請進行力量考驗，3+得以通向另一側。若失敗則此回合的移動階段立刻結束。",
    "effects": "可以從此房間跳下，進入一樓相對應座標的房間",
    "leaveCheck": {
      "stat": "might",
      "min": 3
    },
    "needsCustomLogic": false,
    "item": null
  }

new_string:
    "text": "牆圍崩塌、大風呼呼吹嘯，這房間被分成兩側，請進行力量考驗，3+得以通向另一側。若失敗則此回合的移動階段立刻結束。",
    "effects": "可以從此房間跳下，進入一樓相對應座標的房間",
    "leaveCheck": {
      "stat": "might",
      "min": 3
    },
    "needsCustomLogic": false,
    "item": null,
    "effectDescription": null
  }
```

**4. room_kitchen：**
```
old_string:
    "needsCustomLogic": false,
    "actions": [
      {
        "label": "搜索",
        "kind": "search"
      },
      {
        "label": "烹飪",
        "kind": "craft"
      }
    ],
    "item": "item_018",
    "craftRecipes": [
      {
        "id": "recipe_cooked_food",
        "ingredients": [
          "item_016",
          "item_017"
        ],
        "result": "item_021"
      }
    ]
  }

new_string:
    "needsCustomLogic": false,
    "actions": [
      {
        "label": "搜索",
        "kind": "search"
      },
      {
        "label": "烹飪",
        "kind": "craft"
      }
    ],
    "item": "item_018",
    "craftRecipes": [
      {
        "id": "recipe_cooked_food",
        "ingredients": [
          "item_016",
          "item_017"
        ],
        "result": "item_021"
      }
    ],
    "effectDescription": null
  }
```

**5. room_larder：**
```
old_string:
    "needsCustomLogic": false,
    "actions": [
      {
        "label": "搜索",
        "kind": "search"
      }
    ],
    "item": ["item_017","item_016","item_022"]
  }

new_string:
    "needsCustomLogic": false,
    "actions": [
      {
        "label": "搜索",
        "kind": "search"
      }
    ],
    "item": ["item_017","item_016","item_022"],
    "effectDescription": null
  }
```

**6. room_gymnasium：**
```
old_string:
    "needsCustomLogic": false,
    "actions": [
      {
        "label": "搜索",
        "kind": "search"
      }
    ],
    "item": null
  }

new_string:
    "needsCustomLogic": false,
    "actions": [
      {
        "label": "搜索",
        "kind": "search"
      }
    ],
    "item": null,
    "effectDescription": null
  }
```

**7. room_vault（`needsCustomLogic` 在這間是物件最後一個欄位，前面沒有逗號）：**
```
old_string:
              {
                "min": 0,
                "max": 5,
                "pass": false,
                "effects": []
              }
            ]
          }
        ]
      }
    ],
    "needsCustomLogic": true
  }

new_string:
              {
                "min": 0,
                "max": 5,
                "pass": false,
                "effects": []
              }
            ]
          }
        ]
      }
    ],
    "needsCustomLogic": true,
    "effectDescription": null
  }
```

**8. room_messy：**
```
old_string:
    "needsCustomLogic": false,
    "item": ["item_028","item_019","item_033","item_035","item_018","item_043"]
  }

new_string:
    "needsCustomLogic": false,
    "item": ["item_028","item_019","item_033","item_035","item_018","item_043"],
    "effectDescription": null
  }
```

**9. room_vine_entangled（old_string 往上多包 `text`/`leaveCheck` 避免跟 room_bridge 撞在一起）：**
```
old_string:
    "text": "要離開房間時，必須通過速度考驗，擲骰點數大於4才能離開",
    "effects": [],
    "leaveCheck": {
      "stat": "speed",
      "min": 5
    },
    "needsCustomLogic": false,
    "item": null
  }

new_string:
    "text": "要離開房間時，必須通過速度考驗，擲骰點數大於4才能離開",
    "effects": [],
    "leaveCheck": {
      "stat": "speed",
      "min": 5
    },
    "needsCustomLogic": false,
    "item": null,
    "effectDescription": null
  }
```

**10. room_attic：**
```
old_string:
    "needsCustomLogic": false,
    "item": "item_037"
  }

new_string:
    "needsCustomLogic": false,
    "item": "item_037",
    "effectDescription": null
  }
```

**11. room_pentagram：**
```
old_string:
    "needsCustomLogic": false,
    "item": "item_012"
  }

new_string:
    "needsCustomLogic": false,
    "item": "item_012",
    "effectDescription": null
  }
```

**12. room_graveyard：**
```
old_string:
    "needsCustomLogic": false,
    "item": "item_030"
  }

new_string:
    "needsCustomLogic": false,
    "item": "item_030",
    "effectDescription": null
  }
```

**13. room_junk：**
```
old_string:
    "needsCustomLogic": false,
    "item": ["item_039","item_034","item_028","item_026","item_044"]
  }

new_string:
    "needsCustomLogic": false,
    "item": ["item_039","item_034","item_028","item_026","item_044"],
    "effectDescription": null
  }
```

**14. room_gallery：**
```
old_string:
    "needsCustomLogic": true,
    "actions": [
      {
        "label": "搜索",
        "kind": "search"
      },
      {
        "label": "跳下",
        "kind": "teleport"
      }
    ],
    "item": ["item_022","item_023","item_042"]
  }

new_string:
    "needsCustomLogic": true,
    "actions": [
      {
        "label": "搜索",
        "kind": "search"
      },
      {
        "label": "跳下",
        "kind": "teleport"
      }
    ],
    "item": ["item_022","item_023","item_042"],
    "effectDescription": null
  }
```

**15. room_collapsed_room：**
```
old_string:
    "needsCustomLogic": true,
    "actions": [
      {
        "label": "搜索",
        "kind": "search"
      },
      {
        "label": "跳下",
        "kind": "teleport"
      }
    ],
    "item": null
  }

new_string:
    "needsCustomLogic": true,
    "actions": [
      {
        "label": "搜索",
        "kind": "search"
      },
      {
        "label": "跳下",
        "kind": "teleport"
      }
    ],
    "item": null,
    "effectDescription": null
  }
```

- [ ] **Step 2: 驗證 JSON 合法且 15 個欄位都正確新增**

Run:
```bash
node -e "
const rooms = JSON.parse(require('fs').readFileSync('data/rooms/rooms.json','utf8'));
const ids = ['room_chapel','room_library','room_bridge','room_kitchen','room_larder','room_gymnasium','room_vault','room_messy','room_vine_entangled','room_attic','room_pentagram','room_graveyard','room_junk','room_gallery','room_collapsed_room'];
const missing = ids.filter(id => !('effectDescription' in rooms.find(r=>r.id===id)));
if (missing.length > 0) { console.error('MISSING:', missing); process.exit(1); }
console.log('all 15 rooms have effectDescription, total room count:', rooms.length);
"
```
Expected: 印出 `all 15 rooms have effectDescription, total room count: 52`（52 是目前檔案總房間數，不應該因為這次編輯而改變）

- [ ] **Step 3: 跑一次後端全套測試，確認純資料新增欄位沒有影響任何既有邏輯**

Run: `cd server && npx jest`
Expected: 全數 PASS（`effectDescription` 目前沒有任何伺服器端程式碼讀取，理論上測試數量與結果都不應該變動）

- [ ] **Step 4: Commit**

```bash
git add data/rooms/rooms.json
git commit -m "feat: add effectDescription field to 15 special-mechanic rooms"
```

---

### Task 2: 前端「筆記資訊」畫面（按鈕改名＋三段私人資訊）

**依賴：Task 1 必須先完成**——這個任務的手動驗證需要真的能在 `effectDescription` 有內容的房間看到紀錄，雖然開發者尚未填實際文字，仍需要 Task 1 的欄位存在（就算是 `null`）才能驗證「沒填的房間正確跳過」這個分支。

**Files:**
- Modify: `client/src/gameplay/mapUtils.js`
- Modify: `client/src/gameplay/OverviewMap.jsx`
- Modify: `client/src/DebugGameScreen.jsx`

**Interfaces:**
- Consumes：既有 `findRoomInfo(roomId, roomContent)`（`mapUtils.js`，已存在，回傳房間完整定義物件或 `null`）
- Produces：`getSpecialRoomEntries(visitedRooms, board, roomContent)` → `[{roomId, name, effectDescription}]`，`visitedRooms` 是 `[{floor,x,y}]`（`player.visitedRooms` 既有結構），`board` 是 `gameState.board`（`{ground:[...], upper:[...], basement:[...]}`，每個樓層是房間物件陣列，每個房間物件至少有 `x`/`y`/`roomId`）

- [ ] **Step 1: 在 `mapUtils.js` 新增 `getSpecialRoomEntries`**

在 `client/src/gameplay/mapUtils.js` 的 `findCardName` 函式之後（`export` 陳述式之前）新增：

```javascript
// 給「筆記資訊」畫面用：玩家去過、且該房間定義了 effectDescription 的房間清單，
// 橫跨玩家去過的所有樓層（不只是目前總覽選中的那個樓層），同一間房只列一次。
function getSpecialRoomEntries(visitedRooms, board, roomContent) {
  const entries = [];
  const seenRoomIds = new Set();
  for (const v of visitedRooms) {
    const floorRooms = board[v.floor];
    if (!Array.isArray(floorRooms)) continue;
    const boardRoom = floorRooms.find((r) => r.x === v.x && r.y === v.y);
    if (!boardRoom || seenRoomIds.has(boardRoom.roomId)) continue;
    const info = findRoomInfo(boardRoom.roomId, roomContent);
    if (info && info.effectDescription) {
      seenRoomIds.add(boardRoom.roomId);
      entries.push({ roomId: boardRoom.roomId, name: info.name, effectDescription: info.effectDescription });
    }
  }
  return entries;
}
```

找到檔案最後一行的 `export { ... }` 陳述式（目前是：`export { STAT_LABELS, DIRECTION_DELTA, OPPOSITE_SIDE, getAvailableDirections, findRoomInfo, findCardInfo, findCardName, getRoomActions };`），改成：

```javascript
export { STAT_LABELS, DIRECTION_DELTA, OPPOSITE_SIDE, getAvailableDirections, findRoomInfo, findCardInfo, findCardName, getRoomActions, getSpecialRoomEntries };
```

- [ ] **Step 2: `OverviewMap.jsx` 新增 `board` prop 與三段私人資訊**

`client/src/gameplay/OverviewMap.jsx` 目前開頭是：

```javascript
import { findRoomInfo } from './mapUtils';

const CELL_SIZE = 48;

export default function OverviewMap({ visitedRooms, floor, onFloorChange, boardRooms, roomContent, playerX, playerY }) {
  const onThisFloor = visitedRooms.filter((v) => v.floor === floor);
```

改成：

```javascript
import { findRoomInfo, getSpecialRoomEntries } from './mapUtils';

const CELL_SIZE = 48;

export default function OverviewMap({ visitedRooms, floor, onFloorChange, boardRooms, board, roomContent, playerX, playerY }) {
  const onThisFloor = visitedRooms.filter((v) => v.floor === floor);
  const specialRoomEntries = getSpecialRoomEntries(visitedRooms, board, roomContent);
```

檔案結尾（目前是地圖格子 `<div>` 的 `)}` 收尾，緊接著元件本體的 `</div>` 與函式結尾）目前是：

```javascript
          );
        })()
      )}
    </div>
  );
}
```

改成（在原本地圖格子的 `)}` 之後、元件最外層 `</div>` 之前，插入三段新內容）：

```javascript
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
```

- [ ] **Step 3: `DebugGameScreen.jsx` 傳入 `board` prop、按鈕文字改名**

`client/src/DebugGameScreen.jsx` 裡 `<OverviewMap>` 的呼叫（目前）：

```javascript
                      <OverviewMap
                        visitedRooms={me.visitedRooms}
                        floor={overviewFloor}
                        onFloorChange={setOverviewFloor}
                        boardRooms={boardRooms}
                        roomContent={roomContent}
                        playerX={me.floor === overviewFloor ? me.x : null}
                        playerY={me.floor === overviewFloor ? me.y : null}
                      />
```

改成（新增 `board={gameState.board}`）：

```javascript
                      <OverviewMap
                        visitedRooms={me.visitedRooms}
                        floor={overviewFloor}
                        onFloorChange={setOverviewFloor}
                        boardRooms={boardRooms}
                        board={gameState.board}
                        roomContent={roomContent}
                        playerX={me.floor === overviewFloor ? me.x : null}
                        playerY={me.floor === overviewFloor ? me.y : null}
                      />
```

按鈕文字（目前）：

```javascript
              <button style={cornerButtonStyle('top-right')} onClick={() => setMapMode(mapMode === 'focused' ? 'overview' : 'focused')}>
                {wrapLabel(mapMode === 'focused' ? '總覽地圖' : '目前房間', 2)}
              </button>
```

改成：

```javascript
              <button style={cornerButtonStyle('top-right')} onClick={() => setMapMode(mapMode === 'focused' ? 'overview' : 'focused')}>
                {wrapLabel(mapMode === 'focused' ? '筆記資訊' : '目前房間', 2)}
              </button>
```

- [ ] **Step 4: 啟動 client/server dev server，手動瀏覽器驗證**

用 `.claude/launch.json` 的 `server`／`client` 兩個既有設定啟動（`preview_start`）。進遊戲、確認：
1. 右上角按鈕文字顯示「筆記資訊」，點下去畫面正確切換（跟原本「總覽地圖」行為一致，只是文字換了）
2. 「筆記資訊」畫面依序看得到：地圖格子（既有內容不變）→「所在陣營：冒險陣營」→「勝利條件：未揭露」→「特殊房間紀錄」
3. 因為 `effectDescription` 目前全部是 `null`（開發者還沒填），「特殊房間紀錄」這時應該顯示「尚未發現任何特殊房間效果」——這是預期行為，不是 bug
4. 用瀏覽器 console 手動把某個已去過房間的 `effectDescription` 改成測試字串（透過 `javascript_tool` 直接修改 React state 不可行，改用：在 `data/rooms/rooms.json` 暫時把其中一間已去過的房間的 `effectDescription` 改成測試字串 → 關閉重開 server → 重新走一次角色選擇進遊戲、移動到該房間 → 確認「特殊房間紀錄」正確列出該房間名稱＋文字 → 驗證完成後把該欄位改回 `null`，這次暫時性的測試修改不要 commit）
5. console/伺服器皆無錯誤

- [ ] **Step 5: 關閉本次啟動的 dev server**

確認 `preview_stop` 兩個 server（server/client），並用 `tasklist //FI "IMAGENAME eq node.exe"` 確認沒有殘留 node 行程。

- [ ] **Step 6: Commit**

```bash
git add client/src/gameplay/mapUtils.js client/src/gameplay/OverviewMap.jsx client/src/DebugGameScreen.jsx
git commit -m "feat: add notes panel (faction/victory placeholder + special room log) to overview map"
```
