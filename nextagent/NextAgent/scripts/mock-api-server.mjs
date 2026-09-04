import { createServer } from 'node:http';

const PORT = 18099;

const complaints = [
  { id: 'C001', region: 'beijing', severity: 'high', description: 'Fiber cut on main trunk line', createdAt: '2026-08-05T10:30:00Z' },
  { id: 'C002', region: 'beijing', severity: 'medium', description: 'Signal degradation in sector 3', createdAt: '2026-08-05T11:15:00Z' },
  { id: 'C003', region: 'shanghai', severity: 'low', description: 'Scheduled maintenance overflow', createdAt: '2026-08-05T09:00:00Z' },
  { id: 'C004', region: 'guangzhou', severity: 'high', description: 'Base station power failure', createdAt: '2026-08-05T12:45:00Z' },
  { id: 'C005', region: 'shenzhen', severity: 'medium', description: 'Interference on 5G band n78', createdAt: '2026-08-05T13:20:00Z' },
];

const server = createServer((req, res) => {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';
  const parsedUrl = new URL(url, `http://127.0.0.1:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (parsedUrl.pathname === '/api/v1/complaints' && method === 'GET') {
    const region = parsedUrl.searchParams.get('region');
    let filtered = complaints;
    if (region !== null && region.length > 0) {
      filtered = complaints.filter((c) => c.region === region);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        data: { complaints: filtered, totalCount: filtered.length },
      }),
    );
    return;
  }

  if (parsedUrl.pathname === '/api/v1/network/status' && method === 'GET') {
    const region = parsedUrl.searchParams.get('region');
    const statusData = [
      { region: 'beijing', status: 'healthy', nodeCount: 1280, alarmCount: 3, updatedAt: '2026-08-06T10:00:00Z' },
      { region: 'shanghai', status: 'healthy', nodeCount: 980, alarmCount: 1, updatedAt: '2026-08-06T10:00:00Z' },
      { region: 'guangzhou', status: 'warning', nodeCount: 760, alarmCount: 12, updatedAt: '2026-08-06T10:00:00Z' },
      { region: 'shenzhen', status: 'healthy', nodeCount: 650, alarmCount: 0, updatedAt: '2026-08-06T10:00:00Z' },
    ];
    let filtered = statusData;
    if (region !== null && region.length > 0) {
      filtered = statusData.filter((s) => s.region === region);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        data: { regions: filtered, totalCount: filtered.length },
      }),
    );
    return;
  }

  if (parsedUrl.pathname === '/api/v1/stream/complaints' && method === 'POST') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const events = complaints.map(
      (c, i) =>
        `data: ${JSON.stringify({ event: 'complaint_update', id: c.id, region: c.region, severity: c.severity, description: c.description, index: i + 1 })}\n\n`,
    );
    events.push(`data: ${JSON.stringify({ event: 'done', totalCount: complaints.length })}\n\n`);

    let i = 0;
    const sendNext = () => {
      if (i < events.length) {
        res.write(events[i]);
        i++;
        setTimeout(sendNext, 300);
      } else {
        res.end();
      }
    };
    sendNext();
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path: parsedUrl.pathname, method }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock API server running at http://127.0.0.1:${PORT}`);
  console.log(`  GET  /api/v1/complaints?region=beijing  -> JSON`);
  console.log(`  POST /api/v1/stream/complaints          -> SSE stream`);
});
