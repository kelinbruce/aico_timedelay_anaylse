# add-ts-simple-agent-facade

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Developer Experience / SDK

状态：candidate
类型：开发者体验候选 change
主要 owner：`agent-app`、`agent-capability`、`agent-context-engine`
依赖：`add-ts-agent-package-assembly`、`add-ts-app-config-schema`、`add-ts-model-provider-configuration`、`add-ts-capability-core-governance`、`add-ts-skill-manifest-contract`

目标：
- 为二次开发者提供最小起步 API：`new SimpleAgent(instructions, tools, skills)` 和 `app.run(agent)`。
- 将简化输入编译为普通受治理 Agent assembly、model profile、workspace policy、prompt assembly input 和 capability bindings。
- 降低本地开发、样例工程和电信领域 PoC 的起步成本，同时保持 Agent Scope、Owner Scope、capability governance、sandbox、observability 和 runtime lifecycle 不变。

规格输入：
- `SimpleAgent` 必须是开发者体验 facade，不是新的 runtime 执行模式；`app.run(agent)` 进入 `agent-app` composition root 后必须走既有 request lifecycle。
- 函数式最小入口支持：

```ts
const agent = new SimpleAgent(instructions, tools, skills);
await app.run(agent);
```

- 对象式入口可表达可选信息，例如 `name`、`model`、`workspace`、`language`、`safetyProfile`，但不得暴露 runtime 内部对象或 gateway record。
- `tools` 只能引用已配置、已治理、当前 Agent 可授权的 builtin tool、plugin tool 或 capability id；默认 profile 必须 fail closed，不得默认开启写文件、shell、python、网络或高风险能力。
- `skills` 只能引用启动期可信本地路径、已安装 Skill id 或受治理 Skill source；不得由请求体、模型输出或 capability 参数动态加载。
- 默认 model profile、prompt profile、workspace policy 和 capability binding 由 `agent-app` 根据显式配置和安全默认值推导；缺失或歧义时返回 developer-friendly safe error。
- 编译结果必须能映射到现有 Agent assembly 语义，并在 session/run acceptance 时固化 `agentId`、`agentVersion` 和 `agentAssemblyRef`。
- facade 不得绕过 runtime schema validation、capability authorization、risk policy、sandbox gateway、redaction、audit 或 structured logging。

实现约束：
- public API 应位于 `agent-app` 或独立 SDK public surface；跨 package 只能使用 public exports、`agent-contracts` 和 `agent-common`。
- `SimpleAgent` 只负责收集和校验开发者意图；真正的 model/capability/context/runtime 组装由既有 owner 完成。
- 工具和技能解析必须复用 capability discovery/catalog、Skill manifest validation 和 capability governance，不得复制一套 parallel registry。
- safe error 可以面向开发者解释缺失配置、未知 tool、非法 Skill path、权限不足或不安全默认值，但不得泄漏 credential、raw path、prompt、provider error 或高基数字段。

非目标：
- 不创建新的 OpenSpec-free contract、runtime command、Web API 或 stream event。
- 不支持动态 hot reload、运行时安装插件、远端 Skill marketplace、远端 Agent discovery 或多 Host Agent selection。
- 不定义 Agent 内 workflow vs model loop 路由；Agent 内路径选择仍由 Agent Routing 能力组承载。
- 不绕过显式生产配置；生产环境仍可要求完整 app composition 和安全 profile。

验收要点：
- Developer UX：最小代码样例能启动一个受治理 Agent，并完成一次本地问答主流程。
- Contract：`SimpleAgent` 编译产物与普通 Agent assembly 等价进入 runtime，不产生第二套 request lifecycle。
- Security：未知 tool、未授权 tool、危险默认能力、非法 Skill path 和动态请求期 Skill 注入均 fail closed。
- Capability：工具和技能只通过 capability catalog/governance 可见，不能扩大当前 Agent 权限。
- Observability：编译成功/失败和运行期关键诊断均输出脱敏 safe diagnostic。
- Architecture：不得 private path import，不得让 SDK facade 依赖 gateway-local row/entity 或 runtime 私有状态机。

并行边界：
- 本 change 依赖 Agent assembly、Runtime Configuration、Capability governance、Skill manifest 和 model provider configuration 稳定后再创建正式 OpenSpec change。
- 若需要新增 public SDK package、类型导出或 app entrypoint contract，正式 change 必须先定义 public API、目标边界和验证策略。
