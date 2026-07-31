const { createServer } = require('./createServer');

const PORT = process.env.PORT || 3001;
const { httpServer } = createServer();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`伺服器已啟動：http://0.0.0.0:${PORT}`);
});
