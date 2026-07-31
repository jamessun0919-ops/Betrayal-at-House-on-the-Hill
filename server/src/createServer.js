const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

function createApp() {
  const app = express();
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  return { app };
}

function createServer() {
  const { app } = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });
  return { app, httpServer, io };
}

module.exports = { createApp, createServer };
