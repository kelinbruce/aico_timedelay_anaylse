# Agent 配置参考

`agent.yaml` 是 Agent package 的权威业务装配输入。本文档基于真实的 `default-agent` 与 `network-explorer` 内置 Agent 配置（`packages/agent-core/src/builtin-agents/{agentId}/agent.yaml`）整理完整字段手册。

> **格式说明**：`agent.yaml` 使用 YAML；JSON 是 YAML 的兼容子集，但开发者新建文件时建议直接采用 YAML。

Prompt 模板不再通过 `agent.yaml` 中的 id allowlist 绑定，而是放在同一 Agent package 的 `prompts/` 目录，由 Context Engine 在同步装配期注册为 Agent-scoped frozen template facts。runtime-facing `AgentAssembly` 不携带 prompt text、prompt root path、template refs 或 prompt id allowlist。

## agent.yaml 位置

内置 Agent（framework-owned，不建议修改，作为参考）：

```text
packages/agent-core/src/builtin-agents/{agentId}/agent.yaml
```

自定义 Agent 放在开发者配置根目录 `<configRoot>/agents/{agentId}/agent.yaml`。`<configRoot>` 的解析规则：

- 默认（未指定 `application.yaml` 时）：`NEXTAGENT_CONFIG_DIR` 环境变量，否则当前工作目录。
- 通过 `NEXTAGENT_APPLICATION_CONFIG` 环境变量指定 `application.yaml` 时：configRoot 即该文件所在目录。
- configRoot 同级默认还承载 `agents/`（自定义 Agent）、`skills/`（本地 Skill）等资源目录，可通过 `application.yaml` 的 `nextAgent.paths` 调整。

顶层本地 Agent / Agent package 下的 subagent 由 trusted Agent package locator 定位，统一纳入 governed `CapabilityDescriptor(kind="AGENT")` catalog。**不要把自定义 Agent 放进 `packages/agent-core/src/builtin-agents/` 框架源码树**——那是 framework-owned 内置资产的位置，交付升级时会被覆盖。

## 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | 是 | Agent 唯一标识，例如 `default-agent` |
| `agentVersion` | string | 是 | Agent 版本，例如 `v1`；`RequestRun` acceptance 时会固化 `agentVersion` 与 `agentAssemblyRef` |
| `displayName` | string | 否 | 稳定展示名称；未配置本地化名称时使用 |
| `locales` | object | 否 | 本地化展示名称，结构为 `{ "zh-CN": { displayName }, "en-US": { displayName } }`；合法 BCP 47-compatible tag 可继续扩展 |
| `description` | string | 否 | Agent 描述 |
| `modelIds` | string[] | 否 | Agent 允许使用的 canonical model ID 有序集合，引用 `application.yaml` 的 `modelProfiles[].models[].modelId`；省略时继承全部已校验系统模型，显式声明时必须非空且不重复 |
| `defaultModelId` | string | 否 | 默认 canonical model ID，必须属于解析后的 `modelIds`；省略时初始选择使用第一个 eligible model |
| `capabilityBindings` | object[] | 否 | 显式能力绑定列表 |
| `runtimeSettings` | object | 否 | 运行时参数 |
| `resources` | object[] | 否 | 额外资源引用 |
| `hooks` | object | 否 | Lifecycle hook 启用 / 关闭 / stage 收窄 / 排序 / 超时配置（详见 [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md)） |
| `userInvocable` | boolean | 否 | 是否允许用户直接调用；subagent（如 `network-explorer`）通常设为 `false` |

> `agent.yaml` 不支持 `promptTemplateIds` 或 `runtimeSettings.defaultPromptTemplateId`。prompt 模板由 `prompts/` 目录自动注册。

## capabilityBindings

每个绑定项字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `capabilityId` | string | 是 | 能力唯一标识，使用大小写准确的最终 Tool ID，例如 `search_memory`、`network-explorer`、`Bash`、`Read` |
| `capabilityType` | string | 是 | `TOOL` / `SKILL` / `AGENT` |
| `providerId` | string | 是 | 能力 provider 实例，例如 `builtin-tools`、`memory-tools`、`builtin-agents` |
| `enabled` | boolean | 否 | 是否启用，默认 `true`；subagent 内置 Tool 可显式设为 `false` 以禁用 |

`default-agent` 的真实绑定（来自 `packages/agent-core/src/builtin-agents/default-agent/agent.yaml`）：

```json
"capabilityBindings": [
  {
    "capabilityId": "network-explorer",
    "capabilityType": "AGENT",
    "providerId": "builtin-agents",
    "enabled": true
  },
  {
    "capabilityId": "search_memory",
    "capabilityType": "TOOL",
    "providerId": "memory-tools",
    "enabled": true
  },
  {
    "capabilityId": "get_memory_detail",
    "capabilityType": "TOOL",
    "providerId": "memory-tools",
    "enabled": true
  },
  {
    "capabilityId": "add_memory",
    "capabilityType": "TOOL",
    "providerId": "memory-tools",
    "enabled": true
  },
  {
    "capabilityId": "Rag",
    "capabilityType": "TOOL",
    "providerId": "builtin-tools",
    "enabled": true
  }
],
"hooks": [{ "hookId": "user-query-memory-recall", "stages": ["BEFORE_MODEL_INVOKE"], "enabled": true }]
```

`network-explorer` 作为只读 subagent，显式禁用所有内置可写 Tool（来自 `packages/agent-core/src/builtin-agents/network-explorer/agent.yaml`）：

```json
"capabilityBindings": [
  { "capabilityId": "Write", "capabilityType": "TOOL", "providerId": "builtin-tools", "enabled": false },
  { "capabilityId": "Bash", "capabilityType": "TOOL", "providerId": "builtin-tools", "enabled": false },
  { "capabilityId": "Python", "capabilityType": "TOOL", "providerId": "builtin-tools", "enabled": false },
  { "capabilityId": "Skill", "capabilityType": "TOOL", "providerId": "builtin-tools", "enabled": false },
  { "capabilityId": "AskUserQuestion", "capabilityType": "TOOL", "providerId": "builtin-tools", "enabled": false }
]
```

> **注册 ≠ 绑定**：能力被 catalog 发现不等于 Agent 有权调用；必须通过 `capabilityBindings` 显式绑定且 `enabled=true` 才可在该 Agent 的 request scope 中调用。

## runtimeSettings

`default-agent` 的真实配置：

```json
"runtimeSettings": {
  "defaultLanguage": "zh-CN",
  "maxTurns": 50,
  "maxToolCallsPerTurn": 30,
  "requestTimeoutMs": 1800000
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `defaultLanguage` | string | 默认交互语言，例如 `zh-CN` |
| `maxTurns` | number | 单次请求的模型回合上限；`default-agent` 为 `50`，`network-explorer` 为 `20` |
| `maxToolCallsPerTurn` | number | 单回合 Tool 调用上限；`default-agent` 为 `30` |
| `maxContextMessages` | number | 可选，上下文消息数上限 |
| `requestTimeoutMs` | number | 请求整体超时（毫秒）；内置 Agent 均为 `1800000`（30 分钟） |

## resources

`resources` 为额外资源引用数组。当前内置 Agent 均为空数组 `[]`。可承载 Agent 需要的静态资源引用（如分类问题 JSONL 等），具体 schema 由对应 capability 定义。

## hooks

`hooks` 表达当前 Agent 对 lifecycle hook 的启用 / 关闭 / stage 收窄 / 排序 / 超时 / 配置。Lifecycle hook 的产品路径由 `agent-app` 在启动期接收 trusted app / plugin composition 已装配的显式 `LifecycleHook` 对象并冻结 snapshot；`agent.yaml.hooks` 只是 Agent 对已注册 hook 的启用策略，runtime 只消费 accepted run 固化的 snapshot，不从配置目录、manifest 或请求主路径扫描 hook。

详细字段、stage 列表与开发指南见 [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md)。

## Prompt 模板目录

Prompt 模板放在同一 Agent package 下的 `prompts/` 目录，由 Context Engine 在同步装配期注册为 Agent-scoped frozen template facts：

```text
packages/agent-core/src/builtin-agents/{agentId}/prompts/{templateId}/template.yaml
packages/agent-core/src/builtin-agents/{agentId}/prompts/{templateId}.yaml
```

- `templateId` 等于框架内置 purpose 时可省略 manifest 的 `purpose`，例如 `SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION`。
- 自定义 purpose 必须在 manifest 中显式声明 `purpose` 和 `content`。
- `template.yaml` 是 YAML manifest，可引用 `.md` / `.txt` 作为 content sections；但裸 `.md` / `.txt` 不得作为完整 prompt template。
- `SYSTEM_PROMPT` 是高风险 purpose，内置 system prompt 承载双语电信输出规则（模型默认跟随用户实际输入语言，对 NE / interface / KPI / protocol / alarm / CLI 等电信术语保留原始英文形式）。

示例（`network-explorer` 的 system prompt，路径 `prompts/SYSTEM_PROMPT/template.yaml`）：

```yaml
content:
  - id: identity
    file: identity.md
  - id: task_approach
    file: task-approach.md
  - id: tooling
    file: tooling.md
  - id: action_safety
    file: action-safety.md
  - id: communication_style
    file: communication-style.md
  - id: context_management
    file: context-management.md
```

`SYSTEM_PROMPT` 是 framework well-known purpose，manifest 可省略 `schemaVersion` / `purpose`。每个 section 的内容放在同目录的 `.md` 文件中，由 `file:` 引用。

非 system purpose 可以使用字符串或有序 sections：

```yaml
schemaVersion: nextagent.prompt-template/v1
purpose: SUMMARY_GENERATION
content: |
  生成可追溯的运维摘要，保留关键设备、告警、命令和结论。
```

完整 prompt template 选择与装配规则见 [提示工程](./06-prompt-engineering.md) 和 `openspec/specs/prompt-template-assembly/spec.md`。

## 最小配置

```yaml
agentId: my-agent
agentVersion: v1
modelIds:
  - MiniMax-M2.7-highspeed
defaultModelId: MiniMax-M2.7-highspeed
capabilityBindings: []
runtimeSettings: {}
```

## 完整自定义 Agent 示例

以下是一个面向网络故障诊断的自定义 Agent 示例，展示全部常用字段（保存为 `<configRoot>/agents/network-diagnostic-agent/agent.yaml`，并在 `application.yaml.hostedAgent.activeAgentId` 切换后即可托管）：

```yaml
agentId: network-diagnostic-agent
agentVersion: v2.0
displayName: 网络诊断智能体
locales:
  zh-CN:
    displayName: 网络诊断智能体
  en-US:
    displayName: Network diagnostic agent
description: 用于网络故障诊断、配置审查和报告生成的智能体
userInvocable: true
modelIds:
  - MiniMax-M2.7-highspeed
defaultModelId: MiniMax-M2.7-highspeed
capabilityBindings:
  - capabilityId: Bash
    capabilityType: TOOL
    providerId: builtin-tools
    enabled: true
  - capabilityId: Read
    capabilityType: TOOL
    providerId: builtin-tools
    enabled: true
  - capabilityId: Grep
    capabilityType: TOOL
    providerId: builtin-tools
    enabled: true
  - capabilityId: Rag
    capabilityType: TOOL
    providerId: builtin-tools
    enabled: true
  - capabilityId: search_memory
    capabilityType: TOOL
    providerId: memory-tools
    enabled: true
  - capabilityId: network-explorer
    capabilityType: AGENT
    providerId: builtin-agents
    enabled: true
runtimeSettings:
  defaultLanguage: zh-CN
  maxTurns: 30
  maxToolCallsPerTurn: 20
  requestTimeoutMs: 1800000
resources: []
```

> 绑定 `Bash` 前先确认 sandbox 策略：默认配置 deny `bash` / `sh` / `powershell` 等可执行文件，仅放行 `clipc` / `curl` / `python`。需要 shell 执行时必须在 `application.yaml` 的 `nextAgent.system.sandbox` 显式调整，见[部署说明](./12-deployment.md)。

配套 prompt 模板目录结构示例（与 `agent.yaml` 同目录）：

```text
<configRoot>/agents/network-diagnostic-agent/
├── agent.yaml
└── prompts/
    └── SYSTEM_PROMPT/
        └── template.yaml
```

## 验证 Agent 配置

编译并启动后端后，检查启动日志中的 Agent assembly 和 prompt template registration 结果。非法 prompt manifest 会在 request acceptance 开放前 fail closed。

常用验证命令：

```bash
npm run build              # typecheck + workspace 编译 + 复制内置 skill 资产
npm test                   # vitest run
npm run lint:architecture  # 校验跨包边界与 manifest policy
npm run lint:openspec      # openspec validate --all --strict
```

启动后可用 curl 验证活跃 Agent（详见 [快速上手](./01-quickstart.md)）：

```bash
# 创建会话
curl -X POST http://127.0.0.1:3000/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"locale":"zh-CN"}'

# 提交请求（idempotencyKey 必填）
curl -X POST http://127.0.0.1:3000/api/v1/sessions/sess_xxx/requests \
  -H "Content-Type: application/json" \
  -d '{"inputText":"诊断小区掉话率升高原因","idempotencyKey":"idem-1","locale":"zh-CN"}'

# 查看流式响应（SSE）
curl -N http://127.0.0.1:3000/api/v1/sessions/sess_xxx/stream?requestId=req_xxx
```

完整 API 字段见 [agent-web API 清单](../apis/agent-web-api-list.md) 和 [API 参考](./10-api-reference.md)。
