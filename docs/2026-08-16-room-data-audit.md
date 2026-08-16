# 房間／角色資料檢查報告（2026-08-16）

檢查對象：開發者本次手動編輯的 `data/characters/characters.json`、`data/rooms/rooms.json`（尚未提交），以及 `img/rooms/` 美術圖暫存資料夾現況。

## 1. 資料格式檢查

### 1.1 `rooms.json`：JSON 語法錯誤（已直接修正）

原檔案有兩處語法錯誤，已修正：

1. `room_bathroom_upper` 跟新增的 `room_beast` 之間缺一個逗號
2. 陣列最後一筆（`room_beast`）結尾多一個逗號（trailing comma，`]` 前不能有逗號）

修正後 `node -e "JSON.parse(...)"` 驗證通過，32 筆房間。

### 1.2 `rooms.json`：資料一致性問題

- **`room_abandoned_room`**：`doors` 已改成 3，但 `doorPattern: "adjacent"` 欄位還留著。`doorPattern` 只有 `doors === 2` 時才會被程式讀取，doors=3 時這個欄位會被忽略、不影響遊戲運作，但屬於殘留的無效資料，建議移除（或者如果之後想把 doors 改回 2，才需要留著）。
- **3 筆房間被「大搬風」成不同房間**（id 跟 name 都改了，不是單純改名）：
  | 原本 | 改成 | 備註 |
  |---|---|---|
  | `room_bedroom`／臥房 | `room_maid`／傭人房 | 官方房間「臥房 Bedroom」的欄位已經不存在了 |
  | `room_servants_quarters`／傭人房 | `room_guest_1`／乾淨的客房 | 「乾淨的客房」不是官方山中小屋房間名稱 |
  | `room_guest_room`／客房 | `room_murder`／兇殺現場 | 官方房間「客房 Guest Room」的欄位已經不存在了，「兇殺現場」也不是官方房間名稱 |

  這 3 筆改動的結果是：官方房間「臥房 Bedroom」「客房 Guest Room」目前完全不在資料裡了（原本佔用的欄位被換成別的房間），换来兩個聽起來像自訂/homebrew 的新房間（「乾淨的客房」「兇殺現場」）。**這是你刻意的設計決定，還是誤把原本兩個不同房間的欄位覆蓋掉了？** 我沒有動這 3 筆資料，先列出來給你確認方向（詳見第 2 節，這兩個官方房間目前對本專案採用的 2 個劇本沒有影響，不會卡住劇情）。

### 1.3 `characters.json`：格式正確，但有一個新欄位待確認

JSON 語法正確、6 個角色的必要欄位（`stats` 四項屬性的 `track`/`baseIndex`/`skullIndex`）都完整且數值合理。

- **新增欄位 `flieicon`**（例如 `"flieicon":"male_priest_icon.webp"`）：目前前端程式碼完全沒有讀取這個欄位（只有 `filename` 被 `CharacterSelectScreen.jsx` 使用）。這是要留給之後串接用的新欄位嗎？另外**懷疑是 `fileicon` 的手誤**（少了一個 i 的位置對調），如果之後要串接程式碼，欄位名稱最好先確認好，不然要嘛程式碼要對應這個打字，要嘛之後还要跟着一起改。
- 6 個角色的 `filename`／`flieicon` 都指向新檔名（如 `male_priest.webp`），`client/public/images/` 目前還是舊檔名（`oldman.png` 等），這批新美術圖還沒放進去——跟你說的「同步進行美術圖調整」一致，先記錄現況，不用現在處理。

## 2. 邪祟降臨（Haunt）房間清單比對

### 2.1 本專案採用的兩個劇本，實際用到的房間 —— 都已存在於 JSON 內，無缺漏

查證 `Betrayal at House on the Hill_survivor.pdf` / `_traitor.pdf` 的劇本原文：

- **劇本 1〈神鬼痴漢 The Mummy Walks〉**：用到「研究室」「圖書室」，以及「引發作祟的房間」（石棺所在房間，動態決定，不是固定房間）。兩間都已在 `rooms.json`（`room_research_lab`／`room_library`）。
- **劇本 10〈闔家團圓 Family Gathering〉**：殭屍會被「主臥房／禮拜堂／溫室／遊戲室／圖書室」5 間房間困住。5 間都已在 `rooms.json`（`room_master_bedroom`／`room_chapel`／`room_conservatory`／`room_game_room`／`room_library`）。

**結論：這兩個劇本本身不需要任何目前資料庫沒有的房間，不會卡住劇情推進。**

### 2.2 官方山中小屋完整房間清單 vs 目前 `rooms.json` —— 目前未列入的房間

比對 `Betrayal at House on the Hill_rule.pdf` 附件的完整房間列表（不限於上述兩個劇本，是整個遊戲會用到的官方房間池），以下房間**目前完全不在 `rooms.json` 裡**：

| 中文名 | 英文名 | 備註 |
|---|---|---|
| 地下湖 | Underground Lake | |
| 餐廳 | Dining Room | |
| 臥房 | Bedroom | 原本存在，本次被 `room_maid` 取代（見 1.2） |
| 客房 | Guest Room | 原本存在，本次被 `room_murder` 取代（見 1.2） |
| 老朽迴廊 | Creaky Hallway | |
| 塵封迴廊 | Dusty Hallway | |
| 風琴室 | Organ Room | |
| 手術室 | Operating Laboratory | |
| 崩塌的房間 | Collapsed Room | 特殊機制：踩空掉到地下室 |
| 包廂房 | Gallery | 舞廳的配對房間（可躍下舞廳） |
| 神秘電梯 | Mystic Elevator | 特殊機制：擲骰決定樓層傳送 |
| 煤導槽 | Coal Chute | 特殊機制：直接滑到地下平台 |
| 髒亂的房間 | Junk Room | ⚠️ 見下方備註 |
| 天花閣樓 | Attic | 離開需速度檢定 3+ |
| 五芒星室 | Pentagram Chamber | 離開需知識檢定 4+ |
| 墓園 | Graveyard | 離開需神志檢定 4+ |
| 地下墓穴 | Catacombs | 房間分兩側，需神志檢定 6+ 才能穿越 |
| 地底深淵 | Chasm | 房間分兩側，需速度檢定 3+ 才能穿越 |
| 鍋爐室 | Furnace Room | 停留受傷：物理傷害 1 |
| 地窖 | Crypt | 停留受傷：神志傷害 1 |
| 酒窖 | Wine Cellar | |
| 倉庫 | Storeroom | |
| 地下平台 | Basement Landing | 地下室起始房間 |

**⚠️ 「髒亂的房間 Junk Room」可能對應到你資料裡的 `room_messy_room`（雜亂的房間），但機制對不上**：官方是「離開需力量檢定 3+，失敗扣 1 速度」，你資料裡是 `leaveCheck: {stat:"speed", min:4}`（速度檢定 4+）。如果 `room_messy_room` 就是想做「Junk Room」，數值可能需要對照原文調整；如果是刻意設計的不同房間，維持現狀即可，這點我不確定你的意圖，先列出來。

**地下室限定房間，無法從這份規則精簡本 100%確認**：規則書本身寫「每張房間板塊背面，皆有標示可以用於哪個樓層」，這個逐房間的樓層限制資訊是印在實體卡牌背面，這份 PDF 摘要沒有重新列出完整對照表。以下是我依房間主題／機制**推測**、信心程度不同的判斷，供參考，不是 100% 確定：
- **高信心是地下室限定**（名稱本身就是地下室主題）：地下平台 Basement Landing、地下墓穴 Catacombs、地底深淵 Chasm、地下湖 Underground Lake
- **中等信心是地下室限定**（傳統上是地下室空間，機制也偏向地下室）：地窖 Crypt、鍋爐室 Furnace Room、酒窖 Wine Cellar、倉庫 Storeroom
- **不確定**：崩塌的房間 Collapsed Room（機制是「踩空掉到地下室」，暗示這個房間本身不是地下室，是地下室的入口）、其餘房間

如果你需要精確的逐房間樓層限制，會需要對照實體房間卡背面或更完整的房間對照表，這份規則書摘要沒有涵蓋，我不會用猜測的資訊假裝確定。

## 3. 美術圖狀態清單

`data/rooms/rooms.json` 32 筆房間，`filename` 狀態：

### 3.1 `filename` 是 `null`，但 `img/rooms/` 資料夾已經有對應檔案，可以直接補上

| id | 名稱 | 檔名 |
|---|---|---|
| room_statuary_corridor | 雕像長廊 | room_statuary_corridor.webp |
| room_bridge | 塔橋 | room_bridge.webp |
| room_abandoned_room | 廢棄的房間 | room_abandoned_room.webp |
| room_maid | 傭人房 | room_maid.webp |
| room_guest_1 | 乾淨的客房 | room_guest_1.webp |
| room_charred | 焦黑的房間 | room_charred.webp |
| room_murder | 兇殺現場 | room_murder.webp |
| room_beast | 野獸房 | room_beast.webp |

（共 8 筆，跟上次一樣，我可以幫你跑腳本一次補上 `filename` 欄位並複製進 `client/public/images/rooms/`，你確認要做的時候說一聲即可。）

### 3.2 `filename` 是 `null`，`img/rooms/` 也還沒有對應美術圖

| id | 名稱 |
|---|---|
| room_chapel | 禮拜堂 |
| room_bloody | 染血的房間 |
| room_weapon_room | 武器室 |
| room_specimen_room | 標本室 |
| room_ballroom | 舞廳 |
| room_piano_room | 琴房 |
| room_messy_room | 雜亂的房間 |
| room_baby_room | 嬰兒房 |

（共 8 筆）

### 3.3 `filename` 已設定，但 `img/rooms/` 暫存資料夾裡目前找不到對應檔案

| id | 名稱 | filename |
|---|---|---|
| room_research_lab | 研究室 | room_research_lab.webp |
| room_master_bedroom | 主臥房 | room_master_bedroom.webp |
| room_conservatory | 溫室 | room_conservatory.webp |
| room_gardens | 庭院 | room_gardens.webp |
| room_gymnasium | 健身房 | room_gymnasium.webp |
| room_atrium | 天井 | room_atrium.webp |
| room_vine_conservatory | 藤蔓糾纏的溫室 | room_vine_conservatory.webp |

**這 7 筆目前遊戲畫面不受影響**——`client/public/images/rooms/`（實際部署給遊戲用的資料夾）裡這 7 個檔案都還在，是`img/rooms/`（你的暫存工作資料夾）裡沒有了，推測是你重新生圖過程中舊檔案被清掉/搬走了。如果這 7 間房間之後有新版美術圖要換，到時候記得同時更新 `client/public/images/rooms/`；如果沒有要換，不用做任何事。

### 3.4 `img/rooms/` 裡有檔案，但沒有任何房間的 `filename` 指向它

- `room_master_bedroom2.webp`

只有這一個孤兒檔案。從檔名推測可能是「主臥房」的修訂版（原本 `room_master_bedroom.webp` 剛好也是本次找不到的那 7 個之一，見 3.3），**這是要拿來取代主臥房的新版圖嗎？** 先跟你確認，不自行假設。
