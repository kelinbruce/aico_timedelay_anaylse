## 背景与问题（Why）

NextAgent 后端已经实现了 `targetSkill` 路由约束的完整执行路径：`RoutingConstraintsSchema` 接受 `targetSkill`，`TargetedSkillRouter` 在 Agent routing 阶段执行受治理的 Skill 调用，Web channel 的 `submitBody` 和 `convenienceSubmitBody` 已经透传 `routingConstraints`。用户提交请求时只需在 body 中携带 `routingConstraints: { targetSkill: "xxx" }` 即可定向执行指定 Skill。

然而，用户当前无法在提交请求前发现和选择可用的 Skill。后端没有暴露 Skill 列表查询接口，前端也没有 Skill 选择 UI。用户既不知道当前 Agent 有哪些 Skill 可用，也无法在对话中指定要执行的 Skill。这使得 `targetSkill` 路由能力对终端用户不可达。

本变更解决两个问题：
1. 后端缺少 Skill 列表查询 API，用户无法发现可用 Skill。
2. 前端缺少 Skill 选择组件，用户无法在对话前指定目标 Skill。

## 变更范围（What Changes）

### 后端

- 新增 `GET /api/v1/skills` 只读端点，支持分页查询（`pageNum`、`pageSize`）和可选关键字模糊搜索（`keyword`）。
- 响应包含 `total`、`pageNum`、`pageSize` 和 `skills` 数组，每个 skill summary 包含 `capabilityId`、`displayName`、`description`、`providerKind` 和可选 `version`。
- 新增 `SkillCatalogQueryPort` runtime contract，由 `agent-app` composition 实现并注入 Web channel。Web channel 通过该 port 查询 Skill 列表，不直接依赖 `CapabilityCatalog` 或 `AssemblyRegistry`。
- Skill 列表来源由现有 `CapabilityCatalog.listAvailable()` 聚合决定：所有模式返回 `BUNDLED`（builtin-skills）+ `LOCAL_DIRECTORY`（local-skills-system 和 local-skills-agent-owned）Skill；REMOTE deployment mode 额外返回 `SKILL_HUB` Skill。`local-skills-agent-owned` Skill 经过 agent-owned source authorization 校验。本变更不改变 catalog 源聚合逻辑，只做投影。
- 当前版本仅支持单 Agent 模式：`GET /api/v1/skills` 使用 hosted `activeAgentId` 而非 session-bound `agentId`。既有 session 内展示 Skill 时可能列出默认 Agent 的 Skill。未来支持多 Agent 时需增加 `agentId` 查询参数。
- 不修改 `targetSkill` 路由执行路径、`RoutingConstraintsSchema`、`TargetedSkillRouter` 或任何现有 routing/capability governance 行为。

### 前端

- 新增 Skill 选择栏组件，默认渲染在输入框上方 16px 处，宽度与输入框齐平。该位置作为未来输入框上方自定义组件区的第一个 slot。
- Skill 栏以圆角方块展示 Skill 名称，单行渲染，溢出时末尾显示"全部"按钮。
- 点击"全部"弹出 328px 宽的 Skill 列表 Modal，包含标题、搜索框和可滚动的 Skill 列表，支持分页加载（单页 50，无限滚动）和服务端关键字搜索（防抖）。
- 选中 Skill 后在输入框内以圆角 chip 形式展示（带 x 按钮），写入前端 state，提交时在 body 中携带 `routingConstraints: { targetSkill }`。
- 点击 chip 的 x 按钮取消选中，state 置空，后续请求不带 `targetSkill`。

## Capability 影响（Capabilities）

### 新增 Capability
- `web-skill-catalog`: Web channel 暴露的 Skill 列表查询 API，定义端点、请求参数、响应 DTO、scope 校验、来源聚合和安全边界。
- `skill-selector-ui`: 前端 Skill 选择组件的行为契约，定义 Skill 栏布局、全部 Modal、分页搜索、选中 chip 和 request 集成。

### 修改的 Capability
- 无。`targetSkill` 路由执行路径由 `targeted-skill-routing` 和 `routing-constraint-validation` 已有规格覆盖，本变更不修改其行为契约。

## 影响范围（Impact）

### 代码
- `agent-contracts/runtime`: 新增 `SkillCatalogQueryPort`、`SkillCatalogQueryRequest`、`SkillCatalogQueryResult`、`SkillCatalogSummaryEntry`。
- `agent-channel-web`: 新增 `GET /api/v1/skills` 路由、查询 schema、响应 DTO、projection；`WebChannelDependencies` 增加 `skillCatalog` 依赖。
- `agent-app/src/composition/create-app.ts`: 实现 `SkillCatalogQueryPort`，注入 Web channel。
- 前端代码库（非本仓库）：新增 Skill 选择栏组件、全部 Modal 组件、Skill state 管理、API 调用层。

### API
- 新增 `GET /api/v1/skills` 端点。
- 修改 `statusFor` 全局错误映射：`UNAVAILABLE` 从 fallback 400 改为 503。此变化影响现有 attachment 路由的错误状态码，需覆盖回归测试。

### 依赖
- `agent-channel-web` 新增对 `SkillCatalogQueryPort` 的依赖（来自 `agent-contracts/runtime`）。
- 前端新增对 `GET /api/v1/skills` 的 HTTP 调用依赖。

### 配置
- 无新增配置。Skill 来源由现有 `default-system.yaml` 中的 `deployment.mode` 和 capability provider 配置决定。

### 测试
- 后端：新增 `GET /api/v1/skills` 的 contract test（分页、搜索、scope、安全）。
- 前端：Skill 选择栏组件、Modal 分页搜索、选中 chip 和 request 集成的 UI 测试。
- E2E：用户选择 Skill 并提交请求的端到端流程。

## 归档前更新基线（Baseline Promotion Plan）

### 行为契约
- `openspec/specs/web-skill-catalog/spec.md`: 新增。Skill 列表查询 API 的行为契约。
- `openspec/specs/skill-selector-ui/spec.md`: 新增。前端 Skill 选择组件的行为契约。

### 长期背景
- `openspec/overview.md`: 需要补充 Skill 发现和选择能力的产品背景。

### 设计视图
- `openspec/designs/architecture/web-channel-api-surface.md`: 新增或更新。记录 Web channel API 表面新增 `GET /api/v1/skills` 的跨模块流程和 `SkillCatalogQueryPort` 边界。
- `openspec/designs/modules/agent-channel-web.md`: 更新。新增 `GET /api/v1/skills` 路由和 `SkillCatalogQueryPort` 依赖。
- `openspec/designs/spec-to-design-map.md`: 更新。新增 `web-skill-catalog` 和 `skill-selector-ui` 到 design 的导航。

### 验证入口
- `GET /api/v1/skills` contract test：分页、关键字搜索、scope 校验、安全投影。
- 前端组件测试：Skill 栏渲染、Modal 分页搜索、选中 chip、request body 集成。
- E2E 测试：用户选择 Skill → 提交请求 → 验证 `targetSkill` 路由执行。
