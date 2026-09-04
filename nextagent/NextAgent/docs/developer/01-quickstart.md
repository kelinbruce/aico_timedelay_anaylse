# 快速上手

这一篇带你从零搭好开发环境、理解 NextAgent 的依赖与文件体系，启动后端并跑通第一个网络智能体。

## 读者

假设你熟悉 Node.js 22+ 和 npm，了解 AI Agent 的基本概念（提示词、模型调用、工具调用），想基于 NextAgent 这个 TypeScript 后端框架快速搭一个能跑的网络智能体。

> **不在本仓库内开发？** 如果你拿到的是 runtime 运行包或插件 SDK 分发而非完整源码，请先读 [对外二次开发指南](./26-external-development-guide.md)，再回到本篇。

## 依赖清单

### 工具链依赖（必装）

| 工具 | 版本 | 用途 | 说明 |
|------|------|------|------|
| Node.js | 精确 `22.22.0` | 编译和运行后端 | 根 `package.json` 的 `engines.node` 为精确 pin，不是 `>=` 区间；建议用 nvm/nvs 固定 |
| npm | 与 Node.js 22 配套版本 | 安装依赖、执行 scripts | 随 Node.js 附带 |
| Git | 任意现代版本 | 拉取仓库 | 仅源码模式需要 |
| IDE | VS Code / WebStorm | TypeScript strict ESM 开发 | 可选但推荐 |

操作系统：`win32-x64` 和 `linux-x64`。前端 `frontend/agent-web` 开发的 Node.js 版本要求与后端一致。

### 运行时依赖（安装时 npm 自动拉取，无需手动准备）

- **后端**：全部来自公共 npm registry（Fastify、Pino、TypeBox/Ajv、Kysely、`ai` SDK 等），无私有 registry、无 native 编译模块。完整清单见[开源组件清单](../NextAgent%20开源组件清单.md)。
- **前端**（可选联调）：React、antd、zustand、Vite 等，在 `frontend/agent-web` 单独安装。
- **插件 SDK**（可选二开）：`@nextagent/agent-plugin-sdk`，私有分发（tarball 或交付方私服），见 [Agent Plugin 开发指南](./19-agent-plugins.md)。

### 服务依赖

| 服务 | 是否必需 | 说明 |
|------|---------|------|
| 模型服务 | **必需** | 任一 OpenAI-compatible 端点（MiniMax、智谱等）+ API key；或交付方的 model-gateway |
| 数据库 | 无 | 持久化使用 Node.js 内置的 `node:sqlite`，零安装 |
| 消息队列 / 缓存 | 无 | 单机部署不需要任何中间件 |

启动前需要向你的模型服务方获取 API key，并确认 `baseUrl` 与 `modelId`。

## 文件体系

理解 NextAgent 的关键是分清**框架源码树**与**开发者配置根目录（configRoot）**两套东西——前者是平台本体，后者是你的业务资产存放地。

### 两棵树

```text
<源码仓库>                          <configRoot>（开发者配置根目录）
NextAgent/                          my-agent-project/
├── packages/          26 个后端     ├── application.yaml      开发者配置覆盖层
│   └── agent-app/     workspace     ├── agents/
├── frontend/                        │   └── <agentId>/
│   └── agent-web/     前端源码      │       ├── agent.yaml
├── packages/agent-app/config/       │       └── prompts/
│   └── default-system.yaml  内置默认│           └── SYSTEM_PROMPT/
├── packages/agent-core/src/         │               └── template.yaml
│   └── builtin-agents/     内置Agent│ └── skills/
│       └── default-agent/           │       └── <skillId>/
│           └── agent.yaml           │           └── SKILL.md
├── scripts/            构建打包脚本  └── plugins/               插件 artifact（若使用）
├── migration/          离线升级工具      ↑ 运行期还会生成（见下"运行期产物"）
├── tests/              跨包测试
├── openspec/           权威规格
└── docs/               文档
```

- **框架源码树**：`packages/agent-core/src/builtin-agents/` 下的内置 Agent（`default-agent`、`network-explorer`）和 `packages/agent-app/config/default-system.yaml` 内置默认配置是 framework-owned 资产，**只作参考，不要把自定义 Agent 放进去**（交付升级时会被覆盖）。
- **configRoot**：你的 `application.yaml`、自定义 `agents/`、`skills/`、`plugins/` 都放这里。源码模式下默认就是仓库根目录，运行包模式下是解包目录。

### configRoot 解析规则

| 场景 | configRoot |
|------|-----------|
| 未指定配置文件（默认） | `NEXTAGENT_CONFIG_DIR` 环境变量；未设置时为进程工作目录 |
| 设置 `NEXTAGENT_APPLICATION_CONFIG=/path/application.yaml` | 该文件所在目录 |

### 配置合并顺序

内置 `default-system.yaml`（框架提供）→ 你的 `application.yaml`（overlay 覆盖同名键）。你只需要在 `application.yaml` 里写差异项，不必复制整份默认配置。凭据只接受 `env:VAR` / `file:path` 引用，明文会被配置校验拒绝。

### 运行期产物（自动生成，勿手工编辑）

`application.yaml` 顶层的 `paths` 配置控制这些目录；相对路径按 configRoot 解析，但当 configRoot 目录名恰为 `config` 时（运行包布局），解析基准上移到其父目录：

| 配置项 | 默认值 | 内容 |
|--------|--------|------|
| `paths.workspaceRoot` | `workspaces` | 工作区根；其下 `execution/` 为 run 执行文件区、`shared-data/` 为共享数据 |
| `paths.logDirectory` | `logs` | 运行日志（`nextagent-operational.log.<seq>.jsonl`）与指标（`nextagent-metrics.ndjson`） |
| `paths.skillRoot` | `skills` | 本地 Skill 目录 |
| `paths.agentRoot` | `agents` | 自定义 Agent 目录 |

数据库文件由 `workspaceRoot` 派生，固定在 `data/system/` 下：`nextagent.sqlite`（主库）、`working-memory.sqlite`、`long-term-memory.sqlite`。备份与升级注意事项见[部署说明](./12-deployment.md)。

### 仓库结构速览（26 个 package）

```text
packages/
├── agent-app/                  # 唯一 composition root，应用入口与装配
├── agent-app-frontend-hosting/ # 前端静态托管边界
├── agent-attachment-runtime/   # 附件可信校验、暂存、cleanup
├── agent-capability/           # Capability 生命周期（Tool/Skill/Agent）
├── agent-channel-common/       # channel 共享 stream envelope / projection
├── agent-channel-task/         # 机机 Task channel（callback 协议）
├── agent-channel-web/          # HTTP / SSE / WebSocket transport + DTO projection
├── agent-channel-web-auth-local/ # 本地配置认证
├── agent-common/               # 跨包 shared vocabulary
├── agent-contracts/            # 跨包 public contracts
├── agent-core/                 # Agent orchestration + routing（含 builtin-agents）
├── agent-context-engine/       # context assembly + prompt shaping
├── agent-dev-workbench/        # 开发工作台工具
├── agent-local-file-roll/      # 本地日志滚动
├── agent-log/                  # 日志基础设施
├── agent-memory/               # 长期记忆、检索、提取、aging
├── agent-model/                # provider SDK 隔离、流式归一化
├── agent-observability/        # structured logging、trace/metric、redaction
├── agent-platform-gateway-local/   # SQLite 本地持久化
├── agent-platform-gateway-remote/  # 远程平台服务边界
├── agent-plugin-sdk/           # Agent 插件 authoring SDK（外部二开正路）
├── agent-remote-deployment/    # 远程部署支撑
├── agent-runtime/              # request lifecycle + timeline + checkpoint + terminal commit
├── agent-session/              # session、message、history read model
├── agent-test-kit/             # 测试工具包
└── agent-workflow/             # workflow engine / nodes 最小边界
```

分层职责与请求链路见 [架构概览](./02-architecture.md)。智能体开发的关注重点：configRoot 下的 `application.yaml`、`agents/`、`skills/`，以及框架提供的 Tool/Skill/Agent authoring contract。

## 第一步：安装并启动

```bash
# 1. 克隆并安装（源码模式）
git clone <仓库地址> && cd NextAgent
npm install

# 2. 准备模型凭据（任选一种）
export OPENAI_API_KEY=sk-xxxxx
export OPENAI_BASE_URL=https://api.example.com/v1
export OPENAI_MODEL_NAME=your-model-id
#   或：在 <configRoot>/application.yaml 显式配置 modelProfiles（见第二步）

# 3. 启动开发模式（TypeScript watch + 后端 + 前端联调）
npm run dev:watch
```

`npm run dev:watch` 由 `scripts/dev-watch.mjs` 驱动：监听根 `tsconfig.json` 编译并自动重启后端入口，同时通过 `frontend/agent-web` 的 vite 启动前端并把 API 代理到后端；就绪检查命中 `GET /api/v1/runtime/bootstrap`。

默认地址：后端 `http://127.0.0.1:3000`，前端 `http://127.0.0.1:5173`（含 `/immersive/`、`/collaborative/` 模式入口）。

其他启动方式：

- **全栈构建产物**（先构建再起服务，非监听）：`npm run dev:fullstack`——依次 `npm install` → `npm run build` → 前端构建 → 组装 `@nextagent/agent-web` artifact → 运行 `with-frontend.js` 入口。会自动处理前端依赖安装。
- **仅安装前端依赖**（单独联调前端时）：`cd frontend/agent-web && npm install`；前端 Mock、构建、测试见[前端开发指南](../frontend/development.md)。
- **仅构建不启动**：`npm run build`（含 typecheck、workspace 重建、内置 skill 资产复制；**不含** `frontend/agent-web` 的 TS/Vite 构建，前端需在其目录下单独 `npm run build`）。
- **使用自定义配置启动**：`NEXTAGENT_APPLICATION_CONFIG=/absolute/path/application.yaml npm run dev:fullstack`（修改配置后需重启）。

## 第二步：配置模型

在 `<configRoot>/application.yaml` 的 `modelProfiles[]` 中配置至少一个 provider 及其模型（与内置 `default-system.yaml` 合并时同名键覆盖）：

```yaml
modelProfiles:
  - providerId: openai-compatible
    baseUrl: https://api.minimaxi.com/v1
    credentialRef: env:OPENAI_API_KEY
    models:
      - modelId: MiniMax-M2.7-highspeed
        contextWindowTokens: 128000
        fallbackEligible: false
        temperature: 0.2
        maxOutputTokens: 2048
        topP: 1
        timeoutMs: 30000
```

| 字段 | 说明 |
|------|------|
| `providerId` | provider registration identity；当前为 `openai-compatible` 或 `model-gateway` |
| `baseUrl` | `openai-compatible` 必填；`model-gateway` 禁止 |
| `credentialRef` | provider 级凭据引用，支持 `env:VAR`、`file:path`（明文 `direct:` 会被校验拒绝） |
| `models` | 该 provider 下的非空模型数组 |
| `modelId` | 全局唯一 canonical model identity，同时传给 provider 并被 Agent/Prompt/Skill 引用 |
| `contextWindowTokens` | `openai-compatible` 必填；`model-gateway` 由 Gateway model-information 查询 |
| `fallbackEligible` | 是否可作为 cross-model fallback 候选 |
| inference fields | 可选 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` |
| `providerOptions` | 可选 provider 扩展对象；不得重复 canonical 顶层或 identity/access/transport 字段 |
| `timeoutMs` / `maxRetries` | 单次 logical invocation 的总超时与同模型最大重试次数 |

## 第三步：理解 Agent 定义

Agent 通过 `<configRoot>/agents/{agentId}/agent.yaml` 定义（内置参考实现位于 `packages/agent-core/src/builtin-agents/`）。`agent.yaml` 使用 YAML（JSON 是兼容子集，新文件建议直接 YAML）。完整字段手册见 [Agent 配置参考](./03-agent-configuration.md)。

以内置 `default-agent` 为例（节选）：

```yaml
agentId: default-agent
agentVersion: v1
displayName: NextAgent telecom agent
modelIds:
  - MiniMax-M2.7-highspeed
defaultModelId: MiniMax-M2.7-highspeed
capabilityBindings:
  - capabilityId: network-explorer
    capabilityType: AGENT
    providerId: builtin-agents
    enabled: true
  - capabilityId: search_memory
    capabilityType: TOOL
    providerId: memory-tools
    enabled: true
runtimeSettings:
  defaultLanguage: zh-CN
  maxTurns: 50
  maxToolCallsPerTurn: 30
  requestTimeoutMs: 1800000
```

- `agentId` / `agentVersion`：唯一标识与版本，`RequestRun` acceptance 时固化。
- `modelIds`：允许使用的 canonical model ID 集合，引用 `modelProfiles[].models[].modelId`；省略时继承系统已校验模型清单。
- `capabilityBindings`：显式启用的能力（`TOOL` / `SKILL` / `AGENT`）。**注册 ≠ 绑定**：catalog 能发现不等于 Agent 有权调用。内置 Tool ID 为首字母大写（`Read` / `Grep` / `Rag`...），memory tools 为小写下划线（`search_memory`...）。
- `runtimeSettings`：`defaultLanguage` / `maxTurns` / `maxToolCallsPerTurn` / `maxContextMessages` / `requestTimeoutMs`。
- 提示模板：放同目录 `prompts/{PURPOSE}/template.yaml`，装配期自动注册，`agent.yaml` 不维护 prompt id allowlist。见[提示工程](./06-prompt-engineering.md)。

## 第四步：选择活跃 Agent

在 `application.yaml` 中指定当前托管的 Agent：

```yaml
hostedAgent:
  activeAgentId: default-agent
```

`default-agent` 是默认值。切换自定义 Agent：把 Agent 目录放到 `<configRoot>/agents/{agentId}/`，再把这里改成对应 `agentId`，重启生效。

## 第五步：验证

### 认证说明

默认 `auth.mode="local"` 且 `auth.localAuth.enabled=false`，本地开发可直接调用 API 无需登录。若启用 `localAuth.enabled: true`，先 `POST /api/v1/auth/local/login` 获取 `nextagent_local_auth` HttpOnly Cookie 再携带调用。完整 API 字段见 [agent-web API 清单](../apis/agent-web-api-list.md)。

### 使用 curl 测试

```bash
# 1. 创建会话
curl -X POST http://127.0.0.1:3000/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"locale":"zh-CN"}'
# → {"sessionId":"sess_...","displayTitle":"...","lastActivityAt":...}

# 2. 提交请求（idempotencyKey 必填）
curl -X POST http://127.0.0.1:3000/api/v1/sessions/sess_xxx/requests \
  -H "Content-Type: application/json" \
  -d '{"inputText":"你好，请介绍一下你自己","idempotencyKey":"idem-1","locale":"zh-CN"}'
# → {"sessionId":"...","requestId":"req_...","runId":"run_...","attempt":1}

# 3. 查看流式响应（SSE）
curl -N http://127.0.0.1:3000/api/v1/sessions/sess_xxx/stream?requestId=req_xxx
```

只要能看到 `REQUEST_ACCEPTED` 和一个 terminal 事件（`REQUEST_COMPLETED` / `REQUEST_FAILED`），主链路即通。事件协议细节见[流式事件](./09-streaming-events.md)。

### 使用 Web UI 测试

启动 `npm run dev:watch` 后打开 `http://127.0.0.1:5173`，创建会话并发送消息即可。

## 已有项目升级

迁移工具不包含在 runtime 运行包中。采用本版 runtime 前，从目标 NextAgent release/tag 的源码复制 `migration/model-authoring-v2/migrate.py` 到任意本地工具目录，以 `--root` 指向开发者项目执行离线 dry-run：

```bash
python /path/to/nextagent-tools/migrate.py --root /path/to/agent-project
```

确认计划后同一脚本加 `--write`。工具统一转换 system config、Agent、Prompt Template 和 Skill model metadata，并在 `<root>/.nextagent-migration/model-authoring-v2/` 建立备份；完整说明见[迁移工具](../../migration/model-authoring-v2/README.md)。runtime 不接受旧模型字段，也不会启动时自动迁移。

## 日常验证命令

```bash
npm run build              # typecheck + workspace 编译 + 内置 skill 资产复制
npm test                   # vitest run
npm run test:contract      # 契约测试
npm run lint:architecture  # dependency-cruiser + manifest policy + 架构 vitest 测试
npm run lint:openspec      # openspec validate --all --strict
npm run lint               # 串联 architecture + openspec
```

详见[测试与调试](./11-testing-debugging.md)（含外部运行包用户的验证路径说明）。

## 下一步

1. [架构概览](./02-architecture.md) — 理解 26 个 package 的分层与请求链路
2. [Agent 配置参考](./03-agent-configuration.md) — 全面掌握 `agent.yaml` 字段
3. [Skill 与 Tool 开发](./04-skill-tool-development.md) — 编写第一个自定义能力
4. [提示工程](./06-prompt-engineering.md) — 定制 Agent 的对话风格和领域知识
5. [对外二次开发指南](./26-external-development-guide.md) — 仓库外二开者从这里进入
