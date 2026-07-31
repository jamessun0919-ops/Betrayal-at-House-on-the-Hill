const request = require('supertest');
const { createApp } = require('../src/createServer');

test('GET /health returns 200 with status ok', async () => {
  const { app } = createApp();
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});
