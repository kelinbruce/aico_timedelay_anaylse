## 背景与问题（Why）

当前 router 已支持通过 trusted `routingConstraints.targetRecipe` 进入 workflow path，也存在按 skill 目标进入已有能力路径的概念，但用户在自然语言中显式指定执行目标时仍缺少统一、默认的入口约定。实际交互中会出现两类明确意图：

- 指定 skill 执行，例如 `$skill:nextagent-code-review`
- 指定 workflow 执行，例如 `$workflow:push-gate`

如果 router 只依赖自由文本意图识别，显式目标可能被误判为普通对话；如果把 workflow 复用到 skill 字段，后续 capability catalog、Agent Scope 校验、审计和测试都会出现语义混淆。该能力需要在 router 默认路径中收敛为一个确定的 directive 解析与路由约束生成规则。

## 变更范围（What Changes）

- 新增 router 对自然语言显式 capability directive 的默认识别：
  - `$skill:<name>` 表示请求指定当前 Agent Scope 可见的 skill capability
  - `$workflow:<name>` 表示请求指定当前 Agent Scope 可见的 workflow recipe capability
- 新增 directive 到 routing constraints 的唯一映射：
  - `$skill:<name>` 只生成 skill routing target，不承载 workflow 语义
  - `$workflow:<name>` 只生成 `routingConstraints.targetRecipe`
- 收窄 agent-web public submit 请求边界：
  - agent-web 请求体默认不得携带 `routingConstraints.targetSkill` 或 `routingConstraints.targetRecipe`
  - web 用户要指定 skill/workflow 时，必须把 `$skill:<name>` 或 `$workflow:<name>` 写入用户问题文本，由 router 从 accepted request text 解析生成目标 routing constraint
  - 非目标类 routing constraints（如 `forbiddenCapabilityIds`、`executionMode`、`maxToolCalls`）仍可按既有 schema 传递并由 governance 校验
- 明确 router 冲突和失败行为：
  - 同一请求出现多个不同显式 directive 时必须 fail closed 或进入澄清路径，不得静默选择
  - directive 指向不可见、未注册或类型不匹配 capability 时不得跨 Agent fallback
- 保持 UI slash command 和自然语言 directive 的边界：
  - `/skill`、`/workflow` 是 UI 命令入口
  - `$skill:`、`$workflow:` 是自然语言、文档和 AGENTS.md 中的显式执行引用
- 不改变 workflow execution engine、recipe durable store、skill manifest source、terminal commit 或 stream event 语义。

## Capability 影响（Capabilities）

### 新增 Capability

- `directive-capability-routing`: 定义自然语言显式 `$skill:` / `$workflow:` directive 的解析、校验和 routing constraints 映射边界。

### 修改的 Capability

- `workflow-routing`: workflow 显式目标除了 request-carried `routingConstraints.targetRecipe` 外，还可以由 router 默认 directive 解析产生；workflow 语义仍只进入 `targetRecipe`。
- `agent-routing-core`: agent-core/router 默认路由能力增加显式 skill/workflow directive 优先级、冲突处理和失败边界。

## 影响范围（Impact）

- `agent-core` router：增加 directive 解析、冲突判定和路由目标生成。
- `agent-contracts` routing constraints：确认 skill target 与 workflow target 的分离承载方式，不新增混合字段。
- `agent-channel-web` / task channel：只负责传递用户文本和非目标类 request constraints；agent-web 不暴露 `targetSkill` / `targetRecipe` public request 字段，不拥有 directive 语义。
- `agent-capability` catalog：继续作为当前 Agent Scope 下 skill 与 recipe capability 可见性校验来源。
- 测试：需要 contract、router 单元/集成、architecture negative case 覆盖 explicit directive、冲突、类型不匹配和 scope 隔离。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/directive-capability-routing/spec.md`：新增 directive 解析与路由映射契约。
- `openspec/specs/workflow-routing/spec.md`：补充 `$workflow:` directive 到 `targetRecipe` 的来源关系。
- `openspec/specs/agent-routing-core/spec.md`：若该 spec 已存在，补充 router 默认优先级、冲突处理和 fallback 语义；若不存在，归档时选择当前 agent-core routing 主承载 spec。

长期背景：
- `openspec/overview.md`：无，当前变更不改变产品范围。

设计视图：
- `openspec/designs/architecture/agent-routing.md`：补充自然语言 directive 到 routing constraints 的跨模块流程、Agent Scope 校验和失败边界。
- `openspec/designs/modules/agent-core.md`：补充 router ownership：解析 directive、生成 routing target、调用 capability catalog 校验，不执行 skill/workflow 本身。
- `openspec/designs/modules/agent-channel-web.md`：如已有对应模块文档，补充 channel 非职责：不拥有 directive 语义，并记录 web submit DTO 不接受 `targetSkill` / `targetRecipe`。
- `openspec/designs/adr/<id>.md`：无，除非归档前发现 `$skill:` / `$workflow:` 与 UI slash command 分层需要长期 ADR。
- `openspec/designs/spec-to-design-map.md`：新增 `directive-capability-routing` 到 routing 架构与 agent-core 模块设计的导航。

验证入口：
- `npm run test:contract`
- `npm test`
- `npm run lint:architecture`
- `openspec validate add-ts-directive-capability-routing --strict`
- `openspec validate --all --strict`
