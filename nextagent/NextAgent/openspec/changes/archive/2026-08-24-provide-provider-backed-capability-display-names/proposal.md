## Why

一线网络运维人员需要在执行详情中看到当前产品能力的业务名称，并在中英文界面中获得一致、可理解的过程标题。当前 Capability 名称分散在 Provider descriptor、前端构建期映射和 AICOConfig 中；当产品新增或调整 Tool、Agent、Skill、Workflow 时，界面名称可能与当前 Catalog winner 不一致，历史过程也不能统一依据当前语言重新呈现。

系统需要把稳定名称和本地化名称统一为 winner `CapabilityDescriptor` 的展示事实，并向已授权 Session 提供当前、无副作用的安全名称投影。Agent Web 应在 Session 创建或激活时前置获取该投影，以静态能力为主路径，同时在 Skill 获取成功或首次出现未知 Capability identity 时刷新，从而兼顾首屏体验、动态长尾和治理一致性。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Tool、Agent、Skill、Workflow Provider 通过 winner `CapabilityDescriptor` 提供 required stable `displayName` 和 optional `locales`，形成唯一 Capability 名称权威。
- Builtin 与产品扩展 Capability 使用同一 descriptor 机制；名称不改变 Capability identity、binding、availability、conflict winner、执行、权限或审计。
- 已授权浏览器按 Session 查询当前 Agent Scope 下全部 available winners 的安全名称投影；查询不接收 locale 或客户端提供的 Agent Scope。
- 展示查询只读取当前已发布、已生成或已安装事实，不触发远端搜索、同步、下载、安装、索引写入、正文读取或 workspace 写入。
- 展示查询由每个 current source 隔离单个资源的缺失、读取、解析、schema 校验或一致性失败；失败资源不形成 descriptor，其他合法 descriptors 继续进入既有 Catalog governance。Provider、root、registry、index、locator 整体不可用、超时或取消仍返回安全不可用。
- Agent Web 在 Session 创建或激活后与 conversation/history 并行预取；Skill 获取成功或首次出现未知合法 identity 时执行 Session-scoped single-flight 刷新。
- Agent Web 按“当前 UI locale 精确命中 → `en-US` → stable `displayName` → `capabilityId`”选择纯文本名称；`zh-CN` 与 `en-US` 是本 change 的完整产品验收语言。
- 仓库随产品交付的 builtin Agent 示例提供真实 `zh-CN`、`en-US` 名称，使完整服务可直接验收正向切换；Skill 中英文与无本地化资源、stable name、id 降级由独立 fixture 验证。
- live、history、local、immersive、collaborative 三种宿主和运行时语言切换共享同一资源投影与 resolver；历史不冻结执行时名称。
- 查询失败保留浏览器 last-good；last-good resource 仍按 stable `displayName` 参与降级，没有 last-good 时按 `capabilityId` 降级，不阻塞事件、历史、最终答案或其他界面。

**非目标：**

- 不给 `CapabilityCatalogRequest`、`CapabilityResolveRequest`、`CapabilitySearchCriteria`、`SkillCatalogQueryRequest`、Runtime Bootstrap 或 event/history contract 增加 locale。
- 不本地化 Capability `description`、非 Capability event、固定动作模板、状态、错误或详情标签。
- 不改变 ToolSearch、Skill acquisition、model-visible description、input/output schema、invocation、结果披露或 audit identity 的既有契约；stable `displayName` 的既有消费者继续使用该字段。
- 不新增 Gateway contract、Record、表、migration、名称持久化或 server-side Session snapshot。
- 不新增 Catalog generation、轮询、push notification、新 stream event、Provider/Executor 运行时注册、替换、卸载或回滚。
- 不修改 Skill manifest 的 authoring 字段、解析规则或 schema 合法性；相关兼容性问题由独立 Issue 跟踪。
- 不保证无明确失效信号的同一 `kind + capabilityId` 元数据变更在当前 Session 内即时刷新；Session 再次激活时重新读取。

## What Changes

- `CapabilityDescriptor` additive 增加 optional `locales.language[locale].displayName`；stable `displayName` 继续 required。
- Agent package、Workflow Recipe、Tool authoring additive 支持同形展示事实；Skill 既有 `metadata.zh-name`、`metadata.en-name` 分别投影为 `zh-CN`、`en-US`。
- Tool authoring additive 增加 optional stable `displayName`；`name` 继续作为 Tool identity 和模型调用名称，descriptor stable name 使用 `displayName ?? name`。
- Capability discovery 的无副作用 current-read contract 保持返回合法 descriptor 数组；各 source 在形成 descriptor 前跳过单个失败资源，同一 Catalog 继续只对合法 descriptors 形成 winner-only current view，不建立失败批次、第二个 Catalog 或名称 registry。
- `agent-contracts/runtime` additive 增加 Capability presentation resource query contract；Web 新增 `GET /api/v1/sessions/:sessionId/capability-presentation-resources`。
- Agent Web 在 Session 创建或激活时预取完整 current projection，并对已接受的 `acquire_skill` 成功 completion 或首次未知 identity 执行合并刷新；语言切换只在浏览器重新选择名称。
- **BREAKING**：`AICOConfig` 删除 `capabilityBusinessNames` 及只服务该字段的 supporting types、校验、默认值和消费路径；其他 AICOConfig 字段与三宿主注入方式不变。
- 前端 Capability 名称硬编码映射退出名称权威路径；wrapper 动作模板、状态文案、安全过滤和 id 降级继续由 Agent Web 负责。

## Feature 影响（Features）

### 修改的 Feature

- `F-2.4 查看请求状态`：Capability 过程标题使用当前 Session 的受治理 Provider 名称，并可随界面语言切换重新选择；过程结构与结果安全边界不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.1 管理能力目录` → canonical spec `capability-source-configuration`
  - 变化边界：统一 descriptor 展示事实、无副作用 current view 和 Session-scoped 安全名称查询。
  - 系统质量属性：安全、可靠性/恢复、性能/容量、可维护性、可测试性。
- `FN-3.2 编译智能体装配` → canonical spec `agent-package-assembly`
  - 变化边界：Agent package 的本地化名称进入 runtime-ready assembly 和 Agent descriptor。
  - 系统质量属性：安全、可维护性、可测试性。
- `FN-9.1 执行工作流` → canonical spec `workflow-contracts`
  - 变化边界：Recipe stable `displayName` 与 optional `locales` 进入 Workflow descriptor；执行语义不变。
  - 系统质量属性：安全、可维护性、可测试性。
- `FN-10.2 装配插件` → canonical spec `agent-scoped-plugin-composition`
  - 变化边界：Plugin Tool authoring 可以提供 stable `displayName` 和 optional `locales`，并进入统一治理路径。
  - 系统质量属性：安全、可维护性、可测试性。
- `FN-2.4 查看请求状态` → canonical spec `ts-run-status-visibility`
  - 变化边界：三宿主 live/history 通过 Session presentation resources 和当前语言生成标题，并按确定规则刷新与降级。
  - 系统质量属性：安全、可靠性/恢复、性能/容量、可维护性、可测试性。
- `FN-10.6 前端定制` → canonical spec `aico-config-contract`
  - 变化边界：AICOConfig 不再承载 Capability 名称，保留纯前端外观与行为定制边界。
  - 系统质量属性：安全、可靠性/恢复、可维护性、可测试性。

## 影响范围（Impact）

- Provider 作者可以在现有 authoring facts 中提供 stable 与本地化名称；未提供 `locales` 时 Capability 仍保持可用。
- 既有 `network-explorer` Agent 只补充展示元数据，不新增 Capability，也不改变其 identity、binding、description 或执行路径。
- `agent-contracts/capability` 的 `CapabilityDiscovery.listCurrent` 保持返回 `Promise<readonly CapabilityDescriptor[]>`；`agent-contracts/agent-assembly`、`agent-contracts/core`、`agent-contracts/runtime` 和 Plugin SDK 发生 additive frozen contract 变化；AICOConfig public type 删除 Capability 名称字段。
- 新 Web API 需要 Session Owner Scope 校验，并复用持久化 Session 的可信 `agentId`；浏览器不能指定 Agent Scope。
- 现有 Runtime Bootstrap、Skill Catalog、Capability Catalog/Resolve、SSE、WebSocket、history、Gateway 和 persistence contract 不变。
- Agent Web 三宿主、live/history、语言切换、Capability process title 和 Skill 获取后的名称刷新受影响；结果披露与最终答案不变。
- 本 change 可独立验证：静态名称预取、中英文切换、SkillHub 已安装 Skill、运行期新 identity、无 `locales`、查询失败、confirmed missing、history 重算和三宿主同策。

## 需群内确认

以下 frozen contract 与 public compatibility 边界需要形成可追溯确认记录；未形成记录前不得进入生产代码实施：

1. `CapabilityDescriptor` additive 增加 optional `locales.language[locale].displayName`；stable `displayName` 保持 required。locale tag 复用项目现有 BCP 47-compatible grammar；本 change 完整验收 `zh-CN`、`en-US`，不建立固定语言白名单。
2. `AgentAssembly`、`RecipeDefinition` additive 增加同形 optional `locales`；`ToolMetadata`、`DefineToolInput` additive 增加 optional stable `displayName` 与 `locales`；Plugin SDK 保真暴露这些 optional 字段且不提升现有 Plugin API version。
3. `CapabilityDiscovery` additive 增加 optional、可取消的 `listCurrent`；新增窄 `CapabilityCurrentViewPort`，由现有 Catalog 实现并复用既有 binding、availability、priority 与 conflict winner。应参与的 SEARCH Provider 缺少 current-read，或 Provider/source 整体读取失败时，完整查询 safe unavailable，不 fallback 到 `search`，不返回 source-level failure 发生后的部分 winner。
4. `agent-contracts/runtime` additive 增加 `CapabilityPresentationResourceQueryRequest`、`CapabilityPresentationResource`、`CapabilityPresentationResourceQueryResult` 和 `CapabilityPresentationResourceQueryPort`；请求使用 trusted `identityContext`、`sessionId` 与从 Session 得到的 trusted `agentId`，不含 locale。
5. 新增 `GET /api/v1/sessions/:sessionId/capability-presentation-resources`；HTTP 请求不接收 body、locale、agentId 或 Provider 参数，响应只包含 `capabilityKind`、`capabilityId`、stable `displayName`、optional `locales`。
6. Agent Web 在 Session 创建或激活后前置预取；已接受的 live `acquire_skill` 成功 completion 和首次未知 identity 触发同一 Session-scoped single-flight 全量刷新。成功结果原子替换，失败保留 last-good，已解析但无 `locales` 不重复查询，完整成功后仍缺失的已观察 identity 在当前 Session 内不逐调用重试。
7. `displayName` 保留现有稳定名称消费者语义；Tool 或 Workflow stable `displayName` 的新投影可以改变 ToolSearch、Skill Catalog 等稳定人类名称输出，但不改变 identity、治理、路由或执行。
8. **BREAKING** 删除 `AICOConfig.capabilityBusinessNames` 和前端 Capability 名称硬编码权威；其他 AICOConfig、三宿主注入、wrapper 模板、状态文案和结果安全边界保持不变。
9. 本 change 不新增或修改 Gateway contract、Record、store、table 或 migration。Session route 仅复用现有 Session application read 取得可信 `session.agentId`；Capability 名称不进入 Gateway。

确认记录：以上九项于 2026-08-12 经群内评审确认通过，允许进入 frozen contract 与生产代码实施；后续实现、测试与文档必须保持字段、authority、failure、fallback 和 deferred 边界一致。

本次鲁棒性修复不新增或重新定义 `agent-contracts`：`CapabilityDiscovery.listCurrent` 与 `CapabilityCurrentViewPort.listCurrent` 的签名和 descriptor 数组返回结构保持不变。单资源隔离属于内建 source 的读取实现；缺少 `listCurrent`、Provider 或 source 整体不可用、root/registry/index/locator 除 optional Skill root `ENOENT` 外整体失败、超时、取消、非法 descriptor 数组及 EAGER current facts 不完整仍使完整查询 safe unavailable。该修复不改变 Skill manifest 解析与 schema，按项目规则无需新增群内契约确认。
