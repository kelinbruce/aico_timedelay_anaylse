# 最佳实践

这一篇收集 NextAgent Agent 开发中值得遵循的做法和需要避开的坑。内容不求面面俱到，只挑实际开发里最容易踩的几类问题，每类给一两个具体例子。原则就四条：规格优先、契约先行、同形同策、双 scope 隔离。

## 架构与扩展选择

写 Agent 之前先想清楚：这个需求属于哪一层？NextAgent 的扩展面从低风险到高风险大致是 Config → Prompt Template → Capability Source → Lifecycle Hook → Kernel/Composition Root。能在一层解决的，不要往上一层挪。

- **优先用装配，少改内核**。改 `agent-runtime` 的状态机会影响所有 Agent，几乎一定是错的方向。领域行为应该落在 `agent.yaml` 装配、prompt template、capability 或 hook 上。比如"让 Agent 回答前先查一次配置库"——这是 Tool 的事，不是改 runtime 的事。
- **能用 prompt 解决的不加 hook**。回答风格、术语口径、双语规则，都在 prompt template 里调，不必为此写一个 hook。
- **能用 builtin source 不引入新 source**。已有的 builtin tools、local skill、memory tools 覆盖了大多数场景，引入新 capability source 是较重的决定，要同时维护 discovery、catalog 注册、executor 路由。

## 契约与边界

- **先有 OpenSpec change，再写代码**。新增或修改稳定行为（Web API、stream event、runtime command、capability contract、gateway contract、scope 边界、observability signal）时，先提 change。contract / architecture / e2e 门禁都对齐 spec，先写代码后补 spec 容易出现代码和 spec 对不上的情况。
- **同形同策**。Tool、Skill、Agent 共用同一套 provider / descriptor / invocation / catalog / executor 契约。不要为某类能力开后门绕过 catalog 或 sandbox——比如某个 Tool 想直接 HTTP 调外部服务，正确做法是走 capability source（`skill-hub` / `mcp-server` / `custom`），不是在 `agent-core` 里塞 fetch。
- **双 scope 不可被客户端覆盖**。Agent Scope（可信 app composition / hosted-agent / 已持久化 `Session.agentId`）和 Owner Scope（channel / auth identity）都来自可信边界。请求体、模型输出、capability args 都不能改写当前身份或当前 Agent。持久化数据要带 owner + agent scope，跨 owner / 跨 agent 读写必须被拒绝。
- **accepted run 固化装配**。`RequestRun` 在 acceptance 时固化 `agentId` / `agentVersion` / `agentAssemblyRef`，之后执行路径不再回退到默认 Agent。这意味着 Agent 配置在请求开始后就锁定，运行中改配置不会影响进行中的 run。
- **DO / DTO / Record 分层**。领域服务暴露 DO / read model；Web / channel 只暴露 public DTO；gateway 只暴露 `*Record`；DB row 留在 gateway-local 私有实现。不要把 `*Record` 直接塞进 Web response，也不要让 DO 直接被 API 返回。

## 能力设计

**Tool 还是 Skill？** 简单的判断：

- 单一、无状态、输入输出明确、不需要模型决策的操作，写成 Tool。`read` / `write` / `bash` / `grep` / `glob` 都是这一类。
- 复合流程（收集信息 → 分析 → 出结论）、需要模型参与决策、需要独立上下文和受限工具集的，写成 Skill。

**Tool 的关键是 schema 清楚。** 一个好的 Tool，模型光看 `description` 和 `inputSchema` 就知道何时用、怎么传参：

```ts
export const interfaceStatusTool = defineTool({
  name: "interface-status",
  description: "查询指定设备的接口状态摘要，返回每个接口的 up/down 与错误计数",
  inputSchema: {
    type: "object",
    properties: {
      device: { type: "string", description: "设备名，如 R1、CORE-SW-01" }
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
  async execute({ device }, ctx) {
    return { structuredPayload: { device, interfaces: [] } };
  }
});
```

反面例子：`description` 写"执行操作"，参数没类型、没说明，模型只能猜。参数校验失败、超时、sandbox deny 这些异常路径都要包成规范化错误码返回，不要抛裸异常。

**Skill 的关键是触发条件清楚。** `SKILL.md` 的 `when_to_use` 写"随时可用"等于没写——模型无法判断该不该用。写明触发条件，比如"当用户要求分析小区掉话率且提供了时间范围时使用"。`description` 是一句话概述，用于模型匹配；步骤用编号写清；明确 `allowed-tools` 和安全限制。

**注册不等于绑定。** 一个能力被 source 注册进 catalog，只是"系统能发现它"，不代表任何 Agent 可以调用。必须在 `agent.yaml.capabilityBindings` 显式绑定，Agent 才有用它的权限。这条保证了新增能力不会自动获得执行权限。

## Sandbox 与安全

动态执行（shell、python、脚本、模型生成代码）必须走 sandbox gateway boundary，deny-by-default：默认拒绝，由 policy 决定 allow。Bash 只做 tokenization + sandbox 路由，executable 的 allow/deny 由 sandbox gateway policy 决定；`clipc` 由 sandbox trusted locator 解析（`CLIP_HOME`）。

不要在 `agent-core` / `agent-capability` / `agent-runtime` / `agent-context-engine` 里直接 `import` `child_process` / `worker_threads` / `vm`——dependency-cruiser 会拦。Tool 实现也不接收 workspace root、host 绝对路径或 sandbox 内部对象。

执行文件访问从 `workspaceRoot/execution` 派生 accepted-run 的逻辑 root：

- `workspace/` —— durable 读写
- `.nextagent/` —— system-managed 授权资源
- `temp/` —— 当前 run 的临时区

高风险操作（修改、删除、重启）要走 pending input 让用户确认；命令执行设超时；敏感信息不进响应（`system.output-redaction-guard` 会自动脱敏）；危险操作留审计 trace。不要静默执行危险命令，也不要在日志里暴露 credential / raw prompt / 模型输出。

## 提示工程

提示模板在启动期通过 prompt template registration 装配，context-engine 按 purpose 选择（`SYSTEM_PROMPT` / `SUMMARY_GENERATION` / `MEMORY_EXTRACTION` / 自定义）。内置 system prompt 含双语电信输出约束——模型跟随用户输入语言，但 NE / interface / KPI / protocol / alarm / CLI 等电信术语保留英文。

- 稳定内容（身份、安全规则、领域知识）放 cacheable 段，保护 prompt cache 命中。
- 动态内容（当前时间、会话信息）放 non-cacheable 段。
- 不要在运行期从配置目录 / manifest / 请求主路径扫描 prompt，也不要在模板里写表达式 DSL——`{{ var }}` / `{{ var? }}` 是仅有的受治理变量语法。

中文语境下术语要统一：OSPF 保留英文缩写，邻居状态、路由震荡这类用对应英文术语（neighbor state、route flapping）混排；命令输出保持原始格式；诊断报告用 Markdown 表格。

## 记忆

长期记忆不自动注入 prompt。模型要用记忆，就显式调用 `search_memory` / `get_memory_detail` / `add_memory` 这几个 memory tools。`nextAgent.memory` 控制 extraction / aging / search 的生命周期，记忆写入走锚点幂等。不要在 DO / DTO 层硬编码记忆读写，也不要自动把记忆塞进 prompt——那样不可控、不可审计。

## 幂等与修改

每个请求都要带 `idempotencyKey`，runtime 保证锚点幂等写入：同一个 key 重复提交返回首次结果，不重复 side effect。重试同一个请求复用同一个 key。

Hook 的 mutation 只做"同名字段完整替换"——没有 JSON Patch、没有表达式 DSL。只替换当前 stage 允许的字段，返回完整的新字段值（runtime 不做局部 patch）。不要跨 stage mutation，不要在 hook 里 override owner/agent scope，也不要改 runtime state。

observe-only hook 的外部副作用用 runtime 提供的稳定 idempotency key（`stageOccurrenceKey + ":" + hookId`）；但 impact hook 的恢复重执行一致性 runtime 不保证，需要 hook 自己处理。

## Hook 设计

选 effects 时按"影响越小越好"：

| 场景 | 推荐 effects |
|------|-------------|
| 审计日志、指标 / trace / 诊断采样 | `OBSERVE` |
| 幂等外部通知 | `OBSERVE` |
| 工具参数治理 / 改写 | `TRANSFORM` |
| 最终输出格式化 / 脱敏 | `TRANSFORM`（+ `CONTROL`） |
| 治理拒绝 / 保护阻断 | `CONTROL` |
| 挂起等待用户输入 | `CONTROL`（`PEND`） |

只观察不改流程用 `OBSERVE`（并行观察组，失败/超时只产生观测降级）；要改 boundary 用 `TRANSFORM`（串行影响组）；要拒绝/阻断/挂起用 `CONTROL`（串行影响组）。不要多声明用不到的 effect。SYSTEM hook 必须 `failureMode: "FAIL"`；CUSTOM impact hook 可以用 `CONTINUE`。

超时按 stage 调：`BEFORE_REQUEST_ACCEPT` 要短（准入检查要快）；`BEFORE_MODEL_INVOKE`、`AFTER_CAPABILITY_RESULT`、`BEFORE_AGENT_TERMINAL` 中等。所有 impact hook 都要设 `timeoutMs`，否则可能永久阻塞请求。

## 测试

测试分四层，前三层必要：

- **单元测试**：每个 Tool / Skill handler / hook execute 的逻辑，放 `packages/<pkg>/tests/`。
- **契约测试**：`tests/contract/`，对齐 `agent-contracts`。
- **架构边界测试**：`tests/architecture/`，dependency-cruiser + manifest policy。
- **Agent Kernel 测试**：`tests/agent-kernel/`，最小内核主链路（推荐）。
- **E2E 门禁**：`tests/e2e/`，发布前跑各 gate 脚本。

覆盖建议上重点测边界，不要只测 happy path：

- Tool：正常执行、参数无效、超时、sandbox deny、异常。
- Skill：正常流程、异常中断、事件发射。
- Hook：正确触发、降级（`CONTINUE`）、阻断（`FAIL` / `DENY` / `BLOCK`）、超时、schema 校验失败。
- Scope：Agent Scope、Owner Scope、跨 scope 拒绝。

## 部署与生产就绪

凭据用 `env:` 或 `file:` 引用（`direct:` 形式不被支持，配置校验会拒绝）：

```jsonc
// default-system.yaml
"credentialRef": "env:OPENAI_API_KEY"        // 推荐
"credentialRef": "file:config/api-key.txt"   // 推荐
"credentialRef": "direct:real-key"           // 不被接受：APP_CONFIG_SECRET_REF_INVALID
```

发布前过一遍这个清单：

- `credentialRef` 用 `env:` 或 `file:` 引用，`default-system.yaml` 里没有硬编码真实 key。
- `observability.logging.diagnosticDetail` 只使用 `normal` 或 `debug`；不要尝试配置不存在的脱敏 `off` 开关。
- 至少一个 `modelProfiles[].models[]` 子项通过配置校验并可由当前 Agent 激活。
- `hostedAgent.activeAgentId` 和实际 agent.yaml 的 `agentId` 一致。
- 所有 CUSTOM impact hook 配了 `timeoutMs` 和 `failureMode`。
- `nextAgent.memory.aging` / `extraction` 配置合理。
- `sandbox.deniedExecutables` 已维护。
- 端口 3000 可用。
- 持久化数据目录（默认 `<workspaceRoot>/data/system/`）有写权限且有备份方案（见[部署说明](./12-deployment.md)）。
- `npm run release:qualify` 结果为 `QUALIFIED` 或 `QUALIFIED_WITH_DECLARED_DEGRADATIONS`（仅适用于源码仓库发布者；使用运行包交付的部署方跳过此项，改用交付包自带的 `node bin/nextagent-self-check` 自检）。

## 反模式速查

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 跨 package private path import | 违反 dependency-cruiser，破坏边界 | 走 `@nextagent/<pkg>` 公共导出或 contracts 子路径 |
| generic `records(store,key,json)` | 绕过业务事实表与 scope | 用专用业务事实表（session/message/timeline 等） |
| 客户端覆盖 scope 字段 | 越权读写 | scope 由 runtime 与持久化层管理 |
| 日志泄敏（raw prompt / credential） | 安全风险 | redaction 默认开启，禁止输出高敏内容 |
| 在 runtime 写领域逻辑 | 破坏所有 Agent | 通过 assembly / capability 扩展 |
| Skill 的 `when_to_use` 写"随时可用" | 模型无法正确匹配 | 写明确触发条件 |
| Tool 参数无 schema 描述 | 模型传参错误 | 提供完整 JSON Schema |
| 忽略错误处理 | 异常未捕获导致 run failed | 包装为规范化错误码 |
| 在 hook 里改 Runtime 状态 | 绕过终态提交控制权 | 通过 boundary mutation 修改 |
| 前端直接重建历史 | 数据不一致 | 用 conversation API |
| 硬编码 API key | 密钥泄露 | 用 `env:` 或 `file:` 引用 |
| hook 无超时 | 可能永久阻塞请求 | 所有 impact hook 设 `timeoutMs` |
| 直接 `child_process` / `vm` | 绕过 sandbox | 走 sandbox gateway boundary |
| 自动注入记忆到 prompt | 不可控、不可审计 | 显式调用 `search_memory` |

## 相关资源

- [架构概览](./02-architecture.md) — 分层边界
- [Agent 配置参考](./03-agent-configuration.md) — 配置规范
- [能力扩展](./05-capability-extension.md) — 扩展选择指南
- [提示工程](./06-prompt-engineering.md) — 模板编写规范
- [测试与调试](./11-testing-debugging.md) — 测试方法
- [部署说明](./12-deployment.md) — 部署与打包
- [常见问题排查](./14-troubleshooting-faq.md) — 排错指南
- [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md) — Hook 规范
