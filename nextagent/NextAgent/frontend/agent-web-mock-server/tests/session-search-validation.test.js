'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const sessionsRouter = require('../routes/sessions');

async function withSessionRoute(handler) {
  const app = express();
  app.use('/api/v1/sessions', sessionsRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await handler(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('session search accepts 200 characters and rejects 201 characters', async () => {
  await withSessionRoute(async (baseUrl) => {
    const legalResponse = await fetch(`${baseUrl}/api/v1/sessions?q=${'a'.repeat(200)}`);
    assert.equal(legalResponse.status, 200);

    const illegalResponse = await fetch(`${baseUrl}/api/v1/sessions?q=${'a'.repeat(201)}`);
    assert.equal(illegalResponse.status, 400);
    assert.deepEqual(await illegalResponse.json(), { error: 'q length is invalid.' });
  });
});
