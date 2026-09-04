# 教程与示例

这一篇是端到端的开发示例，从零搭一个自定义 Agent。所有 Agent 都通过 `agent.yaml` + 能力绑定 + prompt 装配，不涉及 Java/Maven/Quarkus。

## 示例一：从零创建自定义 Agent

### 目标

构建一个网络设备故障诊断智能体：检查接口状态、分析路由表、输出诊断报告。覆盖 Agent 定义、模型配置、提交请求看 SSE、加自定义 Tool、加本地 Skill 的完整链路。

### 1. 创建 Agent 定义

开发者 Agent package 位于 `<configRoot>/agents/<agentId>/agent.yaml`（仓库内置 Agent 可作为参考）。下面以一个本地 Agent 为例：

`<configRoot>/agents/network-diag-agent/agent.yaml`：

```json
{
  "agentId": "network-diag-agent",
  "agentVersion": "v1",
  "displayName": "网络诊断智能体",
  "description": "网络设备故障诊断与根因分析",
  "modelIds": ["MiniMax-M2.7-highspeed"],
  "defaultModelId": "MiniMax-M2.7-highspeed",
  "capabilityBindings": [
    {
      "capabilityId": "Read",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": true
    },
    {
      "capabilityId": "Grep",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": true
    },
    {
      "capabilityId": "network-diagnostics",
      "capabilityType": "SKILL",
      "providerId": "local-skills",
      "enabled": true
    }
  ],
  "runtimeSettings": {
    "defaultLanguage": "zh-CN",
    "maxTurns": 30,
    "maxToolCallsPerTurn": 20,
    "requestTimeoutMs": 600000
  },
  "resources": []
}
```

字段说明：

- `agentId` / `agentVersion` — 唯一标识与版本，accepted run 会固化这两者与 `agentAssemblyRef`。
- `modelIds` — 引用 `application.yaml` 中 `modelProfiles[].models[].modelId`；省略时继承系统已校验模型清单。
- `defaultModelId` — 可选默认模型，必须属于解析后的 `modelIds`。
- `capabilityBindings[].capabilityType` — `TOOL` / `SKILL` / `AGENT`（三类能力统一纳入 capability 框架）。
- `providerId` — 能力来源 provider（builtin-tools / local-skills 等）。
- `capabilityId` — 必须使用大小写准确的最终 Tool ID。内置 Tool 为首字母大写形式：`Read`、`Write`、`Grep`、`Glob`、`Edit`、`Bash`、`Python`、`Rag`、`Skill`、`AskUserQuestion`、`Agent`、`ToolSearch`、`TodoWrite`、`Workflow`、`ApiCall`、`Cron`；memory tools 为小写下划线形式：`search_memory`、`get_memory_detail`、`add_memory`。
- `runtimeSettings` — 运行时参数：`defaultLanguage` / `maxTurns`（模型回合上限）/ `maxToolCallsPerTurn`（单回合 Tool 调用上限）/ `maxContextMessages` / `requestTimeoutMs`。

> **sandbox 提示**：默认配置只允许 `clipc` / `curl` / `python` 三个可执行文件，`bash`、`sh`、`powershell` 等都在 deny 名单里。本示例刻意不绑定 `Bash`；如果你的场景确需 shell 执行，必须在 `application.yaml` 的 `nextAgent.system.sandbox` 中显式调整 `allowedExecutables` / `deniedExecutables`（见[部署说明](./12-deployment.md)），不要默认放开。

### 2. 配置模型

在开发者 `<configRoot>/application.yaml` 的 `modelProfiles[]` 中配置 provider access 与 canonical model：

```yaml
modelProfiles:
  - providerId: openai-compatible
    baseUrl: https://api.minimaxi.com/v1
    credentialRef: env:OPENAI_API_KEY
    models:
      - modelId: MiniMax-M2.7-highspeed
        timeoutMs: 30000
        contextWindowTokens: 128000
        fallbackEligible: false
hostedAgent:
  activeAgentId: network-diag-agent
```

设置环境变量后启动：

```bash
# bash / Git Bash（Windows 下二选一，与你的终端保持一致）
export OPENAI_API_KEY="your-api-key"
npm run dev:fullstack   # 或 npm run dev:watch 仅后端
```

```powershell
# PowerShell
$env:OPENAI_API_KEY = "your-api-key"
npm run dev:fullstack
```

### 3. 提交请求并查看 SSE

```bash
# 创建会话
SESSION=$(curl -s -X POST http://127.0.0.1:3000/api/v1/sessions \
  -H "Content-Type: application/json" -d '{}' | python -c "import sys,json;print(json.load(sys.stdin)['sessionId'])")

# 提交请求
curl -s -X POST "http://127.0.0.1:3000/api/v1/sessions/$SESSION/requests" \
  -H "Content-Type: application/json" \
  -d '{"inputText":"路由器 R1 的 OSPF 邻居异常，请诊断","idempotencyKey":"network-diag-demo-001","locale":"zh-CN"}'

# 监控 SSE 流
curl -N "http://127.0.0.1:3000/api/v1/sessions/$SESSION/stream" \
  | grep "^data:" | cut -d: -f2- | python -m json.tool
```

典型事件序列：`REQUEST_ACCEPTED` → `CAPABILITY_STARTED`（调用 skill / tool）→ `CAPABILITY_RESULT_DELTA` → `LLM_CONTENT_DELTA` → `REQUEST_COMPLETED`。

预期效果：

- 提交请求后同步返回 `sessionId`、`requestId`、`runId`、`attempt`。
- SSE 流中至少能看到 `REQUEST_ACCEPTED` 和一个 terminal 事件（如 `REQUEST_COMPLETED`）。
- 若 Skill 或 Tool 被触发，流中会出现 `CAPABILITY_STARTED` / `CAPABILITY_RESULT_DELTA`。

### 4. 加一个自定义 Tool

自定义 Tool 是 TypeScript 实现，外部（仓库外）开发者通过 `@nextagent/agent-plugin-sdk` 编写并打包成插件交付（完整流程见 [Agent Plugin 开发指南](./19-agent-plugins.md)）。最小可编译示例：

```ts
// plugins/my-network-tools/src/tools/interface-status.ts
import { defineTool } from "@nextagent/agent-plugin-sdk";

export const interfaceStatusTool = defineTool({
  name: "interface-status",
  description: "查询指定设备的接口状态摘要",
  inputSchema: {
    type: "object",
    properties: {
      device: { type: "string", description: "设备名，如 R1" }
    },
    required: ["device"]
  },
  outputSchema: {
    type: "object",
    properties: {
      device: { type: "string" },
      interfaces: { type: "array" }
    },
    required: ["device", "interfaces"]
  },
  async execute({ device }) {
    // 实际实现调用设备 API 或读取配置
    return {
      structuredPayload: { device, interfaces: [{ name: "Gig0/0", status: "up" }] }
    };
  }
});
```

在插件入口用 `defineToolProvider` 暴露该 Tool，并在 `agent.yaml` 的 `capabilityBindings` 中追加：

```json
{
  "capabilityId": "interface-status",
  "capabilityType": "TOOL",
  "providerId": "my-network-tools",
  "enabled": true
}
```

`providerId` 对应 `plugin.json` 的 `id`；仓库内贡献者也可以选择在 app composition 层通过 capability source 注册（见 [Skill 与 Tool 开发](./04-skill-tool-development.md)），但插件是外部开发者的标准路径。

约束：

- `inputSchema` 必须是有效 JSON Schema（capability input schema validation）。
- 高风险操作需用户确认（pending input 边界）。
- 动态执行路径走 sandbox gateway boundary，deny-by-default。

预期效果：

- 启动后 capability catalog 能看到 `interface-status`。
- 当模型需要接口摘要时，会在 stream 中出现对应 capability 调用事件。
- Tool 成功时，后续模型输出会消费 `structuredPayload` 中的接口摘要事实。

### 5. 加一个本地 Skill

Skill 由 `SKILL.md`（front-matter + 正文）声明，通过 local directory source 加载。

`<configRoot>/skills/network-diagnostics/SKILL.md`（`skills` 目录由 `nextAgent.paths.skillRoot` 定位，默认在 configRoot 解析基准下；configRoot 目录名为 `config` 时基准上移到其父目录）：

```markdown
---
name: network-diagnostics
description: 电信网络设备故障诊断技能
when_to_use: 当需要对网络设备进行故障排查、日志分析或诊断报告生成时
allowed-tools:
  - Read
  - Grep
version: "1.0"
---

# 网络设备故障诊断

## 诊断流程

1. 信息收集：获取设备类型、型号、软件版本
2. 接口检查：检查接口状态、错误计数、流量统计
3. 协议分析：检查 OSPF/BGP 邻居状态、路由表
4. 日志分析：检查系统日志中的异常事件
5. 根因定位：基于收集的信息定位故障根因
6. 报告输出：生成结构化的诊断报告

## 安全约束

- 不执行配置修改命令
- 高风险操作需用户确认
- 命令超时设置 30 秒
```

在 `agent.yaml` 的 `capabilityBindings` 中绑定 `network-diagnostics`（见步骤 1）。Skill 通过 Skill tool 调用，模型根据 `description` / `when_to_use` 决定何时触发。

预期效果：

- 启动期本地 skill source 能成功发现 `network-diagnostics`。
- 当输入包含“故障诊断”“日志分析”“诊断报告”等意图时，模型更容易路由到该 Skill。
- 如果 Skill 被触发，stream 中会出现 skill/tool 相关 capability 事件，最终输出更贴近你在 `SKILL.md` 中定义的诊断流程。

## 示例二：配置审查智能体

### 目标

构建一个网络设备配置审查智能体：读取配置文件、检查合规性、输出审查报告。

### 关键能力绑定

```json
{
  "capabilityBindings": [
    {
      "capabilityId": "Read",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": true
    },
    {
      "capabilityId": "Grep",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": true
    },
    {
      "capabilityId": "config-review",
      "capabilityType": "SKILL",
      "providerId": "local-skills",
      "enabled": true
    }
  ]
}
```

`<configRoot>/skills/config-review/SKILL.md`：

```markdown
---
name: config-review
description: 网络设备配置审查
when_to_use: 审查设备配置文件的合规性、安全性和最佳实践
allowed-tools:
  - Read
  - Grep
version: "1.0"
---

# 配置审查

## 审查检查项

### 安全合规
- AAA 配置是否完整
- SNMP community 是否为默认值
- Telnet 是否已禁用（应使用 SSH）
- ACL 规则是否符合安全策略

### 协议配置
- OSPF/BGP 认证是否配置
- 路由过滤是否合理
- 接口 MTU 是否一致

## 审查流程

1. 读取配置文件（read 工具）
2. 逐项检查以上 checklist（grep 工具）
3. 标记不符合项
4. 生成审查报告（含改进建议）
```

预期效果：

- 对配置文件提问时，模型会优先读取文件再做 checklist 式审查。
- 最终回答应包含“不符合项 + 风险解释 + 改进建议”，而不是只返回原始 grep 结果。
- 你可以通过会话历史或 SSE 事件确认 `Read` 和 `Grep` 确实参与了路径。

## 示例三：报告生成智能体（含记忆）

### 目标

构建一个自动化报告生成智能体：收集网络状态、生成周期性运维报告，并使用长期记忆保存关键发现。

### 关键能力绑定

```json
{
  "capabilityBindings": [
    {
      "capabilityId": "Read",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": true
    },
    {
      "capabilityId": "Write",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": true
    },
    {
      "capabilityId": "search_memory",
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
      "capabilityId": "report-generation",
      "capabilityType": "SKILL",
      "providerId": "local-skills",
      "enabled": true
    }
  ]
}
```

`skills/report-generation/SKILL.md` 节选：

```markdown
---
name: report-generation
description: 网络运维报告自动生成
when_to_use: 当用户需要生成网络运维日报、周报或事件报告时
allowed-tools:
  - Read
  - Write
  - search_memory
  - add_memory
version: "1.0"
---

# 运维报告生成

## 生成步骤

1. 查询最近一段时间的运维数据（通过工具）
2. 调用 search_memory 查找相关历史事件
3. 汇总分析，生成结构化报告
4. 保存为 Markdown 文件（Write 工具）
5. 调用 add_memory 保存关键发现
```

> 长期记忆由 `nextAgent.memory` 配置控制（`enabled` / `search` / `extraction` / `aging`），默认启用。memory tools 属于 `agent-memory` 包，不自动注入，需显式绑定。

预期效果：

- 请求中若需要历史背景，模型会先调用 `search_memory` 检索相关事实。
- 输出报告后，若流程包含沉淀关键发现，后续会看到 `add_memory` 被调用。
- `write` 成功时，工作区里应出现新生成的 Markdown 报告文件。

## 示例四：自定义 Lifecycle Hook — 审计日志

### 目标

为智能体添加审计 Hook，记录每次能力调用的安全摘要。

### 实现

Hook 通过 `defineLifecycleHook(...)` 定义。仓库内（app-local）实现从 `@nextagent/agent-runtime` 导入；**外部（仓库外）开发者应从 `@nextagent/agent-plugin-sdk` 导入，并打包成插件交付**（见 [Agent Plugin 开发指南](./19-agent-plugins.md)）。Agent 只在 `agent.yaml.hooks` 中声明启用与配置：

```ts
// 仓库内（app-local）实现从 agent-runtime 导入：
import { defineLifecycleHook } from "@nextagent/agent-runtime";
// 插件包内请改用：
// import { defineLifecycleHook } from "@nextagent/agent-plugin-sdk";
import type { HookInput, HookResult } from "@nextagent/agent-contracts/runtime";

export const auditCapabilityHook = defineLifecycleHook({
  hookId: "custom.audit-capability",
  kind: "CUSTOM",
  supportedStages: ["BEFORE_CAPABILITY_INVOKE", "AFTER_CAPABILITY_RESULT"] as const,
  effects: ["OBSERVE"] as const,
  failureMode: "CONTINUE",
  execute(input): HookResult<typeof input.stage> {
    // observe-only：只能记录安全摘要，不能改写 boundary 或控制流程
    // HOOK_INVOKED 自动携带 stage / outcome / mutationSummary
    return { outcome: "PASS" };
  }
});
```

在 `agent.yaml` 中启用：

```json
{
  "hooks": [
    {
      "hookId": "custom.audit-capability",
      "enabled": true,
      "stages": ["BEFORE_CAPABILITY_INVOKE", "AFTER_CAPABILITY_RESULT"],
      "order": {
        "priority": 20
      },
      "timeoutMs": 1000
    }
  ]
}
```

约束：

- observe-only hook 返回 mutation / `DENY` / `BLOCK` / `PEND` 会被忽略并记诊断。
- `HOOK_INVOKED`、日志、审计禁止输出 raw prompt、模型输出、工具参数/结果、credential 等。
- runtime 为每次 observe-only invocation 提供稳定 idempotency key（`stageOccurrenceKey + ":" + hookId`）。

预期效果：

- 每次 capability 调用前后都能形成 `HOOK_INVOKED` 类观测事实。
- hook 不会改变主流程结果，只补充安全观测。
- 若 hook 超时或报错，按 `failureMode: "CONTINUE"` 处理，主请求继续执行。

### 示例验收建议

- 示例一：至少跑通一次 `sessions -> requests -> stream`，确认 `REQUEST_ACCEPTED` 到 terminal 事件闭环。
- 示例二：准备一份包含 AAA、Telnet、SNMP community 的配置样本，确认输出里能列出不符合项。
- 示例三：确认工作区生成了报告文件，并在后续问题中能命中前一次沉淀的记忆事实。
- 示例四：通过日志或 timeline 观察 `HOOK_INVOKED`，确认 hook 只观测、不改写结果。

完整 Hook 开发指南见 [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md)。

## 测试示例快速参考

```bash
# 全部后端测试
npm test

# 指定模块测试
npx vitest run packages/agent-capability
npx vitest run packages/agent-runtime

# Hook kernel 测试
npx vitest run tests/agent-kernel

# 契约测试
npm run test:contract

# 发布 E2E 全量
npm run test:e2e:release
```

## 关键代码路径

| 示例 | 路径 |
|------|------|
| 默认 Agent 定义 | `packages/agent-core/src/builtin-agents/default-agent/agent.yaml` |
| 系统配置 | `packages/agent-app/config/default-system.yaml` |
| Tool 实现参考 | `packages/agent-capability/src/` |
| Skill source 参考 | `packages/agent-capability/src/`（builtin / local / skillhub source） |
| Hook 实现 | `packages/agent-runtime/src/lifecycle/` |
| 内置 SYSTEM hook | `packages/agent-runtime/src/lifecycle/system-output-redaction-guard.ts` |
| 打包脚本 | `scripts/pack-local-runtime.mjs` |
| 发布资格 | `scripts/release-qualify.mjs`、`packages/agent-app/src/release/` |

## 相关资源

- [Agent 配置参考](./03-agent-configuration.md)
- [Skill 与 Tool 开发](./04-skill-tool-development.md)
- [能力扩展](./05-capability-extension.md)
- [提示工程](./06-prompt-engineering.md)
- [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md)
- [部署说明](./12-deployment.md)
- [测试与调试](./11-testing-debugging.md)
