# 对外二次开发指南（总入口）

这一篇面向**在 NextAgent 源码仓库之外**做二次开发的客户/合作伙伴开发者：你拿到的是运行包、插件 SDK 分发或源码授权，而不是（或不只是）本仓库的 clone。仓库内开发者的路径见 [快速上手](./01-quickstart.md)。

## 你拿到的可能是什么形态

NextAgent 当前没有公开发布到 npm registry（所有 `@nextagent/*` 包均为私有分发），对外交付按你与交付方签订的协议取以下形态之一：

| 形态 | 内容 | 适合的二开深度 |
|------|------|--------------|
| **本地运行包** | `pack:release` / `pack:backend` 产出的 zip（win32-x64 / linux-x64），含 `bin/nextagent-start` 等启动脚本 | Agent 配置、Prompt、Skill、配置级能力接入 |
| **运行包 + 插件 SDK** | 运行包 + `@nextagent/agent-plugin-sdk` 分发（tarball 或私服） | 上述全部 + 自定义 Tool / Hook / Policy / 插件 |
| **源码授权** | 完整 monorepo 访问权限 | 上述全部 + composition 层 / channel / gateway 定制 |

**先向你的交付方确认**：拿到的是哪种形态、插件 SDK 从哪里获取（私服坐标或 tarball）、NextAgent 版本号（见运行包内 `package.json` 的 `version`）。本文其余部分假设你至少有运行包。

## 环境要求

| 项 | 要求 |
|----|------|
| Node.js | 精确 `22.22.0`（运行包与 SDK 同源要求；使用 nvm/nvs 固定版本） |
| 操作系统 | `win32-x64` 或 `linux-x64` |
| 数据库 | 无外部依赖（Node 内置 `node:sqlite`） |
| 模型服务 | 任一 OpenAI-compatible 端点 + API key（或交付方 model-gateway） |
| 插件开发 | TypeScript + esbuild（scaffold 会生成配置） |

## 二开分层与各自入口

按改动深度从低到高，外部开发者可用的四层（与 [业务二次开发指南](./18-business-secondary-development.md) 的风险排序一致）：

### 第 1 层：Agent 配置 + Prompt 模板

不写代码。在部署目录下放自定义 `agent.yaml` 与 `prompts/`，通过 `application.yaml` 的 `hostedAgent.activeAgentId` 切换。

- 目录与字段：[Agent 配置参考](./03-agent-configuration.md)
- Prompt 写法：[提示工程](./06-prompt-engineering.md)
- 落地路径与交付 checklist：[业务二次开发指南](./18-business-secondary-development.md)

### 第 2 层：本地 Skill

不写编译代码。`SKILL.md`（frontmatter + 流程正文）放入 `skills/` 目录，`agent.yaml.capabilityBindings` 绑定后生效。

- 编写与绑定：[Skill 与 Tool 开发](./04-skill-tool-development.md) 的 Skill 章节
- Skill 驱动 API（声明式接口调用）：[Tool 规范](./24-tool-specification.md) 的"路径二"

### 第 3 层：插件（自定义 Tool / Hook / Policy / Provider）

外部开发者写代码的**唯一受支持路径**。用 `@nextagent/agent-plugin-sdk` 编写，esbuild 打成单文件 bundle，`plugin.json` 声明，system config `nextAgent.system.plugins[]` 加载，再在 Agent 侧绑定/启用。

```bash
# 脚手架（SDK 分发内含 CLI）
npx create-nextagent-plugin my-plugin
```

- 完整流程（scaffold → bundle → 加载 → 激活）：[Agent Plugin 开发指南](./19-agent-plugins.md)
- Tool 编写规范：[Tool 规范](./24-tool-specification.md)
- Hook 编写（插件内从 `agent-plugin-sdk` 导入）：[Lifecycle Hook 开发指南](./17-lifecycle-hooks.md)、[细化开发指南](./23-lifecycle-hook-authoring-details.md)
- 单测：`@nextagent/agent-test-kit` 的 `createPluginTestHarness`

> 边界提醒：插件不能改 runtime 状态机、terminal commit、stream 语义、gateway 持久化模型，不能绕过 sandbox / capability governance / owner scope / agent scope。这类需求属于源码授权形态，且必须先走 OpenSpec change（由交付方评估）。

### 第 4 层：外部系统集成（不改 NextAgent 本体）

把 NextAgent 当作服务对接：调用 Web/Task/IR API、消费 SSE/WebSocket 事件流，或在外仓开发自定义 channel / remote gateway provider。

- API 对接 checklist：[外部系统集成指南](./27-integration-checklist.md)
- 事件协议：[流式事件](./09-streaming-events.md)、[API 参考](./10-api-reference.md)
- 外仓自定义 channel：[Channel 开发指南](./21-channel-development.md)
- 外仓 remote gateway provider：[Remote Gateway 开发指南](./20-remote-gateway-development.md)

## 配置根目录（configRoot）速查

外部部署最常困惑的"我的文件放哪"：

| 场景 | configRoot | 自定义 Agent / Skill 位置 |
|------|-----------|--------------------------|
| 默认（未指定配置文件） | `NEXTAGENT_CONFIG_DIR`，否则进程工作目录 | 解析基准目录下的 `agents/`、`skills/`（见下方说明） |
| 指定 `NEXTAGENT_APPLICATION_CONFIG=/path/application.yaml` | 该文件所在目录 | 同上，相对该目录 |

> **资源目录解析基准**：`nextAgent.paths`（`agents` / `skills` / `workspaces` / `logs`）按 configRoot 解析；当 configRoot 目录名恰为 `config` 时（运行包典型布局），基准上移到其父目录。即源码模式下是 `<repo>/agents/`、`<repo>/skills/`；运行包模式下是解包目录下的 `agents/`、`skills/`（与 `config/` 同级）。

配置合并顺序：内置 `default-system.yaml`（运行包内）→ 你的 `application.yaml` overlay。凭据只接受 `env:VAR` / `file:path` 引用，不接受明文。

## 交付与运维

- 启动 / 自检 / 停止：`node bin/nextagent-self-check`、`node bin/nextagent-start`、`node bin/nextagent-stop`
- 数据备份、升级回滚、进程守护、TLS 反代：[部署说明](./12-deployment.md) 的"数据存储"与部署检查清单章节
- 排障：[常见问题排查](./14-troubleshooting-faq.md)
- 监控接入：[Observability Metrics](./22-observability-metrics.md)、[OTEL Trace 上报](./25-otel-trace-reporting.md)

## 版本与支持

- **版本识别**：运行包根 `package.json` 的 `version`；每次升级前阅读目标版本发布说明（`docs/release/`，向交付方索取对应版本）中的 Breaking / Behavioral Changes 与升级指南。
- **兼容性承诺**：`agent.yaml`、`SKILL.md`、prompt manifest、Web/Task/IR API、SSE/WS 事件协议、插件 `plugin.json`（`apiVersion` 1.0/1.1/1.2）是对外稳定面；`packages/*/src/` 内部路径与内部测试基建不承诺稳定。
- **升级工具**：模型资产（system config / Agent / Prompt / Skill metadata）离线迁移见[模型资产迁移工具](../../migration/model-authoring-v2/README.md)。
- **支持渠道**：issue 跟踪、SLA、安全漏洞上报与升级流程，以你与交付方签订的协议为准；仓库内 `docs/` 面向源码开发者。

## 最短路径（拿不准就从这里开始）

1. 解包运行包 → `node bin/nextagent-self-check` → `node bin/nextagent-start`
2. curl 跑通 `sessions → requests → stream`（[快速上手](./01-quickstart.md) 第五步）
3. 复制一份内置 Agent 到 `<configRoot>/agents/`，改 prompt，切 `activeAgentId`
4. 需要业务流程 → 写 Skill；需要新执行能力 → 写插件 Tool；需要审计/脱敏/阻断 → 写插件 Hook
5. 上线前过一遍 [业务二次开发指南](./18-business-secondary-development.md) 的最小交付 checklist
