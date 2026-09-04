# Agent Plugin 开发指南

Agent plugin 是受信本地 TypeScript 扩展。它只能在 `agent-app` 启动期由 system config 显式声明的本地插件目录加载；加载后进入冻结的 plugin registry。运行期请求、模型输出、远端 URL、SkillHub package 或客户端 metadata 都不能触发插件加载。

当前基线里的插件机制是：

- system config 声明插件目录清单
- `agent-app` 启动期加载 `plugin.json` 和插件 bundle
- 插件只允许贡献 `Tool provider`、`agentRoutingPolicy` 和 `LifecycleHook`
- Tool 是否可用、Policy 是否生效、Hook 是否启用，仍然要经过 Agent 配置激活和 startup graph validation

它不是动态插件系统，也不是运行期模块解析器。宿主不会帮插件执行 `npm install`、扫描目录、解析多文件模块树或做热插拔。

## 快速开始

```bash
npx create-nextagent-plugin telecom-ops
cd telecom-ops
npm install
npm run test
npm run build
```

构建完成后，发布给宿主的插件目录必须包含 `plugin.json` 和 `plugin.json.main` 指向的单文件 `.js` ESM bundle。推荐的最小发布结构是 `{ plugin.json, index.js }`，例如：

```text
configRoot/
  plugins/
    telecom-ops/
      plugin.json
      index.js
```

system config 通过 `nextAgent.system.plugins` 声明插件；当前最多 8 个：

```yaml
nextAgent:
  system:
    plugins:
      - pluginId: telecom.ops
        path: plugins/telecom-ops
        required: true
```

- `pluginId` 必须和 `plugin.json` 内声明一致
- `path` 必须是 `configRoot` 内的相对路径
- `required: true` 表示插件启动校验失败时阻断应用启动
- `required: false` 或省略时，失败会记录 diagnostic，但不会直接让 app 启动失败

## 产物格式

`plugin.json` 当前只支持单文件 ESM bundle：

```json
{
  "pluginId": "telecom.ops",
  "version": "1.0.0",
  "apiVersion": "1.0",
  "main": "./index.js",
  "artifactType": "esm-bundle"
}
```

可选 `hostExternals` 形状如下：

```json
{
  "pluginId": "telecom.ops",
  "version": "1.0.0",
  "apiVersion": "1.0",
  "main": "./index.js",
  "artifactType": "esm-bundle",
  "hostExternals": [{ "id": "typebox", "versionRange": "^0.34.0" }]
}
```

当前 loader 的真实约束是：

- `apiVersion` 可选；省略时优先使用插件 export 的 `apiVersion`，若 export 也省略则使用 root compatibility 版本 `"1.0"`；需要 developer diagnostic sink 时必须显式使用 `"1.1"`
- 显式声明的 `apiVersion` 必须是当前宿主支持的版本；当前支持 `"1.0"` / `"1.1"` / `"1.2"`（以 `@nextagent/agent-plugin-sdk` 的 `SUPPORTED_PLUGIN_API_VERSIONS` 为准），不支持 `"2.0"`
- 当前 root `definePlugin(...)` 是 v1 兼容 authoring helper；省略时会在插件对象上写入 `"1.0"`，不会随未来宿主 latest API 版本变化而漂移
- 后续如支持新的插件 API 大版本，应通过新的 OpenSpec change 增加显式版本化 SDK subpath；当前首版不预先暴露 `vXX` subpath
- `main` 必须解析到插件目录内的 `.js` 文件
- `main` 可以是 `./index.js`、`./dist/index.js` 等插件目录内相对路径；发布目录结构必须和 `main` 一致
- 宿主只接受单文件 bundle，不接受 zip、目录扫描、多文件 runtime bundle
- 最终交给宿主加载的 `main` 文件不得保留 runtime import specifier

这里的“不保留 runtime import specifier”是指：发布给宿主的最终 bundle 里不能再出现需要宿主继续解析的 `import "..."`、`export ... from "..."` 或字符串字面量动态 `import("...")`。源码阶段可以正常 `import`，但构建产物必须已经打平成宿主可直接执行的 bundle。

`create-nextagent-plugin` scaffold 的源码项目默认把 bundle 输出到 `dist/index.js`，并让生成的 `plugin.json.main` 指向 `./dist/index.js`。如果你直接发布 scaffold 产物，就保留 `dist/index.js`；如果把发布目录压平为 `{ plugin.json, index.js }`，需要同步把 `plugin.json.main` 改为 `./index.js`。宿主只看发布目录里的 `plugin.json.main`，不关心源码项目如何组织。

## Scaffold 输出

`create-nextagent-plugin <plugin-directory>` 生成：

- `package.json`
- `tsconfig.json`
- `esbuild.config.ts`
- `src/index.ts`
- `plugin.json`
- `tests/plugin.test.ts`
- `README.md`

模板默认使用 `definePlugin(...)`，`esbuild.config.ts` 输出 ESM、single-file bundle 和 inline sourcemap。生成的 `tests/plugin.test.ts` 用 `getPluginMetadata(...)` 校验已物化插件对象的 safe metadata；它不读取 manifest，不执行 app loader，也不证明生产可加载。

## 插件能贡献什么

插件 public surface 定义在 `@nextagent/agent-plugin-sdk`：

- `providers`
- `policies`
- `hooks`

对应的宿主集成位置分别是：

- `providers` 作为 `externalProviders` 注入 capability subsystem
- `policies` 进入 `AgentAssembly` graph validation，并由 `agent-runtime` policy registry/resolver 按 accepted Agent scope 和 policy point 解析
- `hooks` 在启动期并入 lifecycle hook definition / executable snapshot

要注意：插件“加载成功”不等于“当前 Agent 已启用该扩展”。Policy 和 Hook 仍然需要 Agent definition 显式激活；Tool 仍然需要 Agent `capabilityBindings` 显式绑定。

## Tool Provider

最推荐从 `defineTool(...)` 和 `defineToolProvider(...)` 开始：

```ts
import { definePlugin, defineTool, defineToolProvider } from '@nextagent/agent-plugin-sdk';

const lookupAlarm = defineTool({
  name: 'lookup-alarm',
  displayName: 'Query alarms',
  locales: {
    language: {
      'zh-CN': { displayName: '查询告警' },
      'en-US': { displayName: 'Query alarms' },
    },
  },
  description: 'Lookup a telecom alarm summary by alarm id.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      alarmId: { type: 'string', minLength: 1 },
    },
    required: ['alarmId'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      alarmId: { type: 'string' },
      severity: { type: 'string' },
      summary: { type: 'string' },
    },
    required: ['alarmId', 'severity', 'summary'],
  },
  async execute(input) {
    const alarmId = String(input.alarmId);
    return {
      alarmId,
      severity: 'MAJOR',
      summary: `Alarm ${alarmId} is active on access node A1.`,
    };
  },
});

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

`DefineToolInput` 只表达单个 Tool 的 metadata、schema、config、dependency、policy、observability、`configure` 和 `execute`。它不得承载 provider、discovery、binding、Agent activation、插件加载或路径语义。

`DefineToolProviderInput` 只包含 `providerId`、可选 `providerType` 和 `tools`。插件侧 `providerId` 必须由作者显式声明，使用 safe id vocabulary；首版 plugin Tool provider 的 `providerType` 为 `nextagent-plugin-tool`。每个插件最多 4 个 provider。

Tool provider 加载后，还要由 Agent 显式绑定：

```yaml
capabilityBindings:
  - capabilityId: lookup-alarm
    capabilityType: TOOL
    providerId: telecom.ops.tools
    enabled: true
```

如果没有绑定：

- 插件 provider 会存在于 startup registry
- 但不会自动进入当前 Agent 的 capability binding 事实
- 也不应被当成默认产品能力

`displayName` 是稳定人类名称，`locales.language` 是可选本地化名称；两者随 Plugin Tool descriptor 进入当前 Agent 的 Catalog winner，并用于执行详情标题。`name` 仍是 Tool identity 和模型调用名称，`description` 仍是模型说明，不参与标题 fallback。名称结构、Session 查询、纯文本规则和降级边界见[能力扩展：为扩展 Capability 提供过程业务名称](./05-capability-extension.md#为扩展-capability-提供过程业务名称)。

## 高级 Provider

需要自定义 discovery / executor 时，使用 `defineCapabilityProvider(...)` 并返回 public `CapabilityProvider` SPI。

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
          void signal;
          if (criteria.requestedCapabilityId !== undefined && criteria.requestedCapabilityId !== 'lookup-cell') {
            return [];
          }
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
            structuredPayload: {
              cellId: String(request.arguments.cellId ?? ''),
              status: 'ON_AIR',
            },
            generatedMessages: [],
            artifactRefs: [],
          };
        },
      },
    }),
  ],
});
```

这里的边界要特别明确：

- 允许自定义 public `CapabilityProvider` 形状
- 不允许把实现 handle、私有 executor state、gateway object 或宿主内部 registry 暴露到 descriptor、`AgentAssembly`、Web response、stream 或 gateway record
- provider identity 必须是 `CUSTOM`
- plugin provider type 必须是 `nextagent-plugin-tool`

插件 provider 不能伪装成 framework-owned provider，也不能占用受保留的 provider identity。

自定义 `SEARCH` Provider 如果需要让执行详情读取其名称，还必须实现 optional `listCurrent(criteria, signal)`。该方法只返回当前 scope 中已经存在的本地、已生成或已安装 descriptor，不得复用 `search`，也不得触发远端发现、下载、安装、执行或文件写入。Provider 未实现该方法或读取失败时，Session 名称资源查询会安全返回暂不可用；既有 Catalog 搜索和 Capability 执行路径不受影响。

## Routing Policy

当前唯一 `OPEN` 的 policy point 是 `agentRoutingPolicy`。其它 policy point，包括：

- `restrictedOperationPolicy`
- `modelSelectionPolicy`
- `modelFallbackPolicy`
- `contextWindowPolicy`

当前都还是 `RESERVED`，插件不能实现也不能激活。

```ts
import { defineAgentRoutingPolicy, definePlugin } from '@nextagent/agent-plugin-sdk';

const routeAlarms = defineAgentRoutingPolicy({
  policyPointId: 'agentRoutingPolicy',
  policyId: 'route-alarms',
  timeoutMs: 3000,
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      rejectKeyword: { type: 'string' },
    },
  },
  configure(config) {
    const rejectKeyword = typeof config.rejectKeyword === 'string' ? config.rejectKeyword : undefined;
    return {
      decide(_run, context) {
        if (rejectKeyword !== undefined && context.acceptedInputText?.includes(rejectKeyword) === true) {
          return { kind: 'REJECT', safeReason: 'configured-routing-reject' };
        }
        return { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'configured-routing-default' };
      },
    };
  },
  decide(_run, context) {
    if (context.acceptedInputText?.includes('alarm') === true) {
      return { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'alarm-routing' };
    }
    return { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'default-routing' };
  },
});

export default definePlugin({
  pluginId: 'telecom.ops',
  version: '1.0.0',
  policies: [routeAlarms],
});
```

Agent 仍要显式激活：

```yaml
policies:
  - policyPointId: agentRoutingPolicy
    pluginId: telecom.ops
    policyId: route-alarms
    enabled: true
    timeoutMs: 3000
    config:
      rejectKeyword: forbidden-change
```

插件 routing policy 使用与存量 core routing policy 一致的接口：`decide(run, context, signal)`。其中 `run` 是 accepted `RequestRun`，`context` 是 accepted `RequestContext`，`acceptedInputText` 仍来自 `RequestContext.acceptedInputText`，core routing adapter 不会在 wrapper 里做额外 summary、redaction、truncation 或字段投影。输入边界如需收紧，必须在 routing 业务 contract 中统一调整，并同时适用于内置 policy 和插件 policy。

运行期不是把某个插件 policy 作为全局 routing policy 单例注入。`agent-app` 只负责装配：把启动期冻结的插件贡献传给 `agent-runtime` policy registry/resolver，再把该 resolver 作为 `agent-core` runtime dependency 注入。policy registry 和 hook registry 一样按 startup + assembly scope 物化 executable，并用 accepted Agent scope 查询当前 Agent 的激活项；不同的是 policy registry 用可枚举的 policy point 到 executable 类型映射承载不同形状的 policy，不要求所有 policy 都长成同一个接口。带 `config` 的 Agent activation 会生成按 `agentAssemblyRef` 隔离的 configured executable。`agent-core` routing path 每次按 accepted `agentId`、`agentVersion`、`agentAssemblyRef` 和 `policyPointId=agentRoutingPolicy` 解析当前 Agent 激活的 executable：解析到已激活插件 policy 时执行插件；没有激活项时回到内置 routing policy。assembly ref 不一致、重复激活、实现缺失或 routing executable 形状不匹配这类装配/物化问题应在启动或 Agent assembly 编译阶段失败；插件 policy 自身 throw、timeout 或返回非法结果时才在 routing 业务边界 fail closed。

## Lifecycle Hook

插件可以导出 `defineLifecycleHook(...)` 创建的 `LifecycleHook` object。Hook 代码在启动期进入 trusted composition snapshot，但是否对某个 Agent 生效，仍由 Agent `hooks` 配置决定。

Agent definition 激活形状如下：

```yaml
hooks:
  - hookId: telecom.ops.audit-hook
    enabled: true
    stages:
      - BEFORE_AGENT_TERMINAL
    timeoutMs: 1000
```

如需控制顺序：

```yaml
hooks:
  - hookId: telecom.ops.audit-hook
    enabled: true
    order:
      after: existing.custom.hook
```

当前 hook 激活的真实约束包括：

- 只能引用已注册的 hookId
- `enabled: false` 和 `disabled: true` 不能同时出现
- `stages` 必须是 hook definition 支持的 stage 子集
- `SYSTEM` hook 的排序由 framework owner 控制，不能在 Agent activation 里重排
- 每个 stage 的有效 hook 数量受上限控制

Hook 适合做：

- 轻量观察
- 受控 guardrail
- 生命周期诊断

Hook 不适合承载：

- 必须强制执行且不可绕过的安全边界
- gateway 事务 owner 语义
- sandbox 执行 owner 语义
- request lifecycle / terminal commit owner 语义

这些仍然应该落在 runtime、gateway、sandbox、risk policy 或 app composition boundary。

## Developer Hook Trace

`developer-hook-trace` 是 SDK 内置的 observe-only 调测型插件，用于在 Agent loop 的 lifecycle hook 边界把当前 `HookInput.boundary` 提交给宿主统一的 developer diagnostic artifact sink。它不持有文件路径，也不把调测内容写入主运行日志。

### 生成正式插件产物

在开发或打包脚本中调用 `@nextagent/agent-plugin-sdk/developer-hook-trace`：

```ts
import { createDeveloperHookTracePluginArtifact } from '@nextagent/agent-plugin-sdk/developer-hook-trace';

createDeveloperHookTracePluginArtifact({
  targetDirectory: 'config/plugins/developer-hook-trace',
});
```

生成的发布目录是普通本地插件 artifact：

```text
config/
  plugins/
    developer-hook-trace/
      plugin.json
      index.js
```

`plugin.json` 内容形态：

```json
{
  "pluginId": "developer-hook-trace",
  "version": "1.0.0",
  "apiVersion": "1.1",
  "main": "./index.js",
  "artifactType": "esm-bundle",
  "hostExternals": []
}
```

`index.js` 是 API 1.1 single-file ESM factory artifact，通过 factory host 获取 `developerDiagnostics`。若目标目录已存在 `plugin.json` 或 `index.js`，helper 默认失败；只有显式传入 `overwrite: true` 才会覆盖。插件没有 `logDirectory` 或 `logFile` 配置。

本地 runtime 打包会默认把该 artifact 写入候选包：

```text
config/plugins/developer-hook-trace/
  plugin.json
  index.js
```

打包只预置 artifact，不会在候选包的 `config/default-system.yaml` sample 中声明 `nextAgent.system.plugins[]`，也不会自动激活任何 Agent hook。

### 系统配置

如需启用，在开发者 `application.yaml` 的 `nextAgent.system.plugins` 显式声明插件目录。YAML 也接受下面的 JSON-compatible object 写法：

```json
{
  "developerDiagnostics": {
    "artifacts": { "enabled": true }
  },
  "nextAgent": {
    "system": {
      "plugins": [
        {
          "pluginId": "developer-hook-trace",
          "path": "plugins/developer-hook-trace",
          "required": true
        }
      ]
    }
  }
}
```

`path` 仍然是相对 `configRoot` 的路径；插件目录和 `main` bundle 不能逃逸 `configRoot`。`required: true` 表示 artifact 缺失、manifest 不合法、bundle 不可加载或 hook definition 不合法时阻断应用启动。

### Agent 激活配置

插件加载成功只说明 hook definition 进入 startup registry；要让某个 Agent 生效，还必须在该 Agent 的 `agent.yaml.hooks` 激活：

```json
{
  "hooks": [
    {
      "hookId": "developer-hook-trace.loop-raw-boundary",
      "enabled": true,
      "stages": ["BEFORE_PLANNING"]
    }
  ]
}
```

插件声明支持以下 stage：

```json
["BEFORE_PLANNING", "BEFORE_MODEL_INVOKE", "AFTER_MODEL_RESULT", "BEFORE_CAPABILITY_INVOKE", "AFTER_CAPABILITY_RESULT", "BEFORE_AGENT_TERMINAL"]
```

建议按调测目标收窄 `stages`，不要默认全开。需要在 loop 构造模型请求前查看用户原始问题时，启用 `BEFORE_PLANNING`；需要分析最终返回时，启用 `BEFORE_AGENT_TERMINAL`。当前产品路径 e2e 覆盖的是普通模型请求进入 `BEFORE_MODEL_INVOKE` 时写出日志；其它 stage 只有在对应 lifecycle stage owner 的主路径实际触发时才会写入。

### Developer diagnostic artifact 输出

LOCAL 模式显式启用后，统一输出到独立文件族：

```text
<paths.logDirectory>/nextagent-plugin-diagnostic.<date>.<sequence>.ndjson[.gz]
```

每行是宿主封装后的 JSON；以下原有 trace JSON 作为 `payload` 保留：

```json
{
  "event": "DEVELOPER_HOOK_TRACE",
  "hookId": "developer-hook-trace.loop-raw-boundary",
  "stage": "BEFORE_MODEL_INVOKE",
  "sessionId": "session-...",
  "requestId": "request-...",
  "runId": "run-...",
  "agentId": "default-agent",
  "agentVersion": "v1",
  "agentAssemblyRef": "default-agent:v1",
  "hookInvocationId": "hook-...",
  "idempotencyKey": "...",
  "rawModelRequestMessages": [],
  "rawModelRequestTools": [],
  "boundary": {
    "safeModelRequestSummary": "...",
    "messages": [],
    "tools": []
  }
}
```

开发 trace 只在 `boundary` 保留一次当前 stage 的业务数据，不将原始问题、模型请求/结果、工具入参/结果、终态内容或模型时延复制到顶层。顶层仅保留 trace 坐标与 `printedAt`，避免同一大 payload 被重复写入 NDJSON。

### 执行结果黑盒示例

下面示例展示启用全部 supported stages 后，单个请求在统一 artifact envelope 的 `payload` 中可观察到的连续 trace 内容；示例只表达黑盒 payload，不要求实现按示例里的字段顺序组织代码。

用户输入：

```text
分析小区 Cell-42 掉话率升高原因，并读取 counters/cell-42.json。
```

日志文件效果：

```jsonl
{"event":"DEVELOPER_HOOK_TRACE","hookId":"developer-hook-trace.loop-raw-boundary","stage":"BEFORE_PLANNING","sessionId":"session-demo","requestId":"request-demo","runId":"run-demo","agentId":"default-agent","agentVersion":"v1","agentAssemblyRef":"default-agent:v1","hookInvocationId":"hook-demo-1","rawUserQuestion":"分析小区 Cell-42 掉话率升高原因，并读取 counters/cell-42.json。","boundary":{"stepId":"turn-1","roundIndex":0,"flowVariables":{"input_question":"分析小区 Cell-42 掉话率升高原因，并读取 counters/cell-42.json。"},"maxRounds":50,"maxCalls":5}}
{"event":"DEVELOPER_HOOK_TRACE","hookId":"developer-hook-trace.loop-raw-boundary","stage":"BEFORE_MODEL_INVOKE","sessionId":"session-demo","requestId":"request-demo","runId":"run-demo","agentId":"default-agent","agentVersion":"v1","agentAssemblyRef":"default-agent:v1","hookInvocationId":"hook-demo-2","rawModelRequestMessages":[{"role":"system","content":"You are a telecom network operations agent."},{"role":"user","content":"分析小区 Cell-42 掉话率升高原因，并读取 counters/cell-42.json。"}],"rawModelRequestTools":[{"name":"Read","description":"Read a workspace file."}],"boundary":{"stepId":"turn-1","modelId":"MiniMax-M2.7-highspeed","messageCount":2,"toolCount":1,"messages":[{"role":"system","content":"You are a telecom network operations agent."},{"role":"user","content":"分析小区 Cell-42 掉话率升高原因，并读取 counters/cell-42.json。"}],"tools":[{"name":"Read","description":"Read a workspace file."}]}}
{"event":"DEVELOPER_HOOK_TRACE","hookId":"developer-hook-trace.loop-raw-boundary","stage":"AFTER_MODEL_RESULT","sessionId":"session-demo","requestId":"request-demo","runId":"run-demo","agentId":"default-agent","agentVersion":"v1","agentAssemblyRef":"default-agent:v1","hookInvocationId":"hook-demo-3","rawModelOutputContent":"","rawModelToolCalls":[{"toolCallId":"call-read-cell-42","toolName":"Read","arguments":{"file_path":"counters/cell-42.json","offset":0,"limit":200}}],"boundary":{"stepId":"turn-1","finishReason":"tool_calls","toolCallCount":1,"content":"","toolCalls":[{"toolCallId":"call-read-cell-42","toolName":"Read","arguments":{"file_path":"counters/cell-42.json","offset":0,"limit":200}}]}}
{"event":"DEVELOPER_HOOK_TRACE","hookId":"developer-hook-trace.loop-raw-boundary","stage":"BEFORE_CAPABILITY_INVOKE","sessionId":"session-demo","requestId":"request-demo","runId":"run-demo","agentId":"default-agent","agentVersion":"v1","agentAssemblyRef":"default-agent:v1","hookInvocationId":"hook-demo-4","rawCapabilityArguments":{"file_path":"counters/cell-42.json","offset":0,"limit":200},"boundary":{"capabilityId":"Read","capabilityKind":"TOOL","providerKind":"BUNDLED","toolCallId":"call-read-cell-42","arguments":{"file_path":"counters/cell-42.json","offset":0,"limit":200}}}
{"event":"DEVELOPER_HOOK_TRACE","hookId":"developer-hook-trace.loop-raw-boundary","stage":"AFTER_CAPABILITY_RESULT","sessionId":"session-demo","requestId":"request-demo","runId":"run-demo","agentId":"default-agent","agentVersion":"v1","agentAssemblyRef":"default-agent:v1","hookInvocationId":"hook-demo-5","rawCapabilityResult":{"path":"counters/cell-42.json","content":"{\"dropRate\":0.031,\"rrcFailures\":18,\"handoverFailures\":7}"},"rawCapabilityGeneratedMessages":[{"role":"tool","toolCallId":"call-read-cell-42","content":"{\"dropRate\":0.031,\"rrcFailures\":18,\"handoverFailures\":7}"}],"boundary":{"capabilityId":"Read","capabilityInvocationId":"invoke-demo","status":"SUCCEEDED","structuredPayload":{"path":"counters/cell-42.json","content":"{\"dropRate\":0.031,\"rrcFailures\":18,\"handoverFailures\":7}"},"generatedMessages":[{"role":"tool","toolCallId":"call-read-cell-42","content":"{\"dropRate\":0.031,\"rrcFailures\":18,\"handoverFailures\":7}"}]}}
{"event":"DEVELOPER_HOOK_TRACE","hookId":"developer-hook-trace.loop-raw-boundary","stage":"BEFORE_MODEL_INVOKE","sessionId":"session-demo","requestId":"request-demo","runId":"run-demo","agentId":"default-agent","agentVersion":"v1","agentAssemblyRef":"default-agent:v1","hookInvocationId":"hook-demo-6","rawModelRequestMessages":[{"role":"user","content":"分析小区 Cell-42 掉话率升高原因，并读取 counters/cell-42.json。"},{"role":"tool","toolCallId":"call-read-cell-42","content":"{\"dropRate\":0.031,\"rrcFailures\":18,\"handoverFailures\":7}"}],"rawModelRequestTools":[{"name":"Read","description":"Read a workspace file."}],"boundary":{"stepId":"turn-2","modelId":"MiniMax-M2.7-highspeed","messageCount":2,"toolCount":1,"messages":[{"role":"user","content":"分析小区 Cell-42 掉话率升高原因，并读取 counters/cell-42.json。"},{"role":"tool","toolCallId":"call-read-cell-42","content":"{\"dropRate\":0.031,\"rrcFailures\":18,\"handoverFailures\":7}"}],"tools":[{"name":"Read","description":"Read a workspace file."}]}}
{"event":"DEVELOPER_HOOK_TRACE","hookId":"developer-hook-trace.loop-raw-boundary","stage":"AFTER_MODEL_RESULT","sessionId":"session-demo","requestId":"request-demo","runId":"run-demo","agentId":"default-agent","agentVersion":"v1","agentAssemblyRef":"default-agent:v1","hookInvocationId":"hook-demo-7","rawModelOutputContent":"Cell-42 掉话率升高主要与 RRC 建链失败和切换失败同步升高相关，建议先排查弱覆盖、邻区关系和切换参数。","rawModelToolCalls":[],"boundary":{"stepId":"turn-2","finishReason":"stop","toolCallCount":0,"content":"Cell-42 掉话率升高主要与 RRC 建链失败和切换失败同步升高相关，建议先排查弱覆盖、邻区关系和切换参数。","toolCalls":[]}}
{"event":"DEVELOPER_HOOK_TRACE","hookId":"developer-hook-trace.loop-raw-boundary","stage":"BEFORE_AGENT_TERMINAL","sessionId":"session-demo","requestId":"request-demo","runId":"run-demo","agentId":"default-agent","agentVersion":"v1","agentAssemblyRef":"default-agent:v1","hookInvocationId":"hook-demo-8","rawFinalContent":"Cell-42 掉话率升高主要与 RRC 建链失败和切换失败同步升高相关，建议先排查弱覆盖、邻区关系和切换参数。","rawTerminalToolCalls":[],"boundary":{"safeTerminalSummary":"final content chars=54 toolCalls=0","finalContent":"Cell-42 掉话率升高主要与 RRC 建链失败和切换失败同步升高相关，建议先排查弱覆盖、邻区关系和切换参数。","toolCalls":[]}}
```

从这个黑盒结果可以直接定位：

- 原始用户问题在 `BEFORE_PLANNING.boundary.flowVariables.input_question` 中记录。
- 每轮发给模型的 messages 和 tools 在 `BEFORE_MODEL_INVOKE.boundary` 中记录。
- 模型文本、reasoning、tool calls 和时延在 `AFTER_MODEL_RESULT.boundary` 中记录。
- 工具入参和工具结果在对应 capability stage 的 `boundary` 中记录。
- 最终用户可见返回在 `BEFORE_AGENT_TERMINAL.boundary.finalContent` 中记录。
- 同一个 `runId` 下可能出现多轮 `BEFORE_MODEL_INVOKE` / `AFTER_MODEL_RESULT`；出现次数取决于模型是否请求 capability。

`BEFORE_PLANNING` 日志会在 loop 本轮 context assembly 和模型请求构造前写出，形态如下：

```json
{
  "event": "DEVELOPER_HOOK_TRACE",
  "hookId": "developer-hook-trace.loop-raw-boundary",
  "stage": "BEFORE_PLANNING",
  "rawUserQuestion": "分析小区掉话率升高原因",
  "boundary": {
    "stepId": "turn-1",
    "roundIndex": 0,
    "flowVariables": {
      "input_question": "分析小区掉话率升高原因"
    }
  }
}
```

`BEFORE_AGENT_TERMINAL` 日志会在最终内容形成后、用户可见 final-content event 发送前写出，形态如下：

```json
{
  "event": "DEVELOPER_HOOK_TRACE",
  "hookId": "developer-hook-trace.loop-raw-boundary",
  "stage": "BEFORE_AGENT_TERMINAL",
  "rawFinalContent": "最终返回内容",
  "rawTerminalToolCalls": [],
  "boundary": {
    "safeTerminalSummary": "...",
    "finalContent": "最终返回内容",
    "toolCalls": []
  }
}
```

字段说明：

- `event` 固定为 `DEVELOPER_HOOK_TRACE`
- `hookId` 固定为 `developer-hook-trace.loop-raw-boundary`
- `stage` 是当前 lifecycle stage
- `sessionId`、`requestId`、`runId`、`agentAssemblyRef`、`hookInvocationId`、`idempotencyKey` 只有 `HookInput` 提供时才出现
- `boundary` 是当前 hook stage 唯一的业务数据载体

### 黑盒效果

配置完成后的端到端效果是：

```text
system config plugins[]
-> app startup plugin loader 读取 developer-hook-trace/plugin.json + index.js
-> plugin.hooks 进入 startup lifecycle hook registry
-> AgentAssembly.hooks 激活 developer-hook-trace.loop-raw-boundary
-> runtime/model/capability 到达已启用 stage
-> hook 提交 artifactType=developer-hook-trace
-> 宿主写入统一 developer diagnostic artifact 文件族
-> 主请求继续执行
```

可观察结果：

- app 能正常启动，说明 artifact 被普通 plugin loader 接受。
- 当前 Agent 请求到达已启用 stage 时，timeline / audit 里可看到 `HOOK_INVOKED`，`hookId=developer-hook-trace.loop-raw-boundary`。
- 独立 artifact 文件族出现对应 run、manifest-bound pluginId 的 `DEVELOPER_HOOK_TRACE` payload。
- hook 是 observe-only，返回 `{ outcome: "PASS" }`，不返回 mutation，不阻断请求。
- sink 写入失败会被吞掉并继续主流程；失败不会变成用户可见响应。

边界：

- 该能力只输出到调用方配置的本地日志文件，不写数据库，不进入 stream event，不改变 canonical timeline 结构。
- 可见数据上限等于当前 `HookInput.boundary`；本插件不扩展 HookInput contract。
- `boundary` 可能包含 prompt、模型消息、工具参数或工具结果等调测敏感数据。只应在受控开发环境启用，日志目录应按本地调测数据管理，不能当作生产审计日志或安全 telemetry。
- 插件 artifact 不会自动写入 system config，也不会自动修改任何 Agent 的 `hooks[]`；加载和激活必须由部署方显式配置。

## Context Monitor

`context-monitor` 是 SDK 内置的 observe-only 调测型插件，用于记录上下文窗口的演化过程：压缩发生时提交 pre/post/summary artifact，每个 run 终态时提交最新 messages 与模型答案 artifact。它与 developer hook trace 共享宿主管理的独立文件族，不创建 session-specific 文件。

记录策略刻意最小化：平时每轮只在内存覆盖更新「最新 messages」和「最新答案」；只有压缩和 run 终态分别提交 `context-evolution.compaction` 与 `context-evolution.terminal`。

### 生成正式插件产物

在开发或打包脚本中调用 `@nextagent/agent-plugin-sdk/context-monitor`：

```ts
import { createContextMonitorPluginArtifact } from '@nextagent/agent-plugin-sdk/context-monitor';

createContextMonitorPluginArtifact({
  targetDirectory: 'config/plugins/context-monitor',
});
```

生成的发布目录是普通本地插件 artifact：

```text
config/
  plugins/
    context-monitor/
      plugin.json
      index.js
```

`plugin.json` 内容形态：

```json
{
  "pluginId": "context-monitor",
  "version": "1.0.0",
  "apiVersion": "1.1",
  "main": "./index.js",
  "artifactType": "esm-bundle",
  "hostExternals": []
}
```

`index.js` 是 single-file ESM artifact，不需要额外 host external。若目标目录已存在 `plugin.json` 或 `index.js`，helper 默认失败；只有显式传入 `overwrite: true` 才会覆盖。本地 runtime 打包会默认把该 artifact 写入候选包 `config/plugins/context-monitor/`，但不会在候选包的 `config/default-system.yaml` sample 中声明 `nextAgent.system.plugins[]`，也不会自动激活任何 Agent hook。

### 系统配置

如需启用，在 `default-system.yaml` 的 `nextAgent.system.plugins` 显式声明插件目录：

```json
{
  "nextAgent": {
    "system": {
      "plugins": [
        {
          "pluginId": "context-monitor",
          "path": "plugins/context-monitor",
          "required": false
        }
      ]
    }
  }
}
```

`path` 是相对 `configRoot` 的路径。`required: false` 表示 artifact 缺失时不阻断应用启动——调测插件建议设为 `false`，避免环境不具备时影响启动。

### Agent 激活配置

插件加载成功只说明 hook definition 进入 startup registry；要让某个 Agent 生效，还必须在该 Agent 的 `agent.yaml.hooks` 激活。`stages` 省略时自动激活全部 supportedStages：

```json
{
  "hooks": [{ "hookId": "context-monitor.context-evolution", "enabled": true }]
}
```

如需收窄 stage，只补 `stages`；插件配置仅支持 `enabled`：

```json
{
  "hooks": [
    {
      "hookId": "context-monitor.context-evolution",
      "enabled": true,
      "stages": ["BEFORE_MODEL_INVOKE", "AFTER_MODEL_RESULT", "AFTER_CONTEXT_COMPACT", "BEFORE_CONTEXT_COMPACT", "BEFORE_AGENT_TERMINAL"]
    }
  ]
}
```

### 在默认 Agent 上启用

默认系统 Agent（`default-agent`）出厂的 `agent.yaml` **没有 `hooks` 字段**，因此即便完成了上面的「系统配置」加载，hook 也不会在默认 Agent 上触发——必须在该 Agent 的 `hooks[]` 里显式激活。

在打包/本地运行时里，系统先使用包内 builtin `default-agent`，只有 `agents/default-agent/agent.yaml` 存在时才用本地定制替换 builtin。`pack:release` 包会预置这个文件用于能力验证；其他包如未预置，需要先把 `packages/agent-core/src/builtin-agents/default-agent/agent.yaml` 复制为部署包内 `agents/default-agent/agent.yaml`，再在该文件加上 `hooks` 字段：

```json
{
  "agentId": "default-agent",
  "agentVersion": "v1",
  "...": "（其余字段保持不变）",
  "hooks": [{ "hookId": "context-monitor.context-evolution", "enabled": true }]
}
```

要点：

- builtin 源文件 `packages/agent-core/src/builtin-agents/default-agent/agent.yaml` 始终保持不激活（默认不开启）；你只编辑部署包里的 `agents/default-agent/agent.yaml` 定制副本，不影响出厂默认。
- 如果你用的是自定义本地 Agent 而非默认 Agent，把同样的 `hooks[]` 加到那个 Agent 的 `agent.yaml` 即可。
- 不论哪种情况，**两步都不能省**：先在 `default-system.yaml` 的 `nextAgent.system.plugins[]` 加载插件，再在目标 Agent 的 `hooks[]` 激活。只加载不激活 = hook 进了 registry 但没人用 = 不触发、不记录。

插件声明支持以下 stage：

- `BEFORE_MODEL_INVOKE`：用 `boundary.messages` 更新内存「最新 messages」；若此前有压缩待补，则写出压缩文件（压缩后 messages 即本次 boundary）。
- `AFTER_MODEL_RESULT`：用 `boundary.content` 更新内存「最新答案」。
- `AFTER_CONTEXT_COMPACT`：把当前内存最新 messages 作为「压缩前」快照、`boundary.content` 作为 summary 文本入队，标记压缩待补。
- `BEFORE_CONTEXT_COMPACT`：压缩点标记，不单独落盘。
- `BEFORE_AGENT_TERMINAL`：覆盖写 last 文件，含最新 messages + 最新答案。

### Developer diagnostic artifact 输出

两个 artifact type 进入同一宿主管理的文件族：

```text
<paths.logDirectory>/
  nextagent-plugin-diagnostic.<date>.<sequence>.ndjson[.gz]
```

插件不能控制路径或文件生命周期；每条宿主 envelope 绑定可信 `pluginId=context-monitor`。

`{sessionId}/compact-{seq}.json` 内容：

```json
{
  "event": "CONTEXT_COMPACT",
  "hookId": "context-monitor.context-evolution",
  "stage": "AFTER_CONTEXT_COMPACT",
  "sessionId": "session-...",
  "requestId": "request-...",
  "runId": "run-...",
  "agentId": "default-agent",
  "agentVersion": "v1",
  "seq": 1,
  "pre": [],
  "post": [],
  "summary": "前缀压缩后的 summary 文本"
}
```

terminal artifact 的 `payload` 内容：

```json
{
  "event": "CONTEXT_LAST",
  "hookId": "context-monitor.context-evolution",
  "stage": "BEFORE_AGENT_TERMINAL",
  "sessionId": "session-...",
  "agentId": "default-agent",
  "agentVersion": "v1",
  "messages": [],
  "answer": {
    "content": "模型最终答案",
    "toolCalls": []
  }
}
```

字段说明：

- `pre` 是压缩前的完整 messages 快照（压缩时内存中最近一次 `BEFORE_MODEL_INVOKE` 的 messages）。
- `post` 是压缩后的完整 messages（压缩后下一次 `BEFORE_MODEL_INVOKE` 的 messages，即 summary + 保留尾）。
- `summary` 是 `AFTER_CONTEXT_COMPACT.boundary.content` 生成的 summary 文本。
- `messages` 是最后一轮投递给模型的完整上下文，已覆盖全部历史。
- `answer` 来自最后一次 `AFTER_MODEL_RESULT`；若该 run 未到达模型结果（如提前失败），`answer` 字段缺省。
- `sessionId` 只作为受校验的运行坐标进入 envelope，不参与文件名或目录派生。

被压缩丢弃的前缀 = `pre` 中存在、`post` 中不存在的 messages；summary = `post` 中新增的 role=SUMMARY 条目。这样无需额外字段即可还原压缩前后的 message 变更。

### 黑盒效果

配置完成后的端到端效果是：

```text
system config plugins[]
-> app startup plugin loader 读取 context-monitor/plugin.json + index.js
-> plugin.hooks 进入 startup lifecycle hook registry
-> AgentAssembly.hooks 激活 context-monitor.context-evolution
-> runtime/model/context-engine 到达已启用 stage
-> 压缩发生：提交 context-evolution.compaction
-> run 终态：提交 context-evolution.terminal
-> 宿主写入统一 developer diagnostic artifact 文件族
-> 主请求继续执行
```

可观察结果：

- app 能正常启动，说明 artifact 被普通 plugin loader 接受。
- session 发生上下文压缩时产生一条 compaction artifact，含压缩前后 messages 与 summary。
- 每个 run 结束时产生一条 terminal artifact，含最新一轮的 messages + 答案。
- hook 是 observe-only，返回 `{ outcome: "PASS" }`，不返回 mutation，不阻断请求。
- sink 丢弃或失败时继续主流程；失败只更新本地安全状态，不变成用户可见响应或主日志镜像。

边界：

- 该能力只输出到宿主管理的本地 developer diagnostic artifact 文件族，不写数据库，不进入 stream event，不改变 canonical timeline 结构，也不扩展 HookInput boundary 契约。
- 平时每轮不提交记录，只在内存覆盖；进程被强杀时尚未提交的 terminal 内容可能丢失。
- 压缩前快照是「压缩时内存中最近一次 `BEFORE_MODEL_INVOKE` 的 messages」，不含当回合新用户消息——该消息属于新输入而非被压缩内容，且保留在压缩后 retained tail 中，不影响 dropped 的 diff 还原。
- 同一 assemble 内若发生多次压缩且中间无模型调用，多次压缩的 `post` 都会是同一次模型调用的 messages；这是 boundary 契约不暴露中间态的固有限制，单次压缩（常见场景）不受影响。
- `messages`/`pre`/`post`/`answer` 可能包含 prompt、模型消息、工具参数或工具结果等调测敏感数据。只应在受控开发环境启用；文件族固定 100 MiB/daily 轮转、3 elapsed-day retention，不能当作生产审计日志或安全 telemetry。
- 插件 artifact 不会自动写入 system config，也不会自动修改任何 Agent 的 `hooks[]`；加载和激活必须由部署方显式配置。

## Host Externals

默认推荐把 `typebox`、`ajv` 和其它依赖直接打包进单文件 bundle，并导出 `definePlugin(...)` 的 plain plugin object。

只有多个插件需要共享宿主工具库并要求宿主版本一致时，才使用 `definePluginFactory(...)` 和 `hostExternals`：

```ts
import { definePluginFactory } from '@nextagent/agent-plugin-sdk';

export default definePluginFactory((host) => {
  const { Type } = host.externals.typebox as { Type: unknown };
  void Type;
  return {
    pluginId: 'telecom.ops',
    version: '1.0.0',
    providers: [],
  };
});
```

当前 host external 只有两个白名单 id：

- `typebox`
- `ajv`

约束如下：

- 插件声明了 `hostExternals` 时，默认导出必须是 factory
- 没声明 `hostExternals` 时，默认导出不能是 factory
- 宿主不会开放白名单之外的 package

## 同步与异步装配

如果你直接使用 `createNextAgentApp(...)`（`@nextagent/agent-app` 公开导出）这样的同步 composition，并且 system config 里声明了插件，那么必须预先把 `pluginRegistrySnapshot` 传进来；否则同步 composition 会直接拒绝启动。

如果使用异步入口 `createNextAgentAppAsync(...)`，宿主会先加载插件 snapshot，再进入 composition。

对插件开发者的含义是：

- 启动期插件加载是 app composition 的责任
- 插件自己不负责触发注册
- 也不应该假设“只要目录存在，任意同步入口都会自动扫到插件”

## 本地测试

`agent-test-kit` 提供 `createPluginTestHarness(plugin, options?)`，直接消费已导入插件对象：

```ts
import { createPluginTestHarness } from '@nextagent/agent-test-kit';
import plugin from '../src/index.js';

const harness = createPluginTestHarness(plugin);
await harness.invokeTool('telecom.ops.tools', 'lookup-alarm', { alarmId: 'ALM-1001' });
```

Routing policy 和 lifecycle hook 也可以直接测试：

```ts
await harness.evaluateAgentRoutingPolicy('route-alarms', requestRun, requestContext);
await harness.executeHook('telecom.ops.audit-hook', {
  hookId: 'telecom.ops.audit-hook',
  agentId: 'default-agent' as never,
  agentVersion: 'v1' as never,
  stage: 'BEFORE_AGENT_TERMINAL',
  boundary: {
    finalContent: 'diagnosis complete',
    toolCalls: [],
    safeTerminalSummary: 'diagnosis complete',
  },
});
```

Harness 支持：

- `invokeTool(providerId, capabilityId, input)`
- `evaluateAgentRoutingPolicy(policyId, run, context)`
- `executeHook(hookId, input)`

Harness 不读取 `plugin.json`，不执行 dynamic import，不校验 bundle、host external、system config、Agent activation 或主路径治理。它证明的是插件 object 的 public contract，不是宿主加载链路。

建议最少做两层测试：

- SDK / harness 测试：验证 Tool、Policy、Hook object 的行为
- 集成测试：验证 `plugin.json`、bundle、system config、Agent activation 和宿主加载链路

## 禁止事项

- 不支持 zip、archive、多文件 runtime bundle、目录自动扫描或 glob discovery
- `agent-app` 不执行插件 `npm install`，不解析插件私有 `node_modules`
- 插件 bundle 不得保留 runtime import specifier，包括 static import、`export ... from` 和 string-literal dynamic import
- 插件目录和 `main` bundle 不得逃逸出 `configRoot`
- 不允许使用未开放的 host externals
- 不允许实现 `RESERVED` policy point
- 不允许把插件能力自动写入默认 Agent `capabilityBindings`、`policies`、`hooks` 或 system config `plugins[]`
- 不允许把宿主私有实现对象泄漏到 public contract、Web response、stream event 或 persistence record
- 动态执行 shell、python、脚本或模型生成代码仍必须走 sandbox gateway boundary

## 设计理解

把当前插件机制理解成 “startup-time loaded, app-composed, agent-activated extension surface” 最准确：

- 插件在启动期被加载
- 它的贡献由 `agent-app` 注入现有 runtime / capability / assembly 治理路径
- Agent 通过 definition 显式决定哪些插件事实进入自己的 `AgentAssembly`

所以插件不是一个绕过既有架构边界的入口；它只是把 Tool、Routing Policy、Lifecycle Hook 作为受控扩展面，纳入现有 owner 和 validation 路径。
