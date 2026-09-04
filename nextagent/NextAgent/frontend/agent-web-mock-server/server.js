/**
 * Mock Server - 模拟后端 API 服务
 * 支持 REST API、SSE 流式输出、WebSocket
 *
 * 运行方式:
 *   node server.js
 *
 * 端口: 3001
 *
 * SSE 端点（严格匹配后端）:
 *   GET /api/v1/sessions/{sessionId}/stream?lastSeenSequence=0
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const url = require('url');

const { logInfo } = require('./diagnostics');

// 路由模块
const sessionsRouter = require('./routes/sessions');
const streamRouter = require('./routes/stream');
const requestsRouter = require('./routes/requests');
const { setupWebSocket } = require('./routes/websocket');

const PORT = 3001;

// 创建 Express 应用
const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 请求日志
app.use((req, res, next) => {
  const parsedUrl = url.parse(req.url, true);
  logInfo(`[${new Date().toISOString()}] ${req.method} ${parsedUrl.pathname}`);
  next();
});

// REST API 路由
app.get('/api/v1/runtime/bootstrap', (req, res) => {
  const transportKind = String(process.env.MOCK_TRANSPORT_KIND || 'SSE').toUpperCase();
  if (transportKind !== 'SSE' && transportKind !== 'WEBSOCKET') {
    return res.status(400).json({
      error: 'Web runtime bootstrap transport is invalid.',
      code: 'WEB_RUNTIME_BOOTSTRAP_TRANSPORT_INVALID',
    });
  }
  return res.json({ transportKind });
});
app.use('/api/v1/sessions', sessionsRouter);
app.use('/api/v1/sessions', requestsRouter);
app.use('/api/v1/sessions', streamRouter); // GET /{sessionId}/stream

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// 创建 HTTP 服务器
const server = http.createServer(app);

// 初始化 WebSocket
setupWebSocket(server);

// 启动服务器
server.listen(PORT, () => {
  logInfo('='.repeat(50));
  logInfo(`Mock Server 运行中`);
  logInfo(`端口: http://localhost:${PORT}`);
  logInfo('='.repeat(50));
  logInfo('');
  logInfo('SSE 端点（严格匹配后端）:');
  logInfo('  GET /api/v1/sessions/{sessionId}/stream?lastSeenSequence=0');
  logInfo('');
  logInfo('REST API:');
  logInfo('  GET    /api/v1/runtime/bootstrap');
  logInfo('  GET    /api/v1/sessions');
  logInfo('  POST   /api/v1/sessions');
  logInfo('  GET    /api/v1/sessions/:sessionId');
  logInfo('  GET    /api/v1/sessions/:sessionId/conversation');
  logInfo('  PUT    /api/v1/sessions/:sessionId/title');
  logInfo('  PATCH  /api/v1/sessions/:sessionId');
  logInfo('  POST   /api/v1/sessions/:sessionId/requests');
  logInfo('  POST   /api/v1/sessions/:sessionId/cancel');
  logInfo('  POST   /api/v1/sessions/:sessionId/retry');
  logInfo('  POST   /api/v1/sessions/:sessionId/requests/latest/cancel');
  logInfo('  POST   /api/v1/sessions/:sessionId/requests/latest/retry');
  logInfo('  POST   /api/v1/sessions/:sessionId/requests/latest/edit');
  logInfo('  POST   /api/v1/sessions/:sessionId/requests/:runId/cancel');
  logInfo('  POST   /api/v1/sessions/:sessionId/requests/:runId/retry');
  logInfo('  POST   /api/v1/sessions/:sessionId/requests/:runId/edit');
  logInfo('  POST   /api/v1/sessions/:sessionId/attachments');
  logInfo('  POST   /api/v1/sessions/:sessionId/input-requests/:inputRequestId/respond');
  logInfo('  POST   /api/v1/sessions/:sessionId/input-requests/:inputRequestId/cancel');
  logInfo('  POST   /api/v1/sessions/:sessionId/test/trigger-user-input  (test helper, 可选 expiresInSeconds)');
  logInfo('');
  logInfo('WebSocket:');
  logInfo('  WS ws://localhost:3001/api/v1/sessions/{sessionId}/ws?lastSeenSequence=0');
  logInfo('  WS ws://localhost:3001/api/v1/sessions?sessionId=xxx   (legacy compatibility)');
  logInfo('');
});

// 优雅关闭
process.on('SIGINT', () => {
  logInfo('\n正在关闭 Mock Server...');
  server.close(() => {
    logInfo('Mock Server 已关闭');
    process.exit(0);
  });
});
