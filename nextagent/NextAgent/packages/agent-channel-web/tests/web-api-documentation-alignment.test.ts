import { webChannelPublicEndpoints } from '@nextagent/agent-channel-web';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const apiDoc = readFileSync(resolve(repoRoot, 'docs/apis/agent-web-api-list.md'), 'utf8');
const developerReference = readFileSync(resolve(repoRoot, 'docs/developer/10-api-reference.md'), 'utf8');

describe('web API documentation alignment', () => {
  it('documents every public endpoint path from the Web channel inventory', () => {
    for (const endpoint of webChannelPublicEndpoints) {
      const [, rawPath = ''] = endpoint.split(' ');
      const documentedPath = rawPath.replace(/:([A-Za-z0-9_]+)/gu, '{$1}');
      expect(apiDoc, `${endpoint} is documented`).toContain(documentedPath);
    }
  });

  it('uses the complete endpoint template for every public endpoint', () => {
    for (const endpoint of webChannelPublicEndpoints) {
      const section = endpointSection(endpoint);
      expect(section, `${endpoint} path params`).toContain('Path 参数');
      expect(section, `${endpoint} query params`).toContain('Query 参数');
      expect(section, `${endpoint} headers`).toContain('Headers');
      expect(section, `${endpoint} body`).toContain('Body / Multipart');
      expect(section, `${endpoint} success response`).toContain('Success response');
      expect(section, `${endpoint} error responses`).toContain('Error responses');
      expect(section, `${endpoint} field table`).toContain('字段表');
      expect(section, `${endpoint} example`).toContain('示例');
    }
  });

  it('documents Activity transport semantics as ER-only and cursor-free', () => {
    expect(apiDoc.match(/^### GET \/api\/v1\/session-activities\/stream$/gmu)).toHaveLength(1);
    expect(apiDoc.match(/^### WebSocket \/api\/v1\/session-activities\/ws$/gmu)).toHaveLength(1);
    expect(apiDoc.match(/^### POST \/api\/v1\/sessions\/\{sessionId\}\/activity\/consume$/gmu)).toHaveLength(1);
    expect(apiDoc).toContain('首条应用消息必须是 `SNAPSHOT`');
    expect(apiDoc).toContain('不提供 replay cursor、sequence 或历史补偿');
    expect(apiDoc).toContain('不包含 `runId`、cursor、sequence、owner scope、Agent Scope');
    expect(apiDoc).toContain('IR surface 只暴露以下 6 个端点，不暴露 Activity SSE、Activity WebSocket、activity consume');
    expect(apiDoc).not.toContain('### GET /api/v1/ir/session-activities/stream');
    expect(apiDoc).not.toContain('### WebSocket /api/v1/ir/session-activities/ws');
    expect(apiDoc).not.toContain('### POST /api/v1/ir/sessions/{sessionId}/activity/consume');
    expect(developerReference).toContain('IR 不暴露 Activity SSE、Activity WebSocket、activity consume');
  });

  it('keeps known question API examples aligned with executable response schema', () => {
    expect(apiDoc).toContain('"text": "是否需要进一步分析切换失败 TOP 小区？"');
    expect(apiDoc).toContain('"text": "分析当前告警根因"');
    expect(apiDoc).toContain('"source": "high-frequency"');
    expect(apiDoc).not.toContain('"questions": [\n    {\n      "question": "分析当前告警根因"');
    expect(apiDoc).not.toContain('"source": "HIGH_FREQUENCY"');
  });

  it('keeps the developer reference concise and delegated to the authoritative API list', () => {
    expect(developerReference).toContain('../apis/agent-web-api-list.md');
    expect(developerReference).not.toContain('"source": "HIGH_FREQUENCY"');
    expect(developerReference).not.toContain('"question": "分析当前告警根因"');
  });
});

function endpointSection(endpoint: string): string {
  const [method, rawPath = ''] = endpoint.split(' ');
  const documentedMethod = method === 'WS' ? 'WebSocket' : method;
  const documentedPath = rawPath.replace(/:([A-Za-z0-9_]+)/gu, '{$1}');
  const heading = `### ${documentedMethod} ${documentedPath}`;
  const start = apiDoc.indexOf(heading);
  expect(start, `${endpoint} heading`).toBeGreaterThanOrEqual(0);
  const nextHeading = apiDoc.indexOf('\n### ', start + heading.length);
  return nextHeading === -1 ? apiDoc.slice(start) : apiDoc.slice(start, nextHeading);
}
