# agent-web-customization

规划入口：[roadmap-v2 扩展候选](../nextagent-ts-change-roadmap-v2.md)
所属分组：AgentWeb 前端
对应能力：F17 AgentWeb 定制
优先级：P2

状态：assumption-ready
类型：实施 change
主要 owner：`agent-web`
依赖：`agent-web-auth-control`

目标：
- 产品配置驱动 UI 定制（header icon / service name / featured components visibility）。
- 操作栏支持注入自定义功能（icon dark/light variants、display name zh/en、PIU component、interaction mode）。
- 启动时加载，不要求热更新。

规格输入：
- UI 定制配置命名为 `AgentWebCustomizationConfig`，由 app config 提供，启动时加载并校验。
- `AgentWebCustomizationConfig` 包含 `header: { iconUrl: string, serviceName: string }`、`featuredComponents: { visible: boolean }`、`operationBar: CustomOperationEntry[]`。
- 每个 `CustomOperationEntry` 包含 `id: string`、`displayName: { zh: string, en: string }`、`iconDark: string`、`iconLight: string`、`piuComponent?: string`、`interactionMode: "replace-panel" | "open-modal"`。
- 定制配置 MUST 经过 schema validation，非法配置在启动时产生 safe error 而非运行时崩溃。
- 定制配置不得包含 credential、secret、raw prompt 或 provider-private 信息。
- `iconUrl`、`piuComponent` 引用 MUST 经过安全校验（不允许 `javascript:` scheme、不允许相对路径越界）。
- 操作栏自定义功能的可见性 MUST 受 `agent-web-auth-control` 的 ops 权限控制约束。
- 定制配置在启动时加载后冻结，不要求运行时热更新、不定义热 reload 机制。
- 定制配置不改变后端 API 契约、request lifecycle、session 语义或 capability governance。

契约输入：
- `AgentWebCustomizationConfig`（`agent-channel-web` 或 `agent-app` config schema）：新增配置 schema。
- `CustomOperationEntry`（`agent-channel-web` 或 `agent-app` config schema）：操作栏自定义功能结构。
- `HostSiteContext` ops（`agent-web-auth-control`）：操作栏自定义功能可见性约束来源。
- app config（`agent-app`）：定制配置文件的加载和校验。

实现约束：
- `agent-web` 拥有前端 UI 定制渲染和操作栏自定义功能交互。
- 定制配置由 app composition 在启动时加载，通过 `agent-channel-web` 的 bootstrap endpoint 或静态配置暴露给前端。
- 操作栏自定义功能的 `piuComponent` 引用由前端解析，后端只提供配置不解析 component。
- `interactionMode` 的 `replace-panel` 和 `open-modal` 行为由前端实现，后端不感知。
- 定制配置的 schema validation 在 app composition 启动期完成。

非目标：
- 不定义热更新或运行时配置 reload 机制。
- 不定义 `piuComponent` 的前端渲染实现（由 `agent-web` 或宿主应用承载）。
- 不定义操作栏自定义功能的后端 API（操作栏功能为纯前端行为，不新增后端端点）。
- 不定义多租户的定制配置隔离（首版为 deployment 级配置）。
- 不改变 `agent-web-auth-control` 的 ops 权限契约（只消费 ops，不修改）。

验收要点：
- contract test：`AgentWebCustomizationConfig` 及子结构 schema 覆盖。
- security test：`iconUrl` 和 `piuComponent` 经过安全校验，不允许 `javascript:` scheme。
- resilience test：非法定制配置在启动时 fail-closed。
- architecture test：定制配置不侵入后端 API 契约或 request lifecycle。
- 验证：`npm run build`、`npm test`、`npm run test:contract`。

并行边界：
- 不修改 `agent-web-auth-control` 的 ops 权限契约（只消费 ops）。
- 不侵入 `agent-app` 的 config schema 核心字段（只新增 `AgentWebCustomizationConfig` 扩展字段）。
- `agent-web-question-recommendations` 可并行推进，两者不耦合。
- 不侵入 `agent-session`、`agent-runtime` 或 `agent-capability`。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
- 标为 `assumption-ready` 的条目在 proposal 阶段需显式固化默认假设（配置文件路径、`iconUrl` 安全校验规则、操作栏 entry 上限）。
