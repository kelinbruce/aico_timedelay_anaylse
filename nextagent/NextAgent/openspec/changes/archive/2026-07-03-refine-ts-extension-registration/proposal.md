## 背景与问题（Why）

NextAgent 需要一套受控的框架扩展注册边界，使框架内置 capability 和 framework/reserved capability provider 都能由 owning package 声明贡献，并在 `agent-capability` subsystem 装配期被统一汇总、校验、冻结和注入。

该边界必须同时满足两个目标：

- 二次开发者和框架 owner 新增受治理贡献时，有明确、可测试、可审计的注册入口。
- 注册机制保持为启动期、可信来源、显式 contribution 输入，并进入 capability/app composition 的既有治理路径。

本 change 定义 extension registration 的目标状态和黑盒行为：framework-owned capability contribution 由 owning package 声明并由 `agent-capability` 汇总；`agent-capability` 拥有 capability contribution assembly；`agent-app` 先物化 AgentAssembly 结构、再装配依赖 AgentAssembly 的 contribution，最终在 ready gate 统一校验 startup graph；ready 后注册结果保持 restart-scoped frozen snapshot；所有贡献进入既有 owner 边界执行。

## 变更范围（What Changes）

- 新增 `extension-registration` capability，定义框架扩展注册的黑盒行为。
- 定义 builtin tools/capabilities 的启动期 contribution registration：内置 capability 通过 `agent-capability` 自装配的 owner-owned contribution 进入既有 capability catalog/discovery/invocation 主路径，builtin capability 中心注册事实由 `agent-capability` owning package 维护。
- 定义 startup resource provider contribution：framework/reserved capability providers 由 owning package 贡献 provider facts、discovery support 和 executor support；跨包 contribution SPI 定义在 `agent-contracts/capability`，`agent-capability` 负责汇总、校验和冻结 contribution snapshot，并向 app composition 暴露 `CapabilityProvider[]` provider facts。
- 定义 AgentAssembly startup graph 校验边界：AgentAssembly 装配阶段只做格式/结构安全校验；model profile、capability provider、lifecycle hook、routing target、Agent binding visibility 等跨资源有效性校验在 capability/resource/hook/workflow 等 startup resources 装配完成后统一执行；校验失败时 app 不进入 ready。
- 定义启动期 safe diagnostics 和 blocking readiness outcome：重复 provider id、重复 capability id、未知 dependency、非法 schema、缺少已注册 support 的 provider kind、冲突 contribution 在 capability 装配或 capability startup validation 阶段产生明确 outcome；跨模块引用问题由 app startup graph validation 产生 blocking readiness outcome。
- 定义 registry freeze：ready 后系统使用启动期 frozen contribution snapshot；contribution 变更通过重新启动生效。

## Capability 影响（Capabilities）

### 新增 Capability

- `extension-registration`: 定义框架内置 capability 和 capability provider 的受控启动期注册机制。

### 修改的 Capability

- `builtin-tool-framework`: 后续归档时需要补充 owner-owned builtin contribution registry，并保留 owner-local stable list 的治理要求。
- `capability-catalog`: 后续归档时需要补充 provider/discovery/executor contribution 进入既有 catalog/governance 主路径的要求。
- `capability-source-configuration`: 后续归档时需要明确用户 provider 配置消费已注册 support facts，framework/reserved provider 注册由 owning package contribution 提供。
- `app-config-schema`: 后续归档时需要补充 app composition 传配置、依赖和外部 contributions，`agent-capability` 负责解释 capability 扩展事实。
- `invoked-agent-discovery`: 修改 local Agent provider identity 语义，将顶层 local Agent 的 EAGER discovery 与 parent-scoped subagent 的 SEARCH discovery 拆分为 `local-agents` 和 `local-subagents` 两个 reserved provider。

## 影响范围（Impact）

- `agent-capability`：builtin capability contribution、capability provider contribution、discovery factory support、executor support、contribution snapshot assembly。
- `agent-app`：先物化 AgentAssembly 结构，传入配置、adapter/options 和外部 owner contributions，注册 capability owner 暴露的 cleanup/maintenance hooks/jobs，消费 `agent-capability` 暴露的 catalog/invocation/`capabilityProviders` facts，并在 ready gate 执行跨模块 startup graph validation；不得直接创建、持有或调用 `WorkspaceFilePort`，也不得承载 workspace cleanup、sandbox filesystem preparation 或 Python temp script preparation 业务语义。
- `agent-contracts/capability`：承载跨包 public contribution contract，包括 `CapabilityProviderContribution`、provider-bound discovery SPI 和 provider-neutral executor SPI；如新增 durable scalar vocabulary 才进入 `agent-common`。
- 测试：新增 startup registration、conflict/fail-closed、request-time immutability、architecture boundary 和 safe diagnostic 覆盖。

## 黑盒成功标准（Black-box Success）

- 新增一个 `agent-capability` 内置 capability 时，定义和 internal contribution 输入由 `agent-capability` owning package 维护；启动后可通过现有 catalog list / capability invocation 路径看到并调用它。
- 新增一个 framework/reserved capability provider 时，只在 owning package 声明 provider/discovery/executor contribution；`agent-capability` subsystem assembly 后，resource inventory 和 capability catalog 可见该 provider。
- AgentAssembly 装配不依赖 `agent-app` 手写 provider 清单；新增 framework/reserved provider 后，Agent binding provider 引用由 `capabilitySubsystem.capabilityProviders` 校验。
- AgentAssembly 中的 model profile、provider、hook、routing target 或 Agent binding visibility 等有效性问题在 startup graph validation 阶段产生 blocking readiness outcome；校验失败时 app 不进入 ready，也不接收 request/stream/history/control traffic。
- 重复 provider id、重复 capability id、未知 dependency、缺少已注册 support 的 provider kind 或非法 schema 在启动期产生 blocking readiness outcome 或明确 safe diagnostic。
- 系统 ready 后，运行中请求、Skill 内容或文件变化后的 capability registry 仍等于启动期 frozen contribution snapshot。

## 非目标（Non-goals）

- 不支持运行时热加载、watcher reload、动态安装、远端插件下载、marketplace、签名信任链或任意本地目录自动扫描。
- 不实现 `add-ts-agent-scoped-plugin-composition` 的插件加载、Agent 激活、host externals、policy 插件或 hook 插件语义。
- 不实现 `add-ts-simple-agent-facade`；SimpleAgent 后续只能消费本 change 的 registry 结果。
- 不重构整个 `agent-app`；composition boundary 收敛由 `refine-ts-agent-app-composition-boundary` 承载。
- 不改变 capability invocation、runtime lifecycle、Agent Scope、Owner Scope、session/run persistence 或 terminal commit。

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：
- `openspec/specs/extension-registration/spec.md`：新增或拆分归并。
- `openspec/specs/builtin-tool-framework/spec.md`：修改 builtin contribution 注册要求。
- `openspec/specs/capability-catalog/spec.md`：修改 provider/discovery/executor contribution 接入要求。
- `openspec/specs/capability-source-configuration/spec.md`：修改用户配置与 framework/reserved provider 注册边界。
- `openspec/specs/app-config-schema/spec.md`：修改 app composition 传入配置、依赖和外部 contributions 的要求。
- `openspec/specs/invoked-agent-discovery/spec.md`：修改 local Agent 与 parent-scoped subagent provider identity 约束。

设计视图：
- `openspec/designs/modules/agent-capability.md`
- `openspec/designs/modules/agent-app.md`
- `openspec/designs/architecture/configuration-boundary.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：
- startup extension registration contract tests
- capability catalog/invocation integration tests
- fail-closed and safe diagnostic tests
- request-time immutability tests
- architecture boundary tests
