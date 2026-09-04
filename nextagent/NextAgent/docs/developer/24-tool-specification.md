# Tool 开发指南

Tool 是 NextAgent 中最轻量的能力扩展面。一个 Tool 对应一个模型可调用的原子动作：查告警、调接口、读文件、跑脚本。如果你想把一个外部 API、一段业务逻辑或一个系统能力暴露给 Agent 模型调用，Tool 通常是最合适的选择。

Tool 与 Skill、Agent 三类能力共用 `agent-capability` 的统一 catalog 和生命周期；这里聚焦 Tool。Skill 能力和 Agent（subagent）能力见 [能力扩展](./05-capability-extension.md)。

## 什么时候用 Tool

| 需求 | 应选机制 | 不应选机制 |
|------|---------|----------|
| 把一个 API 封装为模型可调动作 | Tool（Plugin Tool 或 Skill 驱动 API 调用） | 修改 Runtime 状态机 |
| 单一可执行动作：检索、提问、命令 | Tool | Skill |
| 复合领域能力：诊断流程、操作手顺 | Skill | Tool |
| 隔离上下文的子 Agent 分析 | Agent capability（subagent） | Tool |
| 调整回话风格、领域术语 | Prompt Template | 新增 Tool |
| 增加审计、参数校验、输出脱敏 | Lifecycle Hook | Tool |

## 快速开始

### 1. 定义 Tool

用 `defineTool` 定义一个 Tool。最小定义只需要 `name`、`description`、`inputSchema`、`outputSchema` 和 `execute`：

```ts
import { defineTool } from '@nextagent/agent-plugin-sdk';

const lookupAlarm = defineTool({
  name: 'lookup-alarm' as never,
  displayName: 'Query alarms',
  description: 'Lookup a telecom alarm summary by alarm id.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['alarmId'],
    properties: {
      alarmId: { type: 'string', minLength: 1 },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['alarmId', 'severity', 'summary'],
    properties: {
      alarmId: { type: 'string' },
      severity: { type: 'string' },
      summary: { type: 'string' },
    },
  },
  replayPolicy: 'IDEMPOTENT',
  disclosurePolicy: { mode: 'EAGER' },
  async execute(input) {
    return {
      alarmId: String(input.alarmId),
      severity: 'MAJOR',
      summary: `Alarm ${input.alarmId} is active on access node A1.`,
    };
  },
});
```

`defineTool` 只返回一个 `ToolDefinition` 对象，不会注册任何东西。你定义了它，但 catalog 还不知道它存在。

### 2. 放进 Provider

Tool 不能单独存在，必须放进一个 `ToolProvider`。Plugin 中用 `defineToolProvider` 创建：

```ts
import { definePlugin, defineToolProvider } from '@nextagent/agent-plugin-sdk';

export default definePlugin({
  pluginId: 'telecom.ops',
  version: '1.0.0',
  providers: [
    defineToolProvider({
      providerId: 'telecom.ops.tools',
      tools: [lookupAlarm],
    }),
  ],
});
```

每个插件最多 4 个 provider。`providerId` 由你显式声明，使用 safe id vocabulary。

### 3. 配置 system config 加载插件

在 `default-system.yaml` 声明插件目录：

```yaml
nextAgent:
  system:
    plugins:
      - pluginId: telecom.ops
        path: plugins/telecom-ops
        required: true
```

### 4. 在 Agent 中绑定

在 `agent.yaml` 的 `capabilityBindings` 中显式绑定该 Tool：

```json
{
  "capabilityBindings": [
    {
      "capabilityId": "lookup-alarm",
      "capabilityType": "TOOL",
      "providerId": "telecom.ops.tools",
      "enabled": true
    }
  ]
}
```

加载成功不等于已启用。插件 provider 进入 startup registry，但 Agent 必须通过 `capabilityBindings` 显式绑定后，Tool 才对模型可见和可执行。

## Tool 字段说明

### `name`

Tool identity 和模型调用名称。用 `brand<string, 'CapabilityId'>` 创建，或插件中用 `as never` 简写。

### `displayName` 与 `locales`

`displayName` 是稳定人类名称。`locales.language` 是可选本地化名称：

```ts
defineTool({
  name: 'lookup-alarm' as never,
  displayName: 'Query alarms',
  locales: {
    language: {
      'zh-CN': { displayName: '查询告警' },
      'en-US': { displayName: 'Query alarms' },
    },
  },
  // ...
});
```

`name` 仍是 identity 和模型调用名称，`description` 仍是模型描述。两者都不随 `displayName` / `locales` 变化。

### `description`

模型决策依据。必须覆盖：

- 一句话总结
- When to use（适用场景）
- When NOT to use（避免误用，路由到更合适的 Tool）
- Key behaviors（输出格式、截断、硬失败 + reason code）

```ts
description:
  'Lookup a telecom alarm summary by alarm id.\n\n' +
  'When to use:\n- Query alarm severity and summary by alarm id.\n\n' +
  'When NOT to use:\n- To search alarm history, use the alarm-history tool.\n\n' +
  'Key behaviors:\n- Returns alarmId, severity, and summary fields.\n' +
  '- Returns FAILED with code ALARM_NOT_FOUND when the id does not exist.',
```

描述只写已实现行为，不承诺 schema 或实现未表达的 capability。

### `inputSchema` / `outputSchema`

JSON Schema 格式。描述真实实现行为，不承诺未实现能力。推荐用 TypeBox 或 Ajv 生成。

### `requiredDependencies`

声明 Tool 需要的受控依赖。缺失依赖的 Tool 会被 catalog 标记 `UNAVAILABLE`，不进入可执行路径。

| 依赖名 | 用途 |
|--------|------|
| `sandbox` | 受控 shell/Python 执行 |
| `workspaceFiles` | 受控文件读写/glob/grep |
| `apiCallPort` | HTTP API 调用 |
| `parameterExtraction` | 模型参数提取 |
| `skillSources` | Skill 资源访问 |
| `ragRetrieval` | 本地知识检索 |
| `subagentExecution` | 子 Agent 执行 |
| `todoState` | Todo 状态读写 |
| `workflowExecution` | Workflow 执行 |
| `cronTasks` | 定时任务操作 |
| `approval` | 审批就绪证据（预留） |

### `replayPolicy`

- `IDEMPOTENT` — 安全重放。GET 类查询、只读操作。
- `NON_IDEMPOTENT` — 不安全重放。POST/PUT/DELETE、有副作用的操作。

### `disclosurePolicy`

- `{ mode: 'EAGER' }` — 默认。Tool 在模型上下文中始终可见。
- `{ mode: 'DEFERRED', searchHint: '...' }` — Tool 对模型不可见，但可通过 `ToolSearch` 激活。
- `{ mode: 'HIDDEN' }` — Tool 对模型完全不可见，只由编排层内部调用。

### `returnsCapabilityResult`

默认 `false`。`execute` 返回业务输出对象，executor 自动包装为 `CapabilityInvocationResult`。

设为 `true` 时，`execute` 可直接返回 `CapabilityInvocationResult`。仅用于编排层内部调用的隐藏 Tool（如 `ApiCall`）。

## execute 函数

`execute` 接收已校验的业务输入和可选 `ToolExecuteOptions`，返回业务输出对象：

```ts
async execute(input, options) {
  // input: 已校验的业务输入
  // options?.context: 执行上下文（agentId, sessionId, runId, timeoutMs, ...）
  // options?.deps: 受控依赖（sandbox, workspaceFiles, apiCallPort, ...）
  // options?.signal: AbortSignal
  return { result: '...' };
}
```

不要自己构造 `CapabilityInvocationResult`（除非 `returnsCapabilityResult: true`）。executor 会把你的返回值包装为 `status=SUCCEEDED` 的结果。

### 失败处理

用抛出安全错误类型表达失败，executor 会包装为对应状态：

- `ToolDegradedResultError` — 安全降级，executor 包装为 `DEGRADED`，仍暴露 `structuredPayload`
- `ToolTimedOutResultError` — 安全超时
- `ToolFailedResultError` — 安全失败，含 `code` / `category` / `retryable`

```ts
import { ToolFailedResultError } from '@nextagent/agent-capability';

if (result.status === 404) {
  throw new ToolFailedResultError({}, 'ALARM_NOT_FOUND', 'NOT_FOUND', { retryable: false });
}
```

## 运行时输入输出流转

模型调用一个 Tool 时，输入从哪来、输出到哪去，executor 帮你做了哪些事：

```text
模型 tool_use(capabilityId, arguments)
  ↓
Agent Core → CapabilityInvocationPort.invoke(request)
  ↓
校验 arguments vs inputSchema   ← 不过就 FAILED，execute 不跑
  ↓
你的 execute(input, { context, deps, signal })
  ↓
你返回业务输出对象
  ↓
包装为 { status: SUCCEEDED, structuredPayload: 输出 }
  ↓
校验 structuredPayload vs outputSchema   ← 不过就 FAILED
  ↓
Agent Core → structuredPayload 喂回模型
```

### 输入怎么进来

模型在对话中决定调用 Tool 时，会生成一个 tool_use 响应，里面带 `capabilityId`（tool name）和 `arguments`（参数 JSON）。Agent Core 把它包装成 `CapabilityInvocationRequest`，然后调 `CapabilityInvocationPort.invoke(request)`。

进入 executor 后，先拿 `request.arguments` 跟你定义的 `inputSchema` 做校验。校验不过直接返回 `FAILED`，你的 `execute` 根本不会执行。校验通过后，executor 把已校验的 `request.arguments` 原样传给你的 `execute` 函数作为第一个参数 `input`。

### 输出怎么出去

你的 `execute` 返回一个普通业务对象。executor 拿到后，把它包装成 `CapabilityInvocationResult{ status: 'SUCCEEDED', structuredPayload: 你的返回值 }`。然后外层再拿 `structuredPayload` 跟你定义的 `outputSchema` 做校验，不匹配就返回 `FAILED`。校验通过的结果回到 Agent Core，`structuredPayload` 被作为 tool result 喂回模型继续下一轮。

### 你不需要做的事

- 不需要自己解析模型传来的 tool_use，executor 已经把 `arguments` 提取并校验好了
- 不需要自己构造 `CapabilityInvocationResult`（除非 `returnsCapabilityResult: true`），返回业务对象即可
- 不需要自己做输入输出的 schema 校验，executor 在 `execute` 前后各做一次

## 如何将 API 封装为 Tool

NextAgent 提供三种路径，按封装成本从低到高排列：

| 路径 | 适用场景 | 你需要写什么 | 参数来源 |
|------|---------|------------|---------|
| **Plugin Tool** | 自有 API，需要在 Plugin 内封装逻辑 | `defineTool` + `execute` 函数 | 模型直接提供 |
| **Skill 驱动 API 调用** | 已有 Swagger 2.0 文档，声明式接入 | Skill body 中的 api 命令块 + Swagger YAML | 受信上下文 + 模型参数提取 |
| **CLIP Server** | 远程 API 注册中心，批量发现和执行 | system config 配置 | 模型提供 |

### 路径一：Plugin Tool 封装 API

在 Plugin 的 `execute` 函数中通过 `apiCallPort` 依赖调用外部 API。HTTP 调用不直接用 `fetch`，而是走受控 gateway 边界。

#### 完整示例

```ts
import { definePlugin, defineTool, defineToolProvider } from '@nextagent/agent-plugin-sdk';
import type { ApiCallPort, ApiCallRequest } from '@nextagent/agent-contracts/capability';
import { ToolFailedResultError } from '@nextagent/agent-capability';

const lookupAlarm = defineTool({
  name: 'lookup-alarm' as never,
  displayName: 'Query alarms',
  locales: {
    language: {
      'zh-CN': { displayName: '查询告警' },
      'en-US': { displayName: 'Query alarms' },
    },
  },
  description:
    'Lookup a telecom alarm summary by alarm id.\n\n' +
    'When to use:\n- Query alarm severity and summary by alarm id.\n\n' +
    'When NOT to use:\n- To search alarm history, use the alarm-history tool.\n\n' +
    'Key behaviors:\n- Returns alarmId, severity, and summary fields.\n' +
    '- Returns FAILED with code ALARM_NOT_FOUND when the id does not exist.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['alarmId'],
    properties: {
      alarmId: { type: 'string', minLength: 1, maxLength: 64, description: 'Alarm identifier.' },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['alarmId', 'severity', 'summary'],
    properties: {
      alarmId: { type: 'string' },
      severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR', 'WARNING'] },
      summary: { type: 'string' },
    },
  },
  requiredDependencies: ['apiCallPort'],
  replayPolicy: 'IDEMPOTENT',
  disclosurePolicy: { mode: 'EAGER' },
  async execute(input, options) {
    const apiCallPort = options?.deps?.apiCallPort;
    const context = options?.context;
    if (apiCallPort === undefined || context === undefined) {
      throw new ToolFailedResultError({}, 'DEPENDENCY_MISSING', 'UNAVAILABLE');
    }

    const request: ApiCallRequest = {
      baseUrl: 'https://api.example.invalid/v1',
      path: `/alarms/${encodeURIComponent(String(input.alarmId))}`,
      method: 'GET',
      headers: {},
      credentialRef: 'env:ALARM_API_TOKEN',
      timeoutMs: context.timeoutMs,
      requestId: context.requestId,
    };

    const result = await apiCallPort.callApi(
      request,
      options?.signal ?? new AbortController().signal,
    );

    if (result.status === 401 || result.status === 403) {
      throw new ToolFailedResultError({}, 'UNAUTHORIZED', 'AUTHORIZATION', { retryable: false });
    }
    if (result.status === 404) {
      throw new ToolFailedResultError({}, 'ALARM_NOT_FOUND', 'NOT_FOUND', { retryable: false });
    }
    if (result.status < 200 || result.status >= 300) {
      throw new ToolFailedResultError({}, 'UNAVAILABLE', 'UNAVAILABLE', { retryable: false });
    }

    const parsed = JSON.parse(result.body) as {
      alarmId: string; severity: string; summary: string;
    };
    return { alarmId: parsed.alarmId, severity: parsed.severity, summary: parsed.summary };
  },
});

export default definePlugin({
  pluginId: 'telecom.ops',
  version: '1.0.0',
  providers: [
    defineToolProvider({ providerId: 'telecom.ops.tools', tools: [lookupAlarm] }),
  ],
});
```

#### credential 约束

`credentialRef` 只接受 `env:` 或 `file:` 前缀：

```ts
credentialRef: 'env:ALARM_API_TOKEN'   // 从环境变量读取
credentialRef: 'file:/path/to/token'   // 从文件读取
```

不接受模型输入、Skill body 或客户端请求体中传入的 credential。

### 路径二：Skill 驱动 API 调用

如果你已有 Swagger 2.0 文档，可以声明式接入，不需要写 `execute` 函数。系统会自动解析 Swagger、提取参数、执行 HTTP 请求。

#### 1. 在 Skill 目录放 Swagger YAML

```text
configRoot/skills/my-skill/
  SKILL.md
  api/
    AlarmRetriever.yaml
```

```yaml
# api/AlarmRetriever.yaml
swagger: "2.0"
host: "api.example.invalid"
basePath: "/v1"
schemes:
  - https
produces:
  - application/json
paths:
  /alarms/{alarmId}:
    get:
      parameters:
        - name: alarmId
          in: path
          required: true
          type: string
          x-param-info:
            descriptionForModelCN: "告警ID"
            descriptionForModelEN: "Alarm identifier"
        - name: x-user-id
          in: header
          required: true
          type: string
      responses:
        "200":
          description: "Alarm detail"
```

#### 2. 在 SKILL.md 声明 api 命令

在 SKILL.md 的 frontmatter 中声明 metadata（注意：键必须放在 `metadata.extension` 下），在 body 中用 api 命令块：

```yaml
---
name: alarm-lookup
description: Look up alarm details via API.
metadata:
  extension:
    _naie_agentic_loop_flag: "false"
    api_header_params: "x-user-id"
    api_request_params: "query"
---
```

然后在 body 中写：

    ```api
    api -name AlarmRetriever -hiro ir
    ```

`metadata.extension._naie_agentic_loop_flag: "false"` 表示非 agentic 模式：编排层检测到 api 命令后直接调用 API，不继续模型循环。设为 `"true"` 或省略时走 agentic 模式，由模型决定是否调用。

> **常见坑**：这些键的层级和命名必须与上面完全一致——放在 `metadata` 顶层、或给 header/request 参数加 `_naie_` 前缀都不会生效，且由于 extension 安全省略规则**不会报错**（静默忽略），排障时优先检查这一层。

#### 3. 参数来源

API 调用参数来自三个受信来源，不来自模型输入或客户端请求体：

| 来源 | 声明字段 | 说明 |
|------|---------|------|
| 请求 headers | `metadata.extension.api_header_params` | 从当前请求 headers 中提取声明的字段 |
| 受信上下文 | `metadata.extension.api_request_params` | 从受信上下文获取（如 `query` 映射到 `userQuestion`） |
| 模型参数提取 | Swagger YAML 中的未覆盖必填参数 | 通过 `ParameterExtractionPort` 做单次模型调用提取 |

#### 4. 失败处理

| 场景 | safeError.code |
|------|---------------|
| YAML 文件缺失或解析失败 | `API_DOC_LOAD_FAILED` |
| 参数提取超时 | `PARAMETER_EXTRACTION_TIMEOUT` |
| 参数提取失败 | `PARAMETER_EXTRACTION_FAILED` |
| HTTP 401/403 | `UNAUTHORIZED` |
| HTTP 超时 | `TIMEOUT` |
| HTTP 其他失败 | `UNAVAILABLE` |
| SSE 流中断 | `API_STREAM_INTERRUPTED` |

### 路径三：CLIP Server 配置

适用于远程 API 注册中心。系统启动时批量发现 API 并自动生成 Tool descriptor，不需要写代码。

> **注意**：用户可见的 `type` 封闭集合只有 `mcp-server` / `agent-registry` / `skill-hub` / `custom`，**没有 `clip_server` 这个 type**。CLIP 通过 `type: custom` + `adapter: clip_server` 表达（`clip_server` 是 adapter 标识，宿主已内置注册）。若不声明任何 CLIP provider，宿主会按 `sandbox` 的 clipc 配置自动创建默认 CLIP provider（见下文"注册不等于绑定"前的说明）。

在 `default-system.yaml` 配置：

```yaml
nextAgent:
  system:
    capability-providers:
      - id: telecom-clip
        type: custom
        adapter: clip_server
        config:
          enabled: true
          clipPathRef: clipc
          endpointRef: default
          timeoutMs: 30000
          retry:
            maxAttempts: 1
```

CLIP 命令执行依赖 `sandbox` 配置：`clipc` 必须在 `allowedExecutables` 中（默认已包含），`clipcExecutableDirectoryEnv`（默认 `CLIP_HOME`）指向 clipc 可执行目录。

每个发现的 CLIP API 会变成独立的 Tool（`kind=TOOL`），模型看到的是每个 API 自己的 `inputSchema`，不是单一泛化分发工具。

CLIP disclosure 支持两种模式（`nextAgent.system.capability-disclosure.clipc-disclosure-mode`）：
- 默认（list）：所有 CLIP Tool 在模型上下文中直接可见。
- `tool-search`：初始只暴露候选 `capabilityId`，模型通过 `ToolSearch` 激活后才能调用。

## Tool 注册

### 注册不等于绑定

```text
注册 → catalog 知道能力存在
绑定 → agent.yaml.capabilityBindings 显式启用
可见 → listAvailable / resolve 在统一 catalog 门后判定
可执行 → executor 通过 CapabilityInvocationPort 调用
```

Catalog 能发现一个能力，不代表任何 Agent 可以调用。必须在 `agent.yaml.capabilityBindings` 中显式绑定。

### 三种注册路径

#### Plugin Tool（最常用）

通过 `defineToolProvider` 在 Plugin 中声明，由 `agent-app` 启动时加载 plugin bundle 后注入 `externalProviders`。步骤见上方"快速开始"。

#### 应用层注入

应用层通过 `createCapabilitySubsystem` 的 `externalProviders` 选项注入自定义 `CapabilityProvider`：

```ts
const capabilitySubsystem = createCapabilitySubsystem({
  externalProviders: [
    ...pluginProviders,
    ...memoryToolProviders,
  ],
});
```

#### Config 驱动

通过 `nextAgent.system.capability-providers` 配置外部 capability source：

| 用户 `type` | `adapter`（custom 必填） | `providerKind` | `discoveryMode` | 必需字段 |
|------------|----------------|----------------|-----------------|---------|
| `mcp-server` | — | `MCP_SERVER` | `SEARCH` | `url` |
| `agent-registry` | — | `AGENT_REGISTRY` | `EAGER` | `url` |
| `skill-hub` | — | `SKILL_HUB` | `SEARCH` | `url` + `installDir` |
| `custom` | `clip_server`（宿主内置）或其他已注册 adapter | `CUSTOM` | `EAGER` | `adapter` + `config` |

### 高级：自定义 Provider

需要自定义 discovery / executor 时，用 `defineCapabilityProvider` 返回 public `CapabilityProvider` SPI：

```ts
import { defineCapabilityProvider, definePlugin } from '@nextagent/agent-plugin-sdk';

const provider = {
  providerId: 'telecom.ops.search-tools',
  providerKind: 'CUSTOM' as const,
  providerType: 'nextagent-plugin-tool',
};

export default definePlugin({
  pluginId: 'telecom.ops',
  version: '1.0.0',
  providers: [
    defineCapabilityProvider({
      identity: provider,
      discovery: {
        provider,
        discoveryMode: 'SEARCH',
        async search(criteria, signal) {
          return [
            {
              capabilityId: 'lookup-cell' as never,
              kind: 'TOOL',
              provider,
              displayName: 'lookup-cell',
              description: 'Lookup a radio cell by safe cell id.',
              modelInvocable: true,
              availabilityStatus: 'AVAILABLE',
              inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: { cellId: { type: 'string', minLength: 1 } },
                required: ['cellId'],
              },
              outputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: { cellId: { type: 'string' }, status: { type: 'string' } },
                required: ['cellId', 'status'],
              },
            },
          ];
        },
      },
      executor: {
        capabilityKinds: ['TOOL'],
        async invoke(_descriptor, request) {
          return {
            status: 'SUCCEEDED',
            structuredPayload: { cellId: String(request.arguments.cellId ?? ''), status: 'ON_AIR' },
            generatedMessages: [],
            artifactRefs: [],
          };
        },
      },
    }),
  ],
});
```

边界约束：
- 不允许把实现 handle、私有 executor state、gateway object 暴露到 descriptor、Web response、stream 或 gateway record。
- provider identity 必须是 `CUSTOM`。
- plugin provider type 必须是 `nextagent-plugin-tool`。
- 插件 provider 不能伪装成 framework-owned provider，也不能占用受保留的 provider identity。
## 在 Agent 中绑定 Tool

`agent.yaml` 使用 YAML（JSON 也是兼容子集）。在 `capabilityBindings` 中按 `{capabilityId, capabilityType, providerId, enabled}` 绑定：

```json
{
  "agentId": "default-agent",
  "agentVersion": "v1",
  "capabilityBindings": [
    {
      "capabilityId": "Glob",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": true
    },
    {
      "capabilityId": "lookup-alarm",
      "capabilityType": "TOOL",
      "providerId": "telecom.ops.tools",
      "enabled": true
    },
    {
      "capabilityId": "Bash",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": false
    }
  ]
}
```

`enabled: false` 表示 Tool 对当前 Agent 不可见也不可执行。builtin 默认 Agent 绑了常用工具；subagent 如 `network-explorer` 会显式关闭 `Write`/`Bash`/`Python`/`Skill`/`AskUserQuestion`。

## 本地测试

`agent-test-kit` 提供 `createPluginTestHarness(plugin, options?)`，直接消费已导入的插件对象：

```ts
import { createPluginTestHarness } from '@nextagent/agent-test-kit';
import plugin from '../src/index.js';

const harness = createPluginTestHarness(plugin);
await harness.invokeTool('telecom.ops.tools', 'lookup-alarm', { alarmId: 'ALM-1001' });
```

Harness 不读取 `plugin.json`，不执行 dynamic import，不校验 bundle。它验证的是插件对象的 public contract，不是宿主加载链路。

建议最少做两层测试：
- SDK / harness 测试：验证 Tool 对象的行为
- 集成测试：验证 `plugin.json`、bundle、system config、Agent activation 和宿主加载链路

## 内置 Tool 列表

| Tool | 功能 | 关键依赖 |
|------|------|---------|
| `Read` | 受控读取文件 | `workspaceFiles` |
| `Write` | 受控创建或覆盖写入 | `workspaceFiles` |
| `Edit` | 受控文本编辑 | `workspaceFiles` |
| `Glob` | 文件名模式匹配 | `workspaceFiles` |
| `Grep` | 内容正则搜索 | `workspaceFiles` |
| `Bash` | 受控 shell 执行 | `sandbox` |
| `Python` | 受控 Python 执行 | `sandbox` |
| `Rag` | 本地知识检索 | `ragRetrieval` |
| `ToolSearch` | deferred capability 激活与检索 | — |
| `AskUserQuestion` | 人机交互入口 | — |
| `Skill` | 执行 Skill | `skillSources` + `workspaceFiles` |
| `Agent` | 创建 child run | `subagentExecution` |
| `TodoWrite` | Todo 状态管理 | `todoState` |
| `Workflow` | Workflow 执行 | `workflowExecution` |
| `ApiCall` | Skill 驱动 API 调用（隐藏） | `skillSources` + `apiCallPort` + `parameterExtraction` |
| `Cron` | 定时任务管理 | `cronTasks` |

内置 Tool 的 `providerId` 固定为 `builtin-tools`，`providerKind` 为 `BUNDLED`。Agent 默认绑定了常用工具。

## 代码位置速查

| 你想找 | 去哪里 |
|--------|--------|
| `defineTool` / `Tool` 接口 | `packages/agent-capability/src/tools/tool-spi.ts` |
| Plugin SDK（`definePlugin`、`defineToolProvider`） | `packages/agent-plugin-sdk/src/index.ts` |
| Builtin tool 列表 | `packages/agent-capability/src/builtins/index.ts` |
| ApiCall tool（Skill 驱动 API 调用） | `packages/agent-capability/src/builtins/api-call-tool.ts` |
| CLIP tool source | `packages/agent-capability/src/clip/clip-tool-source.ts` |
| `ApiCallPort` 契约 | `packages/agent-contracts/src/capability/index.ts` |
| 默认 Agent 配置 | `packages/agent-core/src/builtin-agents/default-agent/agent.yaml` |
| 规格文档 | `openspec/specs/builtin-tool-framework/spec.md`、`openspec/specs/api-backed-tool-source/spec.md`、`openspec/specs/skill-driven-api-call/spec.md` |

## 开发 Checklist

### Tool 定义

- [ ] 用 `defineTool({ name, description, inputSchema, outputSchema, ... })` 定义 Tool
- [ ] `description` 覆盖一句话总结、When to use / When NOT to use、Key behaviors（输出格式、硬失败 + reason code）
- [ ] `inputSchema` / `outputSchema` 描述真实实现行为，不承诺未实现能力
- [ ] 声明 `requiredDependencies`，缺失依赖会被 catalog 标记 `UNAVAILABLE`
- [ ] 声明 `replayPolicy`（GET 用 `IDEMPOTENT`，有副作用用 `NON_IDEMPOTENT`）
- [ ] 声明 `disclosurePolicy`（默认 `EAGER`，需延迟激活用 `DEFERRED`，编排层内部用 `HIDDEN`）
- [ ] `execute` 只消费业务输入 + `ToolExecuteOptions`，返回业务输出对象
- [ ] 失败用 `ToolDegradedResultError` / `ToolTimedOutResultError` / `ToolFailedResultError`
- [ ] 把 Tool 放进 `defineToolProvider`，声明 `providerId`

### API 封装

- [ ] 选择封装路径：Plugin Tool / Skill 驱动 API 调用 / CLIP Server
- [ ] HTTP 调用通过 `apiCallPort` 依赖，不直接用 `fetch`
- [ ] credential 只接受 `env:` 或 `file:` 前缀的 `credentialRef`
- [ ] 参数来源受信：不来自模型输入、Skill body 或客户端请求体
- [ ] 失败处理用稳定 safeError code，不暴露 endpoint、credential、request/response body
- [ ] GET 类 API 用 `IDEMPOTENT`，POST/PUT/DELETE 类用 `NON_IDEMPOTENT`
- [ ] 流式响应用 `emitResultDelta` 转发 SSE chunk，完成后返回终端结果

### 注册与绑定

- [ ] Plugin 通过 `defineToolProvider` 注入，system config `plugins[]` 声明
- [ ] 在 `agent.yaml.capabilityBindings` 中显式绑定（`capabilityType: "TOOL"`）
- [ ] 确认加载成功不等于已启用 — 必须绑定后才对模型可见

## 禁止事项

- Tool 实现不接收 workspace root、host 绝对路径、sandbox 内部对象或 host 进程 API；走受控依赖
- 不允许把插件能力自生写入默认 Agent `capabilityBindings`、`policies`、`hooks` 或 system config `plugins[]`
- 不允许把宿主私有实现对象泄漏到 public contract、Web response、stream event 或 persistence record
- 动态执行 shell、python、脚本或模型生成代码必须走 sandbox gateway boundary
- 插件 bundle 不得保留 runtime import specifier
- 插件目录和 `main` bundle 不得逃逸出 `configRoot`
