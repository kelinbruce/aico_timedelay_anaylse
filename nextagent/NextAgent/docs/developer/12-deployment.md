# 部署说明

这一篇讲 NextAgent 本地模式的配置和部署。本地运行包用 npm workspaces 构建；框架内置 `default-system.yaml` 与开发者覆盖入口 `application.yaml` 都使用 YAML。

## 部署模式

当前版本支持**本地模式**（`deployment.mode = "LOCAL"`），未来将支持远程托管模式（REMOTE）。

本地模式特点：

- 后端 + 前端本地运行（Fastify + agent-web）
- SQLite gateway-local 持久化运行时状态
- 不依赖远程平台服务
- 远程能力路径可 stub 或降级到内置能力

```yaml
deployment:
  mode: LOCAL
```

## 配置体系

### 配置分层

```
系统配置 (内置 default-system.yaml + 开发者 application.yaml)
  ├── deployment / paths / observability
  ├── auth（mode / localIdentity / localAuth）
  ├── channel（transport / host / port）
  ├── hostedAgent.activeAgentId
  ├── modelProfiles[]
  ├── gateway.gateways[]（local-sqlite / local-rag）
  ├── rag.indexes
  ├── sandbox / noopBoundaries
  └── nextAgent
      ├── memory（enabled / search / extraction / aging）
      └── highFrequencyQuestion（frequencyThreshold）

Agent 定义 (agent.yaml)
  ├── 模型引用（modelIds / defaultModelId）
  ├── 能力绑定（capabilityBindings）
  ├── 运行时参数（runtimeSettings）
  └── hooks（启用 / 收窄 / 排序 / 超时 / 配置）
```

> NextAgent 不使用 `application.properties` 或任何 `.properties` 配置。开发者从自己的 `application.yaml` 覆盖框架 `default-system.yaml`；配置在启动期解析、校验并冻结。

### 系统配置详解

以下字段来自 `packages/agent-app/config/default-system.yaml`：

```json
{
  "deployment": { "mode": "LOCAL" },
  "paths": {
    "workspaceRoot": "workspaces",
    "logDirectory": "logs"
  },
  "observability": {
    "logging": { "diagnosticDetail": "normal", "level": "info" }
  },
  "auth": {
    "mode": "local",
    "localIdentity": {
      "tenantId": "local-tenant",
      "subjectId": "local-subject",
      "displayName": "Local developer"
    },
    "localAuth": { "enabled": false }
  },
  "channel": {
    "transport": "fastify",
    "host": "127.0.0.1",
    "port": 3000
  },
  "hostedAgent": { "activeAgentId": "default-agent" },
  "modelProfiles": [ /* 见下文 */ ],
  "gateway": {
    "gateways": [
      { "gatewayId": "local-sqlite", "gatewayKind": "sqlite", "deploymentMode": "LOCAL", "sqliteFileRef": "paths.sqliteFile" },
      { "gatewayId": "local-rag", "gatewayKind": "rag-knowledge", "deploymentMode": "LOCAL" }
    ]
  },
  "rag": { "indexes": ["local"] },
  "sandbox": {
    "allowedApis": [],
    "allowedExecutables": ["clipc", "curl", "python", "python3"],
    "clipcExecutableDirectoryEnv": "CLIP_HOME",
    "enabled": true,
    "deniedExecutables": ["bash", "sh", "powershell", "pwsh", "node", "npm", "wget", "ssh", "rm", "sudo"]
  },
  "noopBoundaries": {
    "lifecycleHook": "noop",
    "checkpoint": "noop",
    "audit": "noop"
  },
  "nextAgent": {
    "memory": {
      "enabled": true,
      "search": { "default-limit": 20, "min-confidence": 0.3 },
      "extraction": {
        "enabled": true,
        "strategy": "RULE_FIRST",
        "crossSessionSchedule": "0 0 0 * * ?",
        "maxCycleTrajectories": 20,
        "maxCandidates": 50,
        "timeoutMs": 60000,
        "lookbackDays": 7
      },
      "aging": {
        "enabled": true,
        "schedule": "0 0 0 * * ?",
        "decayStaleDays": 30,
        "archiveRetentionDays": 90,
        "decayFactor": 0.05,
        "batchLimit": 1000,
        "timeoutMs": 30000,
        "reviveConfidenceBoost": 0.1
      }
    },
    "highFrequencyQuestion": {
      "frequencyThreshold": 8
    }
  }
}
```

上面的 `deniedExecutables` 仅展示代表项，完整默认名单以目标版本的 `packages/agent-app/config/default-system.yaml` 为准。

字段说明：

| 顶层键 | 说明 |
|--------|------|
| `deployment.mode` | 部署模式，当前仅 `LOCAL` |
| `paths.workspaceRoot` / `paths.logDirectory` | workspace 根目录与日志目录 |
| `observability.logging` | 统一运行日志配置：`diagnosticDetail`、`level`、console 与 file；安全脱敏始终开启 |
| `auth.mode` | 认证模式（`local`） |
| `auth.localIdentity` | 本地开发者身份（tenantId / subjectId / displayName） |
| `auth.localAuth.enabled` | 是否强制本地登录（`true` 时需登录态 Cookie） |
| `channel.transport` | 传输方式（`fastify`） |
| `channel.host` / `channel.port` | 监听地址与端口（默认 `127.0.0.1:3000`） |
| `hostedAgent.activeAgentId` | 当前激活的 Agent id |
| `modelProfiles[]` | provider access 与其 canonical models 的两层配置 |
| `gateway.gateways[]` | 网关列表（sqlite / rag-knowledge） |
| `rag.indexes` | RAG 索引名列表 |
| `sandbox` | sandbox gateway 配置（`allowedApis`、executable policy、`clipc` locator env、`enabled`） |
| `noopBoundaries` | noop 边界（lifecycleHook / checkpoint / audit） |
| `nextAgent.memory` | 长期记忆（enabled / search / extraction / aging） |
| `nextAgent.highFrequencyQuestion` | 高频问题判定阈值（`frequencyThreshold`，整数 0-1000，默认 8；问题被问达到该次数后进入高频列表） |
| `nextAgent.system.capability-result-presentation` | 普通 Agent Web 的 Capability 成功结果显示级别；支持全局默认和按最终 `capabilityId` 精确覆盖 |

### Local sandbox 配置示例

交付环境应在自己的 `application.yaml` 中覆盖 sandbox 配置，不要直接编辑框架内置的 `default-system.yaml`。对象字段会递归合并，数组字段由覆盖值整体替换。

推荐只覆盖受控 API 列表，继续继承目标版本的 executable allowlist、denylist 和 `enabled=true`：

```yaml
sandbox:
  allowedApis:
    - https://api.example.internal/v1/
    - http://sidecar.internal/v1/
```

`allowedApis` 中每项必须满足以下约束：

- 使用绝对 `http:` 或 `https:` URL prefix，并以 `/` 结尾。
- 不包含 username、password、query 或 fragment。
- scheme、hostname 和 effective port 精确匹配；目标的规范化 pathname 必须命中配置的路径 prefix。
- 缺失或显式配置为 `[]` 时，所有 `curl` 请求和包含显式 HTTP(S) URL 的 Python 请求都会在进程启动前拒绝。
- 名单仅来自启动期可信配置；模型输入、Tool 参数、Skill metadata 和客户端 metadata 不能扩充名单。

如果确实需要显式覆盖 executable policy，可以使用以下结构。注意 `allowedExecutables` 和 `deniedExecutables` 都是数组，配置后会整体替换内置值：

```yaml
sandbox:
  enabled: true
  allowedApis:
    - https://api.example.internal/v1/
    - http://sidecar.internal/v1/
  allowedExecutables:
    - clipc
    - curl
    - python
    - python3
  clipcExecutableDirectoryEnv: CLIP_HOME
  deniedExecutables:
    # 示例仅展示代表项。生产配置应复制目标版本的完整默认 denylist 后再审查调整。
    - bash
    - sh
    - powershell
    - pwsh
    - node
    - npm
    - wget
    - ssh
    - rm
    - sudo
```

受控 curl 示例：

```bash
# allowedApis 包含 https://api.example.internal/v1/ 时允许继续执行
curl --silent https://api.example.internal/v1/items

# hostname 相似但不相同，启动进程前拒绝
curl https://api.example.internal.evil.test/v1/items

# path 不在 /v1/ 下，启动进程前拒绝
curl https://api.example.internal/v2/items
```

Local 模式的 Unix Socket 仅支持固定路径 `/opt/sidecar/ir/http.sock`，并且 URL 仍须命中 `allowedApis`：

```bash
curl --unix-socket /opt/sidecar/ir/http.sock \
  http://sidecar.internal/v1/query
```

其他 socket 路径、重复 `--unix-socket`、`--abstract-unix-socket`，以及代理、重定向、多 URL、URL glob 等无法唯一确定目标的 curl 形态都会拒绝。明确识别到未授权 URL 时，safe result 的 `message` 会返回去除 credentials、query 和 fragment 后的 URL；`safeDetails.reason` 为 `network-target-not-allowed`。

Python 检查只覆盖 source、script content 和 argv 中可识别的绝对 HTTP(S) URL literal。运行时字符串拼接、编码目标、底层 socket 或依赖 module 内部产生的访问不在覆盖范围内；该机制是 local 模式的临时 best-effort 防护，不是标准沙箱或完整网络出口隔离。

> `sandbox.enabled=false` 会跳过 local restricted sandbox 的 executable 和 API 目标校验，仅适用于明确受信的本地调试环境；不要把它作为生产绕过方式。

### Capability 结果呈现配置

部署方通过自己的 `application.yaml` 覆盖 Capability 结果呈现策略，不应直接编辑框架内置的 `default-system.yaml`：

```yaml
nextAgent:
  system:
    capability-result-presentation:
      default-level: SUMMARY
      rules:
        - capability-id: Bash
          level: STATUS_ONLY
        - capability-id: Read
          level: DETAIL
        - capability-id: VendorNetworkProbe
          level: DETAIL
```

`STATUS_ONLY`、`SUMMARY`、`DETAIL` 分别表示仅状态、安全摘要和有界安全详情。配置级别只是产品期望值，最终结果还会被平台按 Capability 身份、受支持 schema、字段白名单和容量边界收窄；没有安全 projector 的扩展 Tool 不能通过配置开放结果正文。

`capability-id` 使用大小写敏感的最终 Tool ID。Tool 被 Skill 或 ToolSearch 激活时仍按最终 Tool ID 匹配，不按调用来源配置。`default-level` 缺失时为 `SUMMARY`，主要作用于没有精确规则的扩展 Tool；平台内置 Capability 保留各自的基线，`rules` 只覆盖同名项或增加扩展 Tool 项。完整内置基线、用户可见效果和安全边界见[用户配置和使用指导](../用户配置和使用指导.md#工具执行结果显示策略)。

该对象在启动期完成 schema 校验并冻结，不持久化、不热更新，也不能由请求、Agent package、Skill、Capability 参数或模型输出覆盖。合法级别只有上述三种；`rules` 最多 256 项，每个 `capability-id` 长度为 1 至 128 个 Unicode code point。重复 ID、空 ID、未知字段、非法级别或超出边界都会使应用在接受请求前进入 blocked 状态。

### 模型配置

`modelProfiles[]` 每项是 provider access，`models[]` 是该 provider 下的 canonical 模型：

```yaml
modelProfiles:
  - providerId: openai-compatible
    baseUrl: https://api.minimaxi.com/v1
    credentialRef: env:OPENAI_API_KEY
    models:
      - modelId: MiniMax-M2.7-highspeed
        timeoutMs: 30000
        temperature: 0.2
        maxOutputTokens: 2048
        topP: 1
        contextWindowTokens: 128000
        fallbackEligible: false
```

| 字段 | 说明 |
|------|------|
| `providerId` | provider registration identity：`openai-compatible` 或 `model-gateway` |
| `baseUrl` / `credentialRef` | `openai-compatible` 要求 `baseUrl` 并允许可选凭据；`model-gateway` 禁止 `baseUrl`，但仍允许可选 `credentialRef` |
| `models` | provider 下的非空模型数组 |
| `modelId` | 全局唯一 canonical model identity，被 Agent、Prompt 和 Skill 直接引用 |
| canonical inference fields | `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` |
| `providerOptions` | selected provider 的开放扩展；不能重复 canonical、identity、access 或 transport 字段 |
| `reasoningTextMode` | OpenAI-compatible 模型的可选响应分帧模式；缺失时不报错并使用默认显式模式 |
| `timeoutMs` / `maxRetries` | logical invocation 总超时与同模型最大重试次数 |
| `contextWindowTokens` | OpenAI-compatible 模型上下文窗口大小 |
| `fallbackEligible` | 是否可作 cross-model fallback 候选 |

**推理字段与超时的代码默认值**（省略字段时生效，来自 `agent-model` 内部默认）：

| 字段 | 省略时默认 | 取值约束 |
|------|-----------|---------|
| `timeoutMs` | **30000（30 秒）** | 正整数 |
| `maxRetries` | **2** | 非负整数 |
| `temperature` | **0.55** | 0-2 |
| `topP` | — | 0-1 |
| `presencePenalty` / `frequencyPenalty` | — | -2 到 2 |

> **高频坑**：长推理模型（尤其开启 thinking 的）在默认 30 秒超时下必然被切断。这类模型务必显式配置足够大的 `timeoutMs`（如 300000）。另注意 Capability 层有独立的同参重试（默认 1 次、上限 5 次），与模型级 `maxRetries` 是两层不同重试。

部分 OpenAI-compatible 思考模型从响应首字符直接输出 reasoning，只使用 `</think>` 标记 reasoning 结束。仅对已确认采用该响应格式的模型，在对应 `models[]` 子项启用隐式起点：

```yaml
modelProfiles:
  - providerId: openai-compatible
    baseUrl: https://provider.example/v1
    credentialRef: env:OPENAI_API_KEY
    models:
      - modelId: implicit-reasoning-model
        contextWindowTokens: 128000
        fallbackEligible: false
        reasoningTextMode: IMPLICIT_OPEN_THINK_TAG
```

`IMPLICIT_OPEN_THINK_TAG` 表示响应从首字符起即属于 reasoning，首个 `</think>` 之后才是公开 content；流式响应中的闭合标签可以跨多个 chunk。该字段只解释模型输出，不控制模型是否生成 reasoning。

不配置 `reasoningTextMode` 时不会报错，也不会自动补字段，行为等同于 `EXPLICIT_THINK_TAG`：继续识别原生 reasoning 字段或成对的 `<think>...</think>`，普通 content 不会被当作 reasoning。不要为普通文本模型启用隐式模式，也不要在 `providerId: model-gateway` 下配置该字段；后者会在应用 ready 前被拒绝。

#### 配置、上游返回与 Web 响应参考

下面给出一个完整的隐式 reasoning 起点对接样例。`reasoningTextMode` 必须配置在采用该格式的具体 `models[]` 子项上：

```yaml
modelProfiles:
  - providerId: openai-compatible
    baseUrl: https://provider.example/v1
    credentialRef: env:OPENAI_API_KEY
    models:
      - modelId: Qwen-V3.6-27B-32K
        contextWindowTokens: 32768
        fallbackEligible: false
        reasoningTextMode: IMPLICIT_OPEN_THINK_TAG
```

该模型的上游 OpenAI-compatible 流可以从首个 `content` 字符直接输出 reasoning，并只返回闭合标签；`</think>` 可以落在一个 chunk 中，也可以跨 chunk：

```text
data: {"id":"chatcmpl-example","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"分析过程"},"finish_reason":null}]}
data: {"id":"chatcmpl-example","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"</thi"},"finish_reason":null}]}
data: {"id":"chatcmpl-example","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"nk>最终答案"},"finish_reason":"stop"}]}
data: [DONE]
```

OpenAI-compatible adapter 归一化后的模型终态等价于：

```json
{
  "reasoning": "分析过程",
  "content": "最终答案",
  "finishReason": "stop"
}
```

上游原始 chunk 不会直接透传给浏览器。Web 客户端看到的是既有 `StreamEnvelope`，其中 reasoning 和公开正文分别投影为以下事件；`eventId`、`sessionId`、`requestId`、`runId`、`sequence` 和时间戳由实际请求生成：

```text
event: LLM_THINKING_DELTA
data: {"eventId":"event-thinking-1","sessionId":"session-example","requestId":"request-example","runId":"run-example","sequence":2,"eventType":"LLM_THINKING_DELTA","transportHints":[],"payload":{"rootMessageId":"request-example","requestId":"request-example","runId":"run-example","reasoning":"分析过程","content":"分析过程","text":"分析过程","contentType":"PLAIN_TEXT","stepId":"model:1","metadata":{"accumulated":true}},"createdAt":1787220100480}

event: LLM_CONTENT_DELTA
data: {"eventId":"event-content-1","sessionId":"session-example","requestId":"request-example","runId":"run-example","sequence":3,"eventType":"LLM_CONTENT_DELTA","transportHints":[],"payload":{"rootMessageId":"request-example","requestId":"request-example","runId":"run-example","content":"最终答案","text":"最终答案","contentType":"MARKDOWN","role":"ASSISTANT","stepId":"model:1","metadata":{"accumulated":true}},"createdAt":1787220100481}
```

因此 Web thinking 区域显示“分析过程”，最终回答区域只显示“最终答案”，公开 content 中不保留 think 标签。完整 `StreamEnvelope` 字段和 SSE/WebSocket 传输格式见[流式事件](09-streaming-events.md)。

| 模型配置 | 上游 text-level 返回 | 黑盒结果 |
|------|------|------|
| `IMPLICIT_OPEN_THINK_TAG` | `分析过程</think>最终答案` | reasoning=`分析过程`，content=`最终答案` |
| 缺失或 `EXPLICIT_THINK_TAG` | `<think>分析过程</think>最终答案` | reasoning=`分析过程`，content=`最终答案` |
| 缺失或 `EXPLICIT_THINK_TAG` | 普通正文 | 全部保持为 content |
| 缺失或 `EXPLICIT_THINK_TAG` | 只有闭合标签的 `分析过程</think>最终答案` | 配置本身不报错，但不会自动按隐式起点解释；该上游格式应显式启用 `IMPLICIT_OPEN_THINK_TAG` |

> **备注：tool call、content 与 reasoning 的区分。** OpenAI-compatible adapter 先按上游结构化字段分流：`delta.reasoning_content` 直接归一化为 reasoning；`delta.tool_calls` 由 AI SDK 跨 chunk 组装为完整 tool call，不进入 think 标签解析；只有 `delta.content` 才按 `reasoningTextMode` 分帧。在 `IMPLICIT_OPEN_THINK_TAG` 下，首个 `</think>` 之前的 `delta.content` 是 reasoning，标签被丢弃，之后的 `delta.content` 是公开 content。正文中看起来像 JSON 或工具调用的普通字符串不会被猜测为 tool call，工具参数中的 `</think>` 也不会改变文本分帧状态。缺少闭合标签表示 provider 未满足所声明的 framing，不在成功互操作保证内。归一化后，Web 将 reasoning 和 content 分别投影为 `LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`；tool call 由 Core 接管，实际工具执行投影为 `CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA` 和 `CAPABILITY_COMPLETED`。

### credentialRef 安全配置

`credentialRef` 只支持 `env:` 和 `file:` 两种引用方式（不支持 `direct:` 形式，配置校验会拒绝）：

```jsonc
// 推荐：环境变量
"credentialRef": "env:OPENAI_API_KEY"

// 推荐：文件路径
"credentialRef": "file:config/api-key.txt"
```

启动前设置环境变量：

```bash
# PowerShell
$env:OPENAI_API_KEY = "your-api-key"
# Bash
export OPENAI_API_KEY="your-api-key"
```

### 认证配置

`auth.localAuth.enabled` 控制是否强制本地登录：

- `false`（默认）— 不强制登录，直接访问。
- `true` — 启用 local configured auth，前端需通过本地登录态 Cookie 访问（`ts-local-configured-auth` spec）。

**启用后变为必填的字段**（三者齐备才会生效，否则配置校验 fail-closed 拒绝启动）：

| 字段 | 约束 |
|------|------|
| `auth.localAuth.credentialRef` | 必须 `env:VAR` 或 `file:path` 引用；登录时提交的 `{credential}` 值与其解析结果比对 |
| `auth.localAuth.cookieTtlMs` | 整数，60000（1 分钟）到 86400000（24 小时） |

> 登录失败保护较弱：连续 3 次失败仅锁定 500ms。不要依赖该机制防暴力破解，生产环境应在前置网关/反向代理层做访问控制和限流。

### Channel 与网络配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `channel.host` / `channel.port` | `127.0.0.1` / `3000` | 监听地址与端口；也可用环境变量 `NEXTAGENT_CHANNEL_HOST` / `NEXTAGENT_CHANNEL_PORT` 启动期覆盖（优先于 yaml，IPv6 监听场景常用） |
| `channel.routePrefix` | `/` | API 路径公共前缀，拼在 `/api/v1` 之前；pattern `^/[A-Za-z0-9/_-]*$`，最长 64 字符 |
| `channel.udsPath` | — | Unix domain socket 监听路径（配置后以 UDS 替代 TCP 监听，Linux 部署可选） |

> **routePrefix 迁移坑**：前缀只拼在 API 树前（`/svcA/api/v1/...`），静态资源与页面路径仍在根路径。从旧版本迁移时，若旧配置写的是 `/api/v1`，升级后会变成 `/api/v1/api/v1/...` 双重前缀——旧部署的 routePrefix 值应改为 `/`。

### Task callback（Task channel 异步回调）

`taskCallback` 控制 Task channel `async-tasks` 模式下 NextAgent 回调调用方服务的约束，不配置则不允许任何回调目标：

```yaml
taskCallback:
  allowedOrigins:
    - https://ops-platform.example.com
  timeoutMs: 30000
  maxRetries: 3
  tlsInsecure: false
  # socketPath: /var/run/nextagent-callback.sock   # 可选：经 Unix domain socket 回调本机服务
```

| 字段 | 默认值 | 约束 | 说明 |
|------|--------|------|------|
| `allowedOrigins` | `[]` | 每项必须是 origin 形式（`https://host[:port]`，不带 path/凭证），最多 100 项 | 回调目标白名单；不在名单内的 callbackTarget 会被拒绝 |
| `timeoutMs` | `30000` | 整数 100-120000 | 单次回调超时 |
| `maxRetries` | `3` | 整数 1-10 | 回调失败重试次数 |
| `tlsInsecure` | `false` | boolean | 仅为 `true` 时跳过 TLS 证书校验（自签环境） |
| `socketPath` | — | 非空字符串 | 经 UDS 回调本机服务时的 socket 路径 |

### 能力披露与规划模式（`nextAgent.system.*`）

| 配置项 | 默认值 | 取值 | 说明 |
|--------|--------|------|------|
| `capability-disclosure.tool-disclosure-mode` | `list` | `list` \| `tool-search` | Tool 初始是否对模型全量可见；`tool-search` 时初始只暴露候选 `capabilityId`，模型经 `ToolSearch` 激活后可调用 |
| `capability-disclosure.skill-disclosure-mode` | `list` | `list` \| `tool-search` | 同上，作用于 Skill |
| `capability-disclosure.clipc-disclosure-mode` | `list` | `list` \| `tool-search` | 同上，作用于 CLIP Tool（详见 [Tool 规范](./24-tool-specification.md)） |
| `planning-tool-calling-mode` | `todo-write` | `todo-write` \| `task-tools` | 规划阶段的工具调用形态 |

### 日志轮转与保留（`observability.logging.file`）

| 字段 | 默认值 | 约束 | 说明 |
|------|--------|------|------|
| `enabled` | 跟随 logging profile | boolean | 是否写文件 |
| `name` | `nextagent-operational.log.jsonl` | 必须 `*.jsonl` 且不得以 `nextagent-audit` 开头 | 日志文件名（滚动后带 `.序号` 后缀） |
| `directory` | logDirectory 内 | 必须落在可信 logDirectory 范围内 | 单独指定目录 |
| `rotation.maxFileSizeMiB` | `30` | 整数 1-30 | 单文件上限，超过后滚动 |
| `retentionDays` | `7` | 整数，**下限 7（不可配置更短）** | 保留天数 |
| `maxArchiveFiles` | `10` | 整数 1-10 | 滚动分片保留份数 |

> 磁盘预算按 `maxFileSizeMiB × maxArchiveFiles` 估算（默认 30 MiB × 10 = 300 MiB，加当前分片）。指标文件 `nextagent-metrics.ndjson` 独立于该轮转配置。

### 长期记忆参数语义（`nextAgent.memory`）

`aging` / `extraction` / `search` 的完整默认值见上文配置样例。参数语义（无数量上下限约束，按含义调优）：

| 字段 | 语义 |
|------|------|
| `aging.schedule` | cron 表达式，aging 维护任务运行时刻（默认每日零点） |
| `aging.decayStaleDays` | 记忆多少天未被命中视为 stale |
| `aging.archiveRetentionDays` | archived 记忆保留天数，超过后清理 |
| `aging.decayFactor` | 每轮 aging 的置信度衰减系数 |
| `aging.reviveConfidenceBoost` | 记忆被再次命中时的置信度回升幅度 |
| `aging.batchLimit` / `aging.timeoutMs` | 单批处理规模与超时 |
| `extraction.strategy` | `RULE_FIRST`（规则优先，兜底 LLM）或 `LLM_ONLY` |
| `extraction.maxCycleTrajectories` / `maxCandidates` / `lookbackDays` / `timeoutMs` | 提取的轨迹数、候选数、回看天数、超时 |
| `extraction.crossSessionSchedule` | cron 表达式，跨会话提取周期 |
| `search.default-limit` / `search.min-confidence` | 检索默认返回条数与置信度下限 |

> 长期记忆总量没有容量上限，长周期运行会持续增长；`archiveRetentionDays` 是主要的容量治理手段。

## 数据存储

### SQLite gateway-local

SQLite 由 `gateway.gateways[]` 中 `gatewayKind: "sqlite"` 的网关提供，`sqliteFileRef` 引用 `paths.sqliteFile`。数据按业务事实表持久化（session / message / active context / timeline / checkpoint / annotation / share / memory 等），**禁止 generic `records(store,key,json)` 访问模式**。所有写入带 owner + agent scope，锚点幂等写入。

默认数据库位置（由 `nextAgent.paths` 派生；`workspaceRoot` 相对 configRoot 解析，configRoot 目录名为 `config` 时基准上移到其父目录）：

| 文件 | 默认路径 | 用途 |
|------|---------|------|
| 主库 | `<workspaceRoot>/data/system/nextagent.sqlite` | session / message / timeline / checkpoint 等业务事实表 |
| 工作记忆 | `<workspaceRoot>/data/system/working-memory.sqlite` | 工作记忆 |
| 长期记忆 | `<workspaceRoot>/data/system/long-term-memory.sqlite` | 长期记忆 |

### 备份与恢复

- **备份**：停止服务后（或确认无活跃 run 时）直接复制 `data/system/` 目录下的 `.sqlite` 文件。SQLite 单文件即完整快照，无需导出工具。
- **恢复**：停止服务，用备份文件替换对应 `.sqlite` 文件，重启并通过 `GET /api/v1/health/deep` 验证。
- **建议**：随交付环境制定定时备份策略（如每日一次，保留 N 份）；备份必须覆盖 `data/system/` 全部三个库与 `logs/`（审计需要时）。

### 升级与回滚（运行包部署）

1. **升级前**：备份 `data/system/` 与 `application.yaml`；按目标版本的发布说明（`docs/release/`）确认 Breaking / Behavioral Changes；已有 Agent 项目先离线执行[模型资产迁移工具](../../migration/model-authoring-v2/README.md)。
2. **升级**：解压新运行包到新目录，把 `data/`、`application.yaml`、`agents/`、`skills/`、`plugins/` 等部署侧资产迁回，运行 `node bin/nextagent-self-check` 通过后 `node bin/nextagent-start`。
3. **回滚**：停止服务，恢复备份的 `data/system/`，换回旧运行包目录（部署侧资产已在其内），自检后启动。运行包不含自动 schema 迁移工具，跨版本回滚必须同时回滚数据库文件——这是"升级前先备份"的原因。

### 进程守护与开机自启

运行包只提供裸 `node bin/nextagent-start` / `nextagent-stop`，生产环境需要自行套进程守护：

- **Linux（systemd）**：将 `node <package-root>/bin/nextagent-start` 配置为 `Type=simple` 服务，`Restart=on-failure`，`WorkingDirectory` 指向 `<package-root>`，环境变量通过 `Environment=` 注入（模型 key 等）。
- **Windows**：使用 NSSM / WinSW 将 `node.exe <package-root>\bin\nextagent-start` 注册为 Windows 服务。
- 守护配置中不要忘记 `NEXTAGENT_APPLICATION_CONFIG`（若使用自定义配置路径）与模型凭据环境变量。

### TLS 与反向代理

`channel` 配置当前只有 `host` / `port`（HTTP 明文监听），TLS 终止由前置反向代理承担：

```nginx
server {
  listen 443 ssl;
  server_name nextagent.example.com;
  ssl_certificate     /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    # SSE 必需：禁用缓冲、放宽读超时
    proxy_buffering off;
    proxy_read_timeout 3600s;
    # WebSocket 必需
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

注意三点：SSE 需要关闭代理缓冲并放宽读超时；WebSocket 升级头必须透传；NextAgent 自身不做 HTTPS，凭据类环境变量应只注入应用进程。

### 文件存储

- workspace：`paths.workspaceRoot`（默认 `workspaces`）
- execution 文件访问从 `workspaceRoot/execution` 派生 accepted-run 逻辑 root：`workspace/`（durable read/write）、`.nextagent/`（system-managed authorized）、`temp/`（run-scoped scratch）。
- 日志：`paths.logDirectory`（默认 `logs/`）

## 本地运行包打包

NextAgent 提供三种本地运行包 profile，由 `scripts/pack-local-runtime.mjs` 实现：

| 命令 | profile | 内容 |
|------|---------|------|
| `npm run pack:release` | `with-frontend` | 后端 + 前端（组装 `@nextagent/agent-web` artifact） |
| `npm run pack:backend` | `backend-only` | 仅后端 |
| `npm run pack:front` | `frontend-only` | 仅前端 |

这些运行包不包含开发者源码迁移工具。升级已有 Agent 项目时，应从目标 NextAgent release/tag 的源码复制单文件 `migration/model-authoring-v2/migrate.py`，在部署新 runtime 前对 Agent 项目离线执行；脚本无需放入 Agent 项目或部署包。具体命令见[模型资产迁移工具说明](../../migration/model-authoring-v2/README.md)。

#### 构建 Model Gateway-only 运行包

确定的 `model-gateway` 部署可以选择 `model-gateway-only` 模式。该模式会从本地运行包中排除 OpenAI-compatible provider 调用实现、`@ai-sdk/openai-compatible` 与 `ai` runtime dependency；默认 `pack:release` / `pack:backend` 产物不受影响，仍保留两种 provider capability。

专用打包命令会先按模式重建 workspace dist 和（`with-frontend` 时）前端 artifact。准备一个只包含 `model-gateway` 的配置样例；`model-gateway` 禁止配置 `baseUrl`，`credentialRef` 仍按需使用 `env:` 或 `file:` SecretReference：

```yaml
modelProfiles:
  - providerId: model-gateway
    credentialRef: env:DEPLOYMENT_CHOSEN_MODEL_CREDENTIAL
    models:
      - modelId: MiniMax-M2.7
        fallbackEligible: false
```

假设样例保存为 `packages/agent-app/config/gateway-system.yaml`，构建命令如下：

```powershell
npm run pack:backend:model-gateway-only -- --config-sample packages/agent-app/config/gateway-system.yaml
npm run pack:release:model-gateway-only -- --config-sample packages/agent-app/config/gateway-system.yaml
```

`gateway-system.yaml` 是构建输入样例，不需要提交到仓库；生产部署仍应使用自己的 overlay 或配置样例。若配置中任一 `modelProfiles[].providerId` 为 `openai-compatible`，打包、解包自检或启动会 fail closed，诊断 code 为 `MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE`，不会生成可启动但首次模型调用才缺件的候选。
`model-gateway-only` 专用命令使用 `tsconfig.model-gateway-only.json` 编译 `agent-model` 与 `agent-app`，OpenAI-compatible invocation 源文件不进入该编译图，随后 staging 再物理移除实现与 SDK。不要用默认 `npm run build` 构建已删除 OpenAI 源码的工作区；默认模式仍要求完整源码。若外部裁剪流程已移除该源码，必须继续使用 `pack:*:model-gateway-only` 专用命令。

可在解包目录中确认产物边界：

```powershell
$forbiddenPaths = @(
  "node_modules/@nextagent/agent-model/dist/providers/openai-compatible/openai-compatible-provider.js",
  "node_modules/@nextagent/agent-model/dist/providers/shared/tool-use-normalizer.js",
  "node_modules/@ai-sdk/openai-compatible",
  "node_modules/ai"
)
$presentPaths = $forbiddenPaths | Where-Object { Test-Path -LiteralPath $_ }
if ($presentPaths) {
  $presentPaths
  throw "OpenAI-compatible runtime artifacts are present."
}
$manifest = Get-Content -LiteralPath candidate-manifest.json -Raw | ConvertFrom-Json
if ($manifest.modelProviderProfile -ne "model-gateway-only") {
  throw "Unexpected model provider profile: $($manifest.modelProviderProfile)"
}
"PASS: no OpenAI-compatible runtime artifacts"
```

`dist/providers/openai-compatible/registration.js` 允许保留，它是 capability 边界声明；gateway-only composition 不会注入该 registration。

打包步骤（`pack-local-runtime.mjs`）：

1. 按构建模式选择默认或 gateway-only TypeScript projects，重建 workspace dist
2. `with-frontend` profile 额外重建 agent-web 产物并组装 `@nextagent/agent-web` artifact
3. 校验 release E2E gate（`verifyReleaseE2EGate`）
4. 生成 `default-system.yaml` 样例，并保留包内 `@nextagent/agent-core` builtin `default-agent`；`pack:release` 额外在包根生成 `agents/default-agent/agent.yaml` 用于能力验证
5. 生成 package archive（`createPackageArchive`）

TESTClaw 测试用二进制包：

```bash
npm run pack:testclaw    # scripts/pack-testclaw.mjs
```

### 发布资格（release qualification）

```bash
npm run release:qualify -- --candidate <candidate-root> --scope <scope-file>
```

入口 `scripts/release-qualify.mjs`，调用 `packages/agent-app/dist/release/run-release-qualification.js`。结果状态：

- `QUALIFIED` — 全部门禁通过
- `QUALIFIED_WITH_DECLARED_DEGRADATIONS` — 通过但有声明降级
- `BLOCKED` — 任一硬门禁失败（exit code 1）

门禁维度（`packages/agent-app/src/release/run-release-qualification.ts`）：

| 维度 | npm script |
|------|------------|
| contract | `test:contract` |
| architecture | `lint:architecture` |
| security | `test:gate:security`（release 配置） |
| resilience | `test:gate:resilience`（release 配置） |
| release-package | `test:e2e:release-package` |
| product-journey | `test:e2e:product-journey` |
| capacity | `test:gate:capacity` |
| health proof | release-package 命令产出 |
| smoke | product-journey 兼作 smoke |

contract / architecture / security / resilience 为硬门禁，任一未 PASSED 即 `BLOCKED`。

### OS 支持

打包目标（`resolvePackageTarget`）：

- `win32-x64`
- `linux-x64`

其它目标抛 `Unsupported local runtime package target`。

## 启动命令

开发源码模式（仓库根）：

```bash
# 启动 TypeScript watch、后端服务和前端 Vite 开发服务器
npm run dev:watch          # scripts/dev-watch.mjs

# 仅启动前端 Vite；后端需要单独运行
cd frontend/agent-web && npm run dev
```

`npm run dev:watch` 启动后提供以下前端入口：

- Local：`http://127.0.0.1:5173/`
- Immersive：`http://127.0.0.1:5173/immersive/`
- Collaborative：`http://127.0.0.1:5173/collaborative/`

完整构建和本地集成运行（仓库根）：

```bash
# 安装依赖、构建后端和前端、组装并验证前端 artifact，
# 最后启动带前端静态资源的 with-frontend 服务入口
npm run dev:fullstack      # scripts/dev-fullstack.mjs
```

源码模式使用自定义 `application.yaml` 时，通过绝对路径指定配置并在修改后重启：

```bash
NEXTAGENT_APPLICATION_CONFIG=/absolute/path/application.yaml npm run dev:fullstack
```

打包后运行（`tests/TESTClaw` 验证路径）：

```bash
cd <package-root>
node bin/nextagent-self-check     # 配置校验
node bin/nextagent-start          # 启动服务
node bin/nextagent-stop           # 停止服务
```

## 部署检查清单

- [ ] `config/default-system.yaml` 或部署提供的 `application.yaml` 存在且 YAML 可被配置入口解析
- [ ] 若覆盖 `nextAgent.system.capability-result-presentation`，确认级别仅为 `STATUS_ONLY` / `SUMMARY` / `DETAIL`，`capability-id` 使用大小写准确的最终 Tool ID，且服务已在修改后重启
- [ ] 至少一个 `modelProfiles[].models[]` 子项通过校验，且对应 provider access 的 `credentialRef` 可解析（`env:` / `file:`）
- [ ] `hostedAgent.activeAgentId` 能在 `agents/{agentId}/agent.yaml` 定制目录或包内 builtin Agent 资源中找到
- [ ] SQLite 数据目录（默认 `<workspaceRoot>/data/system/`）有写权限，且已配置备份策略
- [ ] 端口 3000 未被占用（或 `channel.port` 已调整）
- [ ] （可选）前端构建产物已组装（`with-frontend` profile）
- [ ] （可选）环境变量 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL_NAME` 已设置
- [ ] （生产）进程守护（systemd / NSSM）与反向代理 TLS 已配置，SSE/WS 代理参数已验证
- [ ] （升级场景）`data/system/` 已备份，目标版本发布说明已确认

> **外部部署方验证**：上述 `npm run release:qualify` 等源码级门禁只适用于仓库内发布者。使用运行包交付的部署方，验证路径是解包目录下的 `node bin/nextagent-self-check` + 启动后 `GET /api/v1/health/deep` + 一轮 curl 主链路验证（见[快速上手](./01-quickstart.md)）。

## 运行时固定边界（当前不可配置）

以下行为在当前版本**没有配置面**，交付容量规划和排障时必须按固定值对待：

| 边界 | 固定值 | 影响 |
|------|--------|------|
| run 并发上限 | **无上限** | 主路径请求并发不受限（同 session 内仍串行）；多用户容量治理依赖前置网关限流 |
| session 总量 | **无上限** | 会话数据只增不减，长周期运行需配合定期清理与磁盘预算 |
| SSE / WebSocket 心跳 | **无心跳** | 服务器不主动发 ping；经反向代理/LB 部署时，代理 idle timeout 若短于事件间隔会静默掐断连接——反代配置需关闭 idle timeout 或依赖客户端重连 |
| 流 backpressure 超时 | 15 秒 | 客户端持续不读流时服务端放弃等待 |
| 输入文本长度 | 32768 字符 | 超出返回 400 |
| 单请求附件条数 | 10 个 | JSON 提交路径 |
| multipart 请求体上限 | 16 MiB | 更大文件走 staged upload（route 层单文件上限 500 MiB，系统级默认 10 文件 / 10 MB / `*.md`，见 `chatUploadFileConfig`） |
| 上传 / 下载并发 | 各 4，等待 30 秒超时 | 附件运行时内部限流 |
| sandbox 命令超时上限 | 10 分钟 | `Bash` / `Python` 命令硬上限 |
| sandbox 命令输出 | stdout / stderr 各 1 MB 截断 | 超出部分丢弃 |
| trace 采样 | 无（全量上报） | `observability.tracing` 只有开关与端点，没有采样率 |
| metrics 导出 | 60 秒周期 / 10 秒超时 / 指标基数上限 200 | 超基数即丢数据 |
| HTTP keepAlive / request 超时 | 72 秒 / 无限制 | requestTimeout=0 表示慢客户端可长期占用连接 |

这些边界多数属于系统能力缺口而非文档缺失；若交付场景需要其中某项可配（如并发上限、流心跳），请通过交付方向平台团队提出需求，涉及主路径行为需先走 OpenSpec change。

## 维护限制

- `nextAgent.memory.aging` 维护任务按 `schedule` 运行，`batchLimit` 控制单批规模。
- `nextAgent.memory.extraction` 的 `crossSessionSchedule` 控制跨会话提取周期。
- sandbox `allowedExecutables` / `deniedExecutables` 维护可执行策略，`allowedApis` 限制 local 模式可识别的 HTTP(S) 目标；`clipc` 由 `sandbox.clipcExecutableDirectoryEnv`（默认 `CLIP_HOME`）解析。
- `observability.logging.diagnosticDetail` 只控制已脱敏诊断细节（`normal` / `debug`）；安全脱敏没有 `off` 开关。日志 level、console 和 file 也只在该对象下配置。

## 常见部署问题

### 启动失败：模型 API Key 未配置

`credentialRef` 必须使用 `env:` 或 `file:` 引用。明文 key 会触发 "App configuration is blocked before ready"。设置环境变量后重启，检查日志中的 credential resolution 信息。

### Agent 无法加载

检查 `hostedAgent.activeAgentId` 是否存在对应 `agents/{agentId}/agent.yaml`；如果未提供本地定制，确认该 ID 是包内 builtin Agent。

### 端口 3000 被占用

调整 `channel.port`，或释放占用进程。不要回退到旧的 8080 端口假设。

### 能力不可用

1. 检查 `agent.yaml` 的 `capabilityBindings` 是否绑定该能力。
2. 检查 capability source（builtin / local / skillhub / agent-owned）是否加载。
3. 检查 sandbox deny-by-default 是否拦截。

## 相关资源

- [Agent 配置参考](./03-agent-configuration.md)
- [快速上手](./01-quickstart.md)
- [测试与调试](./11-testing-debugging.md) — pack:testclaw / release:qualify 的测试侧
- 发布说明：`docs/release/NextAgent-v2.0-release.md`
- 相关 specs：`local-runtime-package/`、`local-runtime-release/`、`local-runtime-recovery/`、`fullstack-packaging-boundary/`、`sandbox-runtime/`、`app-config-schema/`、`memory-configuration/`
