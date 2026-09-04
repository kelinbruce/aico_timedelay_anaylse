# Channel 开发指南

这一篇面向需要在外部仓库开发自定义 channel 的团队。这里的 channel 指“接收外部请求并把请求提交到 NextAgent runtime 的入口适配层”，例如企业 IM、网管系统回调、工单系统、MQ consumer、专线 API 网关或私有协议服务。

目标是说明三件事：

- 如何开发一个不依赖 `agent-app` 配置装载的 `ABCChannel`
- 如何把外部请求转换为 `RuntimeCommandPort.submit(...)`
- 如何在外仓 entrypoint 中启动 NextAgent 并装载 channel

## 先说结论

自定义 channel 的正确边界是：

- channel 自己监听 HTTP、TCP、MQ 或其它外部协议。
- channel 只依赖 `@nextagent/agent-contracts/runtime` 的 `RuntimeCommandPort`。
- channel 的装载由外仓 entrypoint 代码决定，不走 `agent-app` system config、`plugins[]` 或 Web channel registration。
- runtime、gateway、model、context、capability、observability 仍由 `agent-app` 创建。
- channel 不 import `agent-runtime` private implementation，不 new runtime 内部对象。

最小启动形态：

```ts
import { createNextAgentAppAsync } from "@nextagent/agent-app";
import { brand } from "@nextagent/agent-common";
import { createAbcChannel } from "@vendor/nextagent-abc-channel";

const app = await createNextAgentAppAsync();
const channel = createAbcChannel({
  runtime: app.runtime,
  port: 8088,
  identityResolver: () => ({
    tenantId: brand<string, "TenantId">("abc-tenant"),
    subjectId: brand<string, "SubjectId">("abc-subject"),
    displayName: "ABC Channel"
  })
});

await channel.start();
await app.start();
```

## 关键边界

### Channel 负责什么

channel 负责协议适配：

- 接收外部请求。
- 做 channel 自己的认证、鉴权、限流和请求体校验。
- 从可信 channel/auth boundary 解析 owner scope。
- 生成稳定 `idempotencyKey`。
- 把请求转换为 `SubmitRequestCommand`、`RequestControlCommand` 或 `EditLatestRequestCommand`。
- 返回当前协议需要的 accepted response。

### Channel 不负责什么

channel 不拥有 NextAgent 内部语义：

- 不创建 runtime lifecycle coordinator。
- 不直接访问 gateway store。
- 不读取或修改 Agent assembly。
- 不从请求体信任 `tenantId`、`subjectId`、`agentId`。
- 不处理模型 provider、context assembly、capability discovery 或 terminal commit。
- 不作为 `NextAgentPlugin` 加载。

### 与 agent-app 的关系

`agent-app` 仍是唯一 composition root。它负责创建 runtime 和所有主路径依赖。ABCChannel 的“不依赖 `agent-app` 配置装载”指的是：

- 不需要在 `default-system.yaml` 或 application config 中声明 ABCChannel。
- 不需要通过 `nextAgent.system.plugins[]` 加载 ABCChannel。
- 不需要改 `agent-app` 的 Web channel registration。
- 外仓 entrypoint 可以直接 import ABCChannel 并把 `app.runtime` 传进去。

这不表示 ABCChannel 可以绕过 `agent-app` 自己拼装 runtime。若要完全脱离 `agent-app` 创建 runtime kernel，需要先新增 OpenSpec change，开放稳定 runtime host factory。

## 外仓目录结构

推荐结构：

```text
nextagent-abc-channel/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── abc-channel.ts
│   └── entrypoints/
│       └── abc-runtime.ts
└── tests/
    └── abc-channel.test.ts
```

## package.json

如果 ABCChannel 和 NextAgent 在同一个 workspace 内开发，可以使用 workspace 版本：

```json
{
  "name": "@vendor/nextagent-abc-channel",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./entrypoints/abc-runtime": {
      "types": "./dist/entrypoints/abc-runtime.d.ts",
      "import": "./dist/entrypoints/abc-runtime.js"
    }
  },
  "dependencies": {
    "@nextagent/agent-app": "1.0.0",
    "@nextagent/agent-common": "1.0.0",
    "@nextagent/agent-contracts": "1.0.0"
  },
  "devDependencies": {
    "@types/node": "^24.10.1",
    "typescript": "^5.9.3",
    "vitest": "^4.0.14"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start:abc": "node dist/entrypoints/abc-runtime.js",
    "test": "vitest run"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

如果是独立仓库，版本号应与目标 NextAgent runtime 发行包对齐，并由交付物锁定。不要依赖 `agent-app` 未导出的 internal subpath。

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

## Channel public export

`src/index.ts`：

```ts
export { createAbcChannel } from "./abc-channel.js";
export type { AbcChannel, AbcChannelOptions, AbcIdentityResolver } from "./abc-channel.js";
```

## ABCChannel 参考实现

`src/abc-channel.ts`：

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { brand, type IdentityContext, type RequestLocale } from "@nextagent/agent-common";
import type { RuntimeCommandPort } from "@nextagent/agent-contracts/runtime";

export type AbcIdentityResolver = (request: IncomingMessage) => IdentityContext | Promise<IdentityContext>;

export interface AbcChannelOptions {
  readonly runtime: RuntimeCommandPort;
  readonly identityResolver: AbcIdentityResolver;
  readonly port: number;
  readonly defaultLocale?: RequestLocale;
}

export interface AbcChannel {
  start(): Promise<void>;
  close(): Promise<void>;
}

export function createAbcChannel(options: AbcChannelOptions): AbcChannel {
  const server = createServer((request, response) => {
    void handleRequest(options, request, response);
  });

  return {
    start() {
      return new Promise<void>((resolve) => {
        server.listen(options.port, resolve);
      });
    },
    close() {
      return closeServer(server);
    }
  };
}

async function handleRequest(
  options: AbcChannelOptions,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    if (request.method !== "POST" || pathOf(request) !== "/abc/v1/requests") {
      sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Route not found." } });
      return;
    }

    const body = await readJson(request);
    const parsed = parseSubmitBody(body);
    if (parsed.kind === "INVALID") {
      sendJson(response, 400, { error: { code: parsed.code, message: parsed.message } });
      return;
    }

    const accepted = await options.runtime.submit({
      ...(parsed.sessionId === undefined ? {} : { sessionId: brand<string, "SessionId">(parsed.sessionId) }),
      identityContext: await options.identityResolver(request),
      inputText: parsed.inputText,
      attachmentIds: [],
      locale: options.defaultLocale ?? brand<string, "RequestLocale">("zh-CN"),
      idempotencyKey: brand<string, "IdempotencyKey">(idempotencyKeyOf(request))
    });

    sendJson(response, 202, {
      sessionId: accepted.sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId
    });
  } catch {
    sendJson(response, 500, {
      error: {
        code: "ABC_CHANNEL_REQUEST_FAILED",
        message: "ABC channel request failed safely."
      }
    });
  }
}

function parseSubmitBody(body: Record<string, unknown>):
  | { readonly kind: "VALID"; readonly inputText: string; readonly sessionId?: string }
  | { readonly kind: "INVALID"; readonly code: string; readonly message: string } {
  const inputText = typeof body.inputText === "string" ? body.inputText.trim() : "";
  if (inputText.length === 0) {
    return { kind: "INVALID", code: "INPUT_TEXT_REQUIRED", message: "inputText is required." };
  }
  const sessionId = typeof body.sessionId === "string" && body.sessionId.length > 0
    ? body.sessionId
    : undefined;
  return { kind: "VALID", inputText, ...(sessionId === undefined ? {} : { sessionId }) };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function idempotencyKeyOf(request: IncomingMessage): string {
  const header = request.headers["x-idempotency-key"];
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && value.length > 0 ? value : randomUUID();
}

function pathOf(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://nextagent.local").pathname;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
```

## 启动装载

`src/entrypoints/abc-runtime.ts`：

```ts
import { createNextAgentAppAsync } from "@nextagent/agent-app";
import { brand } from "@nextagent/agent-common";
import { createAbcChannel } from "../abc-channel.js";

const app = await createNextAgentAppAsync({
  ...(process.env.NEXTAGENT_APPLICATION_CONFIG === undefined
    ? {}
    : { configFile: process.env.NEXTAGENT_APPLICATION_CONFIG })
});

const channel = createAbcChannel({
  runtime: app.runtime,
  port: Number(process.env.ABC_PORT ?? 8088),
  identityResolver: () => ({
    tenantId: brand<string, "TenantId">("abc-tenant"),
    subjectId: brand<string, "SubjectId">("abc-subject"),
    displayName: "ABC Channel"
  })
});

await channel.start();
await app.start();

async function shutdown(): Promise<void> {
  await channel.close();
  await app.close();
}

process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
```

这里的 `createAbcChannel(...)` 由外仓 entrypoint 直接调用。`agent-app` 不需要知道 ABCChannel 的 package 名、监听端口或协议细节。

## 请求示例

启动后：

```bash
curl -X POST http://127.0.0.1:8088/abc/v1/requests \
  -H "content-type: application/json" \
  -H "x-idempotency-key: abc-demo-001" \
  -d '{"inputText":"检查小区 A 的告警趋势"}'
```

响应示例：

```json
{
  "sessionId": "session-id",
  "requestId": "request-id",
  "runId": "run-id"
}
```

## Owner Scope 与 Agent Scope

ABCChannel 必须从可信 channel/auth boundary 生成 `IdentityContext`：

```ts
identityResolver: (request) => {
  const subject = verifyAbcToken(request.headers.authorization);
  return {
    tenantId: brand<string, "TenantId">(subject.tenantId),
    subjectId: brand<string, "SubjectId">(subject.userId),
    displayName: subject.displayName
  };
}
```

不要这样做：

```ts
identityResolver: async (_request, body) => ({
  tenantId: brand<string, "TenantId">(body.tenantId),
  subjectId: brand<string, "SubjectId">(body.subjectId)
});
```

请求体、模型输出、Capability 参数或客户端 metadata 都不能覆盖 owner scope。若 channel 需要选择 Agent，应只允许可信 channel 侧配置或受控 header 映射到已允许的 Agent，并传入 `SubmitRequestCommand.agentId`。不要让任意请求体字段直接成为可信 `agentId`。

## 幂等与错误

channel 应把外部协议里的业务请求 id 映射为 `idempotencyKey`：

- HTTP 可使用 `X-Idempotency-Key`。
- MQ 可使用 message id。
- 工单系统可使用 ticket id + event id。
- 没有外部稳定 id 时才生成 `randomUUID()`。

错误响应必须是安全投影。不要返回 raw stack、raw provider error、prompt、模型输出、附件内容、credential、绝对路径或内部 gateway details。

## 测试建议

最小测试应覆盖：

- 非法 JSON 或缺少 `inputText` 返回 400。
- `identityResolver` 的结果被传入 `runtime.submit`。
- `X-Idempotency-Key` 被映射为 `SubmitRequestCommand.idempotencyKey`。
- 请求体中的 `tenantId`、`subjectId` 不会覆盖可信 identity。
- runtime submit 失败时只返回安全错误。

可以用 fake `RuntimeCommandPort` 做单元测试：

```ts
import { brand } from "@nextagent/agent-common";
import type { RuntimeCommandPort, SubmitRequestCommand } from "@nextagent/agent-contracts/runtime";

const submitted: SubmitRequestCommand[] = [];

const runtime: RuntimeCommandPort = {
  async submit(command) {
    submitted.push(command);
    return {
      sessionId: command.sessionId ?? brand<string, "SessionId">("session-1"),
      requestId: brand<string, "MessageId">("request-1"),
      runId: brand<string, "RequestRunId">("run-1"),
      attempt: 1
    };
  },
  async cancel() { throw new Error("not implemented"); },
  async retryLatest() { throw new Error("not implemented"); },
  async editLatest() { throw new Error("not implemented"); },
  async answerPendingInput() { throw new Error("not implemented"); }
};
```

上面的 fake 只用于测试 channel 到 runtime command 的映射；产品启动必须传入真实 `app.runtime`。

## 与其它扩展机制的区别

| 机制 | 用途 | 是否适合 ABCChannel |
| --- | --- | --- |
| `agent-channel-web` | NextAgent 内置 HTTP/SSE/WebSocket channel | 不适合复用为私有协议入口 |
| `agent-channel-web-auth-local` | 本地 Web auth Fastify plugin | 只适合 Web auth 场景 |
| `agent-app-frontend-hosting` | 前端静态资源 Fastify plugin | 不适合业务请求接入 |
| `NextAgentPlugin` | Tool provider、routing policy、lifecycle hook | 不适合注册 channel/server |
| 外仓 entrypoint + `RuntimeCommandPort` | 自定义 channel 接入 runtime | 推荐 |

## 完成标准

一个 channel 可视为完成，至少需要满足：

- 外仓 package 只通过 public package exports 依赖 NextAgent。
- channel 装载不依赖 `agent-app` system config。
- runtime 注入点是 `RuntimeCommandPort`。
- owner scope 来自可信 channel/auth boundary。
- 主路径 request 有 idempotency key。
- 错误响应为安全投影。
- 有可重复测试覆盖 submit command 映射、scope 防覆盖和失败安全响应。
