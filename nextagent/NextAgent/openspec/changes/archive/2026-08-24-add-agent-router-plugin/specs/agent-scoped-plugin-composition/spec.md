## Function

- **所属 Function**：`FN-10.2 装配插件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Plugins load only during trusted startup composition

系统 SHALL 只在受信启动期根据系统配置 `plugins[]` 中显式声明的本地目录加载插件。`plugins[]` MUST 最多包含 8 个条目；每个目录 MUST 位于 `configRoot` 内并包含 `plugin.json`，且 `plugin.json.main` MUST 指向同一插件目录中的单文件 `.js` bundle。系统 MUST 在 readiness 前校验 system config、plugin directory、manifest、bundle export、plugin id/version/API version、provider/policy/hook shape、schema、required dependency、host externals 与 safe description，并形成冻结的 `PluginRegistrySnapshot`。重复 plugin id、超过插件上限或超过单插件 provider 上限 MUST 在启动校验中安全失败。

`createNextAgentApp`、`createComposedApp`、`createNextAgentAppAsync` 与 `createComposedAppAsync` SHALL 在配置非空且调用方未提供受信 `PluginRegistrySnapshot` 时支持上述加载。同步 materialize 的 object/factory MUST 在同步和异步启动入口产生等价的冻结快照与失败结果；异步入口 MUST await 返回 `Promise<NextAgentPlugin>` 的 factory，同步入口 MUST 在 readiness 前安全拒绝该 factory。调用方提供受信快照时，系统 MUST 直接消费该快照且 MUST NOT 再读取对应插件目录或 bundle。

`plugin.json.apiVersion` MAY 声明插件使用的 major/minor plugin API。API `1.1` 与 `1.2` factory artifact MUST 在 manifest 中显式声明 `apiVersion`，使系统可在 materialize 前选择唯一 host shape。兼容的 object export 或 API `1.0` factory 省略该字段时，系统 MUST 优先使用 materialized export 的 `apiVersion`，两处均未声明时 MUST 使用 root compatibility version `1.0`；省略 MUST NOT 隐式启用更高版本 factory host。root `definePlugin(...)` helper MUST 默认使用 `1.0`。latest version MUST 为 `1.2`，supported versions MUST 恰好为 `1.0`、`1.1` 与 `1.2`。manifest/export 版本不一致或版本不受支持时，系统 MUST 在接受插件贡献前安全拒绝；`plugin.version` MUST NOT 代替 plugin API version。

插件开发者 MAY 在构建期使用三方依赖，但 runtime artifact MUST 为自包含单文件 bundle；唯一例外是 `plugin.json.hostExternals` 显式声明且由 host inventory 开放的依赖。inventory MUST 恰好开放 `typebox` 与 `ajv` 两个 `OPEN` external id。API `1.0` factory host MUST 只含 `{ externals }`；API `1.1` MUST 只含 `{ externals, developerDiagnostics }`；API `1.2` MUST 只含 `{ externals, developerDiagnostics, runtime }`。API `1.1` 与 `1.2` artifact MUST 使用 factory default export，即使 `hostExternals` 为空。后续 host shape 变化 MUST 通过新的 plugin API version 定义。

系统 MUST 在执行 bundle 前扫描 static import declaration、带 `from` 的 re-export 与 string-literal dynamic `import(...)`。bundle 中存在 runtime import specifier、未知/关闭/版本不兼容的 host external、非 factory artifact 声明 `hostExternals`，或 bundle 需要未打包 runtime dependency 时，系统 MUST 在 readiness 前安全拒绝。插件加载 authority MUST 只来自受信启动配置；启动完成后，请求路径 MUST 只消费冻结快照与当前 Agent activation facts。

**需求类别**：功能性需求

#### Scenario: 启动期加载已声明的本地插件目录

- **WHEN** 系统配置声明合法的本地插件目录、manifest、自包含 bundle 与 supported plugin API version
- **AND** host externals 为空或只声明兼容的 `typebox` / `ajv`
- **WHEN** 系统通过同步或异步启动入口启动
- **THEN** 系统 MUST 在 readiness 前校验并冻结插件贡献
- **AND** 请求执行 MUST 只使用该冻结快照与当前 Agent activation facts

#### Scenario: 异步启动等待异步 factory

- **WHEN** 合法 plugin factory 返回 `Promise<NextAgentPlugin>`
- **AND** 系统通过异步启动入口启动
- **THEN** 系统 MUST await factory
- **AND** MUST 按普通 plugin export 的同一规则校验并冻结结果

#### Scenario: 同步启动拒绝异步 factory

- **WHEN** 合法 plugin factory 返回 `Promise<NextAgentPlugin>`
- **AND** 系统通过同步启动入口启动且调用方未提供受信预加载快照
- **THEN** 系统 MUST 在 readiness 前安全拒绝
- **AND** diagnostic MUST 使用不暴露 bundle source 或 raw error 的 safe reason code

#### Scenario: 同步启动消费受信预加载快照

- **WHEN** 调用方向同步启动入口提供受信 `PluginRegistrySnapshot`
- **THEN** 系统 MUST 消费该快照
- **AND** MUST NOT 为对应配置再次读取插件目录、manifest 或 bundle

#### Scenario: 非法插件 artifact 在边界安全失败

- **WHEN** plugin id 重复、容量越界、目录逃逸/缺失、manifest/main 非法、API version 不受支持/不一致，或 contribution shape/schema/dependency 非法
- **THEN** 同步与异步启动入口 MUST 在 readiness 前拒绝该插件
- **AND** diagnostic MUST 只包含 safe plugin/config reason code 与有界摘要

#### Scenario: Host utility external 通过 factory 注入

- **WHEN** manifest 声明兼容的 `typebox` 或 `ajv`
- **AND** bundle 使用匹配 plugin API 的 factory default export
- **THEN** factory host MUST 在对应 `externals` 字段提供该工具
- **AND** materialized plugin MUST 继续经过相同启动校验与冻结

#### Scenario: 关闭的 host external 安全失败

- **WHEN** manifest 声明 inventory 之外的 host external id
- **THEN** 系统 MUST 在 readiness 前拒绝该插件
- **AND** diagnostic MUST 只包含 safe plugin id、external id 与 safe reason code

#### Scenario: Bundle runtime import specifier 安全失败

- **WHEN** bundle 含 static import、带 `from` 的 re-export 或 string-literal dynamic `import(...)`
- **THEN** 系统 MUST 在执行 bundle 前拒绝该插件
- **AND** diagnostic MUST 只包含 safe plugin id、specifier category 与 safe reason code

#### Scenario: 请求输入不能加载插件

- **WHEN** request body、client metadata、model output、SkillHub package、remote URL 或未授权 Agent package path 携带 plugin id、module path、代码片段或 dynamic import 指令
- **THEN** 请求执行 MUST 继续只使用启动期冻结的插件快照与当前 Agent activation facts

## ADDED Requirements

### Requirement: 插件 factory host 提供受治理 runtime services

系统 MUST 保持 `AgentRoutingPolicyExecutable.decide(run, context, signal)` 三个既有参数的名称、顺序和语义，MUST NOT 为官方 router 增加第四个 router-specific operations/context 参数。plugin API `1.2` factory host MUST 增加 required closed `runtime` services，且该对象 MUST 只包含 Agent assembly lookup、Capability catalog、Capability invocation、model selection、model invocation 与 prompt template resolution 的 public contract ports。系统 MUST 在 readiness 前为 factory 提供稳定且完整可用的 runtime host；无法提供时 MUST 安全失败且 MUST NOT 接受请求。

插件 MUST 使用 accepted `run/context` 构造这些 public ports 的 Agent Scope、Owner Scope、session、request 与 run coordinates。runtime services MUST NOT 暴露 raw Agent definition、credential、provider route、gateway implementation、workspace path、plugin registry、request lifecycle owner、全局配置或 implementation package object。Capability 调用 MUST 继续经过 `CapabilityInvocationPort` 的现有治理，model selection MUST 继续经过 `ModelSelectionService`，prompt resolution MUST 继续经过 `PromptTemplateResolverPort`。`runtime` MUST NOT 包含 `extensions`、string index signature、动态 service lookup、service inventory 或未被本 Requirement 定义的占位 service；后续改变 required service shape MUST 通过新 plugin API version 定义。

官方 plugin SDK MUST 导出 `agent-router-plugin` authoring/deployment surface，至少包含稳定 `pluginId=agent-router-plugin`、稳定 `policyId=agent-router-plugin.auto-routing`、严格 config schema、接收 runtime services 并创建 plugin object 的 helper，以及生成 `plugin.json` 与自包含单文件 `index.js` 的 artifact helper。生成的 artifact MUST 使用 plugin API `1.2`、factory default export 和空 `hostExternals`，并 MUST 继续经过既有 trusted startup validation、静态 import scan、manifest validation 与 Agent policy activation；artifact helper MUST NOT 修改 system config、Agent bindings、RAG indexes 或 RAG provider selection。

**需求类别**：功能性需求

#### Scenario: 宿主通过factory提供runtime services

- **WHEN** 系统 materialize plugin API `1.2` factory
- **THEN** factory MUST 收到 closed `runtime` services
- **AND** configured policy 的 `decide` MUST 仍只接收既有 `run`、`context`、`signal`
- **AND** factory host MUST NOT 向该调用增加 router-specific Tool、Prompt、模型或候选选择操作

#### Scenario: 官方router独立调用受治理Tool

- **WHEN** 官方 `agent-router-plugin` 的 configured RAG 预筛被触发
- **THEN** plugin MUST 通过 runtime `CapabilityInvocationPort` 调用当前 Agent bound `Rag` Tool
- **AND** Tool MUST 继续经过既有 Capability governance

#### Scenario: 三参数policy contract保持不变

- **WHEN** core 调用任意已激活 routing plugin policy
- **THEN** 该 policy MUST 只接收语义不变的 `run`、`context`、`signal`
- **AND** official router 的 runtime service 使用 MUST NOT 改变其它 policy 的 contributions 或结果

#### Scenario: runtime services 不可用时安全失败

- **WHEN** plugin API `1.2` factory 所需 runtime services 在 readiness 前不可用
- **THEN** 系统 MUST fail closed 且 MUST NOT 接受请求
- **AND** MUST NOT 形成可被 Agent 激活的 router policy

#### Scenario: runtime services保持closed surface

- **WHEN** plugin API `1.2` factory读取宿主提供的 `runtime`
- **THEN** public object MUST 只包含本 Requirement 定义的六类 public ports
- **AND** plugin MUST NOT 通过通用扩展袋、动态 service name 或 inventory 获得未定义服务

#### Scenario: 生成可部署agent-router-plugin artifact

- **WHEN** 插件开发者调用 artifact helper 指定空目录
- **THEN** helper MUST 生成 `plugin.json` 与自包含单文件 `index.js`
- **AND** manifest MUST 声明稳定 plugin id、plugin API `1.2`、factory default export 对应 main 和空 `hostExternals`
- **AND** helper MUST NOT 创建或修改 system config、Agent definition、policy activation 或 capability binding

### Requirement: 本地runtime包携带agent-router-plugin但不默认激活

本地 runtime 打包 MUST 在每个 backend-capable candidate 中携带官方 `agent-router-plugin` artifact，目标目录 MUST 为 `config/plugins/agent-router-plugin/`。artifact MUST 至少包含 `plugin.json` 与自包含单文件 `index.js`。

随包携带 artifact 只表示 operator 可在 trusted system config 与目标 Agent policy 中显式启用。package config sample MUST NOT 为 `agent-router-plugin` 增加 `nextAgent.system.plugins[]` entry，packaging MUST NOT 修改默认 Agent 的 `policies[]`、capability bindings、RAG config 或模型配置。未显式配置并激活时，该 artifact MUST NOT 参与 routing。

**需求类别**：功能性需求

#### Scenario: backend-capable运行包包含未激活router artifact

- **WHEN** local runtime packaging stages a `backend-only` or `with-frontend` candidate
- **THEN** candidate MUST contain `config/plugins/agent-router-plugin/plugin.json`
- **AND** candidate MUST contain `config/plugins/agent-router-plugin/index.js`
- **AND** manifest MUST 声明 `pluginId=agent-router-plugin`、`apiVersion=1.2`、`main=./index.js` 与空 `hostExternals`
- **AND** `config/default-system.yaml` MUST NOT declare `agent-router-plugin` in `nextAgent.system.plugins[]`
- **AND** default Agent MUST NOT activate `agent-router-plugin.auto-routing`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：开发者可装配独立执行路由算法的官方模型驱动 plugin；plugin API `1.2` factory host 提供 closed runtime services，routing policy 保持三参数调用；backend-capable本地runtime包携带可直接配置但默认未激活的官方artifact。
- **依据 Requirements**：`插件 factory host 提供受治理 runtime services`、`本地runtime包携带agent-router-plugin但不默认激活`

### 输入

- **变更类型**：修改
- **目标内容**：plugin API `1.2` factory 接收 closed runtime services；routing policy executable 继续只接收 accepted `run`、`context` 与 cancellation signal。
- **依据 Requirements**：`插件 factory host 提供受治理 runtime services`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在 startup factory materialization 时提供稳定 runtime services，插件在请求时独立执行选择；既有 policy config 继续校验并冻结；随包artifact仍需显式配置和Agent policy activation。
- **依据 Requirements**：`插件 factory host 提供受治理 runtime services`、`本地runtime包携带agent-router-plugin但不默认激活`

### 结果

- **变更类型**：修改
- **目标内容**：官方 router 通过公共 runtime ports 独立完成受治理选择；services 未绑定时安全失败；三参数 policy contract 保持不变；backend-capable发行包可直接引用随包artifact但默认不激活。
- **依据 Requirements**：`插件 factory host 提供受治理 runtime services`、`本地runtime包携带agent-router-plugin但不默认激活`

### 规格

- **规格项**：plugin runtime host
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：plugin API `1.2` factory host 提供 closed `runtime` services；routing policy 调用仍为 `run`、`context`、`signal`
- **依据 Requirements**：`插件 factory host 提供受治理 runtime services`

- **规格项**：本地runtime包中的router artifact
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：backend-only与with-frontend包含`config/plugins/agent-router-plugin/{plugin.json,index.js}`，且不自动声明或激活router
- **依据 Requirements**：`本地runtime包携带agent-router-plugin但不默认激活`

- **规格项**：官方router plugin标识
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`pluginId=agent-router-plugin`、`policyId=agent-router-plugin.auto-routing`
- **依据 Requirements**：`插件 factory host 提供受治理 runtime services`
