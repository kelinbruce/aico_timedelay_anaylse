# 能力扩展

这一篇讲 NextAgent 提供哪些能力扩展方式、各自适合什么场景、怎么选。NextAgent 的扩展遵循契约先行：`agent-contracts` 先冻结公共契约，Tool、Skill、Agent 三类能力共用同一套 provider / descriptor / invocation / result 协议，没有各自平行的协议。

## 扩展机制总览

NextAgent 的扩展面按风险从低到高排列：

```
低风险 ←──────────────────────────────────────────→ 高风险
Config  →  Prompt Template  →  Capability Source  →  Lifecycle Hook  →  Kernel / Composition Root
```

智能体开发者应优先使用低风险扩展，只有当低层无法表达需求时才向高层推进。

## 扩展选择指南

| 需求                               | 应选机制                                               | 不应选机制                |
| ---------------------------------- | ------------------------------------------------------ | ------------------------- |
| 新增网络诊断动作或领域流程         | Capability Source（Skill/Tool）                        | 修改 Runtime 状态机       |
| 调整回答风格、领域术语、双语规则   | Prompt Template                                        | 修改 Model Provider       |
| 不同 purpose 选不同模板            | Prompt Template Assembly（purpose-aware）              | 在请求路径硬编码选择      |
| 调整历史/附件裁剪策略              | Context Engine 策略 / Query Policy                     | 在 Session 查询中嵌入逻辑 |
| 增加审计、参数校验、输出脱敏       | Lifecycle Hook                                         | 修改终端事件逻辑          |
| 接入远程 Skill 注册中心或 MCP 服务 | Capability Provider 配置（`skill-hub` / `mcp-server`） | 在 Core 中直接 HTTP 调用  |
| 新增专家 Agent（独立上下文分析）   | Agent capability（subagent）                           | 修改 Runtime              |
| 修改终态结果提交规则               | **Kernel change**（需改 specs）                        | Hook 绕过                 |

## 扩展输入面

NextAgent 当前实际存在的二开输入面如下。旧 ADNClaw 的 Java SPI / Plugin 接口已不存在；扩展全部以 TypeScript 实现，通过 `agent-capability` 的 source / catalog / executor 工厂接入。

### 1. Config（配置）

通过开发者 `application.yaml` 与 `agent.yaml` 的 `runtimeSettings` / `capabilityBindings` 表达。两者都使用 YAML，JSON 也是兼容子集。

**Agent 级配置**（`agent.yaml`）：

```json
{
  "agentId": "default-agent",
  "agentVersion": "v1",
  "modelIds": ["MiniMax-M2.7-highspeed"],
  "defaultModelId": "MiniMax-M2.7-highspeed",
  "capabilityBindings": [
    { "capabilityId": "network-explorer", "capabilityType": "AGENT", "providerId": "builtin-agents", "enabled": true },
    { "capabilityId": "search_memory", "capabilityType": "TOOL", "providerId": "memory-tools", "enabled": true }
  ],
  "runtimeSettings": {
    "defaultLanguage": "zh-CN",
    "maxTurns": 50,
    "maxToolCallsPerTurn": 30,
    "requestTimeoutMs": 1800000
  }
}
```

**Capability Provider 配置**（`capability-source-configuration` spec）：用户通过 `nextAgent.system.capability-providers` 配置路径声明外部 capability source（startup-only）。每个 entry 用直观短字段名 `id` / `type` / `url` / `credential` / `installDir` / `adapter` / `config`，`type` 是封闭 kebab-case 集合：

| 用户 `type`      | `providerKind`   | `discoveryMode` | 必需字段                      |
| ---------------- | ---------------- | --------------- | ----------------------------- |
| `mcp-server`     | `MCP_SERVER`     | `SEARCH`        | `url`                         |
| `agent-registry` | `AGENT_REGISTRY` | `EAGER`         | `url`                         |
| `skill-hub`      | `SKILL_HUB`      | `SEARCH`        | `url` + `installDir`          |
| `custom`         | `CUSTOM`         | `EAGER`         | `adapter`（→ `providerType`） |

resolver 在 startup 把每条 entry 映射为 `CapabilityProviderConfig`，输出单一 `ResolvedCapabilityProviders` 供 app composition 消费。请求路径不会重新校验用户配置。`BUNDLED` / `builtin` 等值会被 `UNSUPPORTED_PROVIDER_TYPE` 拒绝——builtin provider 由 `agent-capability` 内部创建，用户配置不得控制。

`normalizeCapabilityProviderConfigs`（`packages/agent-capability/src/provider-config.ts`）会拒绝：空 `providerId`、`BUNDLED` kind、重复 `providerId`（含保留 id `builtin-tools`/`builtin-skills`/`builtin-agents`/`local-agents`/`local-subagents`/`local-skills-system`/`local-skills-agent-owned`/`memory-tools`）、非法 `discoveryMode`、各 kind 的 options 校验失败、非引用形式的 `credentialRef`（必须 `env:` 或 `file:` 前缀）。

### 2. Prompt Template（提示模板）

Agent package 的 `prompts/` 目录在同步装配期注册为 Agent-scoped frozen template facts。模板用 `nextagent.prompt-template/v1` YAML manifest 格式（`template.yaml` + 段落 `.md` 文件）。`SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 是 framework well-known purpose，开发者也可定义自定义 purpose。详见 [提示工程](./06-prompt-engineering.md)。

### 3. Capability Source（能力来源）

Capability source 是 NextAgent 当前的核心代码型扩展面。一个 source = 一个 `CapabilityProvider` 身份 + 一个 `CapabilityDiscovery` 适配器（+ 可选 `SkillSourceDiscovery` / executor）。`agent-capability` 提供单一 `CapabilityDiscoveryFactory` 按 `providerKind`（`CUSTOM` 还按 `providerType`）分发，不存在按注册顺序选择多工厂。

当前 source 类型：

| Source                  | `providerId`               | `providerKind`                  | `discoveryMode` | 说明                                                                                      |
| ----------------------- | -------------------------- | ------------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| builtin tools           | `builtin-tools`            | `BUNDLED`                       | `EAGER`         | 内置 Tool，由 owned tool list 显式注册                                                    |
| builtin skills          | `builtin-skills`           | `BUNDLED`                       | `EAGER`         | 打包内置 Skill（如 `skill-creator`）                                                      |
| builtin agents          | `builtin-agents`           | `BUNDLED`                       | `EAGER`         | 内置 Agent（如 `network-explorer`）                                                       |
| memory tools            | `memory-tools`             | `BUNDLED`                       | `EAGER`         | 长期记忆 Tool（`search_memory`/`get_memory_detail`/`add_memory`），由 `agent-memory` 提供 |
| 系统级本地 Skill        | `local-skills-system`      | `LOCAL_DIRECTORY`               | `EAGER`         | 扫描 `configRoot/skills`                                                                  |
| Agent-owned 本地 Skill  | `local-skills-agent-owned` | `LOCAL_DIRECTORY`               | `SEARCH`        | 定位 `configRoot/agents/{agentId}/skills`                                                 |
| 顶层本地 Agent          | `local-agents`             | `LOCAL_DIRECTORY`               | `EAGER`         | 顶层 local agent                                                                          |
| Parent-scoped subagent  | `local-subagents`          | `LOCAL_DIRECTORY`               | `SEARCH`        | Agent package 下的本地 subagent                                                           |
| SkillHub                | 用户 `id`                  | `SKILL_HUB`                     | `SEARCH`        | 远程 Skill 注册中心                                                                       |
| MCP Server              | 用户 `id`                  | `MCP_SERVER`                    | `SEARCH`        | Model Context Protocol 服务                                                               |
| Agent Registry          | 用户 `id`                  | `AGENT_REGISTRY`                | `EAGER`         | 远程 Agent 注册中心                                                                       |
| API-backed Tool（CLIP） | 用户 `id`                  | `CUSTOM`（`providerType` 适配） | `EAGER`         | CLIP-backed API tool source                                                               |

几条治理规则（出自 `capability-catalog` spec），写 source 时要记住：

- **catalog 是唯一的裁决入口**。Discovery adapter 只负责产出候选 descriptor，不决定一个能力最终是否可见、可执行。可见性、冲突、request 级 Agent 授权，都由 `CapabilityCatalog.listAvailable` / `resolve` 在统一一道门里裁决。这意味着你写 source 时不要试图自己控制"谁能用"——交给 catalog。
- **注册不等于绑定**。catalog 能发现一个能力，不代表任何 Agent 可以调用。必须在 `agent.yaml.capabilityBindings` 显式绑定（builtin 默认 Agent 已绑了常用能力）。`listAvailable` 里看不见的 capability，`resolve` 一定执行不了。
- **assembly 编译不要求 descriptor 已发现**。`capabilityBindings` 表达的是 Agent 的授权意图，不是"descriptor 已经找到"的证明。编译时只校验 binding 形状、safe id、kind、已注册的 provider id；descriptor 是否存在、是否冲突，留到运行时 `listAvailable` / `resolve` 再判。
- **执行路由看 kind + provider 身份**。`CapabilityExecutorFactory` 按 resolved descriptor 的 `provider.providerId` + `kind`（`CUSTOM` 还看 `providerType`）选 executor，不按 `providerKind` 一对一映射，也不按注册顺序。匹配不到或匹配多个都算安全失败。
- **executor 只返回结果**。executor 不直接写 timeline、session message、checkpoint、audit、terminal commit，也不动 Agent/Core loop 状态——这些都是 runtime 的职责。

### 4. Lifecycle Hook

Hook 是 runtime request lifecycle 上的观察、变换和控制扩展点。TypeScript 后端统一使用 `defineLifecycleHook(...)` 定义 hook implementation object，再通过 `agent.yaml.hooks` 在当前 Agent 中启用、关闭、stage 收窄、排序、限时和配置。

完整写法、9 个 stage、`OBSERVE` / `TRANSFORM` / `CONTROL`、`PASS` / `SKIP` / `DENY` / `BLOCK` / `PEND`、各 stage 可替换字段和 `system.output-redaction-guard` 示例见 [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md)。

> 当前版本 Hook 产品路径由 `agent-app` 在启动期接收 trusted app/plugin composition 已装配的显式 `LifecycleHook` 对象，冻结 hook registration / definition / AgentAssembly activation snapshot。Agent package 只通过 `agent.yaml.hooks` 表达启用/关闭/排序/超时/配置；runtime 只消费 accepted run 固化的 snapshot，不从配置目录、manifest 或请求主路径扫描 hook。动态插件加载、运行时热插拔、远端实现包加载均在当前基线范围外。

#### Hook 约束

Hook **不能**：

- 绕过准入控制（capability governance / risk policy / sandbox boundary）
- 修改 Runtime 状态机或终态提交规则
- 抑制强制性审计事件
- 伪造或发布冲突的终态状态
- 覆盖外部调用的 raw result

Hook **必须**：

- 设置超时
- 可观测
- 失败时安全降级
- 产生 hook invocation record

## 内置工具列表

当前 builtin Tool（来自 `packages/agent-capability/src/builtins/index.ts`，providerId=`builtin-tools`，providerKind=`BUNDLED`）：

| Tool              | 功能                                                                            | 关键依赖                          | replayPolicy     |
| ----------------- | ------------------------------------------------------------------------------- | --------------------------------- | ---------------- |
| `Read`            | 受控读取 workspace / execution 文件，支持分页                                   | `workspaceFiles`                  | `IDEMPOTENT`     |
| `Write`           | 受控创建或覆盖写入授权目录内文件（read-before-write 硬失败）                    | `workspaceFiles`                  | `NON_IDEMPOTENT` |
| `Edit`            | 受控文本编辑（read-before-edit + old_string 唯一性硬失败）                      | `workspaceFiles`                  | `NON_IDEMPOTENT` |
| `Glob`            | 文件名模式匹配与枚举（≤500 结果）                                               | `workspaceFiles`                  | `IDEMPOTENT`     |
| `Grep`            | 内容正则搜索                                                                    | `workspaceFiles`                  | `IDEMPOTENT`     |
| `Bash`            | 受治理 shell 执行，经 sandbox gateway denylist（Bash 只做 tokenization + 路由） | `sandbox`                         | `NON_IDEMPOTENT` |
| `Python`          | 受治理 Python 执行，经 sandbox gateway                                          | `sandbox`                         | `NON_IDEMPOTENT` |
| `Rag`             | 本地知识检索（依赖 `RagRetrievalGateway`）                                      | `ragRetrieval`                    | `IDEMPOTENT`     |
| `ToolSearch`      | request-local deferred capability 激活与检索                                    | —                                 | `IDEMPOTENT`     |
| `AskUserQuestion` | 统一 pending input 人机交互入口（创建 `QUESTION` pending input）                | —                                 | `NON_IDEMPOTENT` |
| `Skill`           | 解析 governed SKILL descriptor 并执行 Skill                                     | `skillSources` + `workspaceFiles` | `NON_IDEMPOTENT` |
| `Agent`           | 解析 governed AGENT descriptor 并通过 subagent execution 创建 child run         | `subagentExecution`               | `NON_IDEMPOTENT` |

**记忆 Tool**（providerId=`memory-tools`，由 `agent-memory` 提供，默认 Agent 已绑定）：

| Tool                | 功能             |
| ------------------- | ---------------- |
| `search_memory`     | 检索长期记忆     |
| `get_memory_detail` | 查看记忆详情     |
| `add_memory`        | 人工新增长期记忆 |

> 当前版本未暴露 `update_memory` / `forget_memory`（首版不提供这些工具）。

## 为扩展 Capability 提供过程业务名称

Capability 名称由产生该 Capability 的产品包或 Provider 提供，并随统一 `CapabilityDescriptor` 进入 Catalog 治理。Agent Web 不维护产品名称表；AICOConfig、调用参数、结果内容和前端静态语言包都不是 Capability 名称权威。

### 1. 统一名称结构

每个 descriptor 必须有稳定人类名称 `displayName`，可选 `locales` 保存本地化名称：

```ts
{
  capabilityId: 'lookup-alarm',
  kind: 'TOOL',
  displayName: 'Query alarms',
  locales: {
    language: {
      'zh-CN': { displayName: '查询告警' },
      'en-US': { displayName: 'Query alarms' },
      'de-DE': { displayName: 'Alarme abfragen' },
    },
  },
}
```

Locale tag 使用 2–35 字符的 BCP 47-compatible 格式，不限定语言白名单。名称必须是 1–256 个 Unicode code point 的非空白纯文本且不含 control character；对象为 closed schema。非法名称会使对应 authoring/package 在既有校验边界 fail closed，不会局部发布半成品 descriptor。

界面按 `当前 locale → en-US → displayName → capabilityId` 解析名称。普通 Tool 直接显示名称；Agent、Skill、Workflow 由前端仅追加本地化动作模板，例如“调用子智能体：”“加载技能：”“执行预设流程：”。名称作为纯文本渲染，HTML、Markdown 和链接语法不会执行。

### 2. 在各类产品源中配置

| Capability source | 稳定名称 | 本地化名称 |
| --- | --- | --- |
| Tool / Plugin Tool | `displayName`，省略时回退 Tool `name` | `locales.language` |
| Skill | `SKILL.md` frontmatter `name` | 既有 `metadata.zh-name`、`metadata.en-name` 分别投影为 `zh-CN`、`en-US` |
| Agent | `agent.yaml` 的 `displayName` | `locales.language` |
| Workflow | Recipe YAML 的 `displayName` | `locales.language` |

Plugin Tool 示例：

```ts
defineTool({
  name: 'lookup-alarm',
  displayName: 'Query alarms',
  locales: {
    language: {
      'zh-CN': { displayName: '查询告警' },
      'en-US': { displayName: 'Query alarms' },
    },
  },
  description: 'Lookup a telecom alarm summary by alarm id.',
  // inputSchema / outputSchema / execute 省略
});
```

Agent 与 Workflow 使用相同 `locales` shape。Skill 当前沿用既有 frontmatter：

```yaml
---
name: network-diagnosis
description: Diagnose network faults.
metadata:
  zh-name: 网络诊断
  en-name: Network diagnosis
---
```

名称不会改变 capability identity、Provider binding、模型工具名、description、schema、权限、执行、结果披露或审计身份。不要用 provider id、插件 id、描述、调用参数或结果内容代替稳定 `capabilityId`。

### 3. 查询、刷新与降级

Agent Web 在 Session 打开或创建后，通过 `GET /api/v1/sessions/{sessionId}/capability-presentation-resources` 预取当前 Agent 治理视图中的 winner 名称。接口不接收 locale、agentId 或 Provider selector，一次返回全部已配置语言；语言切换只在浏览器重算，不重新请求。

查询只读取 EAGER 内存事实、本地 package frontmatter、Workflow index 和 SkillHub 已安装索引，不触发远端搜索、下载、安装或执行。SkillHub 获取成功或界面首次看到未知 Capability identity 后，共享前端协调器执行一次合并刷新。查询失败不阻塞 event/history，界面保留 last-good；没有 last-good 时按公开 id 降级。

| 场景 | 中文标题（状态另行拼接） |
| --- | --- |
| `TOOL:lookup-alarm` 命中 | `查询告警` |
| `AGENT:network-diagnostic-agent` 命中 | `调用子智能体：网络故障诊断` |
| `SKILL:network-diagnosis` 命中 | `加载技能：网络诊断` |
| `WORKFLOW:alarm-recovery` 命中 | `执行预设流程：告警恢复` |
| 指定语言缺失但有 `en-US` | 使用 `en-US` 名称 |
| 本地化名称均缺失 | 使用稳定 `displayName` |
| descriptor 未返回 | 使用 `capabilityId` |
| wrapper 缺少合法目标 id | 使用对应中性动作模板 |

`STATUS_ONLY`、`SUMMARY`、`DETAIL` 的结果披露范围、过程层级和展开证据不受名称变化影响。

### 4. 验证

后端 Provider 测试应覆盖 authoring 解析、descriptor 投影、current-read 无副作用和 Catalog winner。Agent Web 测试应覆盖 Tool、Agent、Skill、Workflow，中英文切换、Session 预取、动态 Skill 刷新、id 降级、history 重开和纯文本安全；三种宿主必须复用同一资源链路。

### ToolSearch 与 deferred capability 激活

trusted app composition 可把 Skill disclosure 和 CLIP disclosure 配置为 `tool-search` 模式。该模式下：

- 系统 prompt 只暴露 `available-deferred-skills`（或 `available-deferred-clipc`）轻量候选，不预加载 Skill body。
- `ToolSearch` 只搜索当前 request 中 governed visible 的 Tool / Skill 元数据（不搜索隐藏或未绑定的能力）。
- 命中后通过 request-local `allowedTools`（Tool）或 `discoveredSkills`（Skill）激活后续能力，`contextPatch` 只作用于当前 request/run，不持久化。
- 该模式不得借机隐藏原本就可见的普通 Tool Calling 项。

### Agent（subagent）能力

builtin Agent、顶层 local Agent、Agent package 下 subagent 都以 governed `CapabilityDescriptor(kind="AGENT")` 表达。`Agent` tool 解析 governed AGENT descriptor，通过 runtime-owned subagent execution 创建 fresh-context child session/run：

- child run 不继承父对话上下文，不能调用自身（`SELF_INVOCATION_REJECTED`）。
- 返回 bounded safe result text 供父 Agent 摘要回用户。
- Agent capability 同样走统一 catalog governance：availability filter、explicit disabled binding、conflict resolution、model visibility、provider identity。`listAvailable` 区分全局 catalog inclusion 与 request-scope callable visibility。

## 关键原则

1. **契约先行**。`agent-contracts` 先冻结 shared id、owner scope、safe error、capability、context、model、gateway、observability 等最小 public contract，再由各层并行实现。扩展不得引入平行 descriptor / provider / invocation / result 契约或平行 capability kind 词汇。
2. **同形同策**。Tool、Skill、Agent 共用同一套 provider / descriptor / invocation / catalog / executor / result 契约；新增 source 类型必须 plug 进 provider config → discovery factory → catalog → executor factory → result consumption 的骨架，不得为某个 Tool/Skill/Agent/远程服务/本地目录建独立的 catalog 或调用协议。
3. **sandbox 边界**。动态执行（shell/python）走 sandbox gateway，deny-by-default。Bash 命令权威下沉到 sandbox gateway denylist，Bash tool 只做 tokenization + 路由。Tool 实现不接收 workspace root、host 绝对路径、sandbox 内部对象。
4. **catalog governance**。注册 ≠ 绑定 ≠ 可见 ≠ 可执行。所有能力经 `listAvailable` / `resolve` 的统一门后才对模型可见、可执行。
5. **不直接修改 Kernel / Composition Root**。领域行为通过 Agent Assembly、capability binding、prompt template、Hook 表达。终态结果提交规则、Runtime 状态机等需改 specs 的 Kernel change 不应通过 Hook 或 Plugin 绕过。
6. **优先低风险扩展**。能用 Config 解决的不用 Hook，能用 Prompt Template 解决的不用新 Capability Source，能用 Capability Source 解决的不改 Kernel。

## 下一步

- [Skill 与 Tool 开发](./04-skill-tool-development.md) — Tool / Skill 实现指南
- [提示工程](./06-prompt-engineering.md) — 模板编写
- [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md) — Hook 完整写法
- [最佳实践](./15-best-practices.md) — 扩展选择的制导原则
