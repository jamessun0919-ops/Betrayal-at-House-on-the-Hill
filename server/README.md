# 啟動方式

## 開發模式（前後端分開跑）
1. 終端機 1：`cd server && npm install && npm start`
2. 終端機 2：`cd client && npm install && npm run dev`
3. 瀏覽器開啟 `http://localhost:5173`

## 正式/區網模式（伺服器一併伺服前端）
1. `cd client && npm run build`
2. `cd server && npm start`
3. 瀏覽器開啟 `http://localhost:3001`

## 讓同區網的朋友加入
1. 在執行伺服器的電腦上，用 `ipconfig`（Windows）查詢區網 IP（例如 `192.168.1.42`）
2. 朋友的瀏覽器開啟 `http://192.168.1.42:3001`（需先完成上方「正式/區網模式」建置步驟）
3. 若無法連線，檢查 Windows 防火牆是否詢問是否允許 Node.js 連入，選擇允許
