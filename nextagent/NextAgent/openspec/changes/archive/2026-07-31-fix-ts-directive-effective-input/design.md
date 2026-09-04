## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.8 指令定向请求处理` | 建立既有 directive capability 的唯一 Function 映射，并把路由目标与有效用户问题分离 | `directive-capability-routing` | `FN-2.8 指令定向请求处理` |
| `FN-2.6 指定技能处理` | 保持 Skill 治理路径，只消费结构化 target Skill 和有效用户问题 | 无 Requirement delta | `FN-2.6 指定技能处理` |
| `FN-9.2 加载和匹配配方` | 保持 Workflow 匹配路径，只消费结构化 `targetRecipe` 和有效用户问题 | 无 Requirement delta | `FN-9.2 加载和匹配配方` |

## `FN-2.8 指令定向请求处理`

### 目标与规范依据

本 Function 把用户文本中的 capability directive 解释为请求路由控制信息，并产生不含已解释 directive 的有效用户问题。历史、Workflow、模型和恢复路径必须消费同一对结构化事实。

#### 本 Function 的目标 Requirements

canonical spec：`directive-capability-routing`

- `ADDED`：`Directive 生成有效用户问题`
- `ADDED`：`有效用户问题成为持久化和执行事实`
- `ADDED`：`重试编辑与恢复保持净化语义`
- `ADDED`：`非成功解析不产生净化路由事实`

### 当前实现

- `agent-core` 的 `parseCapabilityDirective()` 扫描已接受文本，只返回 `kind` 与 `name`，不返回剩余文本。
- `DefaultAgentRoutingPolicy` 在 Agent execution 内解析 `RequestContext.acceptedInputText`；解析发生在 runtime 已持久化 USER message 之后。
- `agent-runtime` 在 submit/edit acceptance 时把原始输入同时写入 `RequestContext.acceptedInputText`、`flowVariables.input_question` 和 USER message content。
- retry 与 local recovery 从 USER message content 恢复 `inputText`，root message metadata 只保存 attachment 与 request model options。
- Workflow dispatch 从 `flowVariables.input_question` 生成 `WorkflowExecutionRequest.inputText`；context engine 从 message store 读取 USER content 生成模型消息。
- 当前 E2E 测试显式断言 `$skill:` 保留在模型 prompt；retry/edit characterization 显式断言 directive 保留在 `acceptedInputText` 和 `input_question`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| directive 生成结构化路由目标与有效用户问题 | parser 只返回目标 | 缺少唯一 normalization 结果 |
| USER history、Workflow 和模型消费有效用户问题 | runtime 在 routing 前持久化原始输入 | normalization 必须前移到 acceptance 写入前 |
| retry/edit/recovery 同形恢复 | retry/recovery 依赖 USER content 中的 directive | 必须持久化结构化 routing facts 并从 metadata 恢复 |
| invalid/ambiguous fail closed | core routing 已拒绝 invalid/ambiguous | 前移 normalization 不得把部分结果写成可执行 target |
| core 继续拥有 directive 语义 | runtime 不应实现 parser | acceptance 需要通过 composition 注入 core-owned projector |

### 修改方案

唯一实施路径如下：

1. `agent-core` 把现有 parser 扩展为 `normalizeCapabilityDirectiveInput(inputText, routingConstraints)`。成功结果包含：
   - `inputText: string`：删除全部已识别 directive token 后执行 `trim()` 的文本；
   - `routingConstraints?: RoutingConstraints`：在现有约束上加入唯一 directive-derived `targetSkill` 或 `targetRecipe`。
   `none` 返回原文本与原约束；`invalid`/`ambiguous` 返回原文本与原约束，使现有 core rejection 保持唯一失败 owner，且不产生部分 target。
2. `agent-runtime` 的 request lifecycle dependency 增加一个窄 `acceptedInputProjector` 函数。该 seam 只接收 `inputText` 与 typed `routingConstraints`，返回同形投影；runtime 负责在 session/Agent Scope 已确定后、USER message 与 run 写入前调用，但不解析 directive。
3. `agent-app` 在唯一 request runtime composition 中把 `agent-core` normalizer 注入 runtime。channel、frontend、context-engine、workflow 和 gateway 均不获得 directive parser。
4. submit 使用 projection 后的 command 构造 `RequestContext.acceptedInputText`、`flowVariables.input_question`、USER message content、run idempotency semantic 和后续 work item。edit 对 `editedInputText` 执行同一 projection。
5. root USER message metadata 增加 runtime-private `routingConstraints` JSON 值，值只来自 projection 后的 typed constraints。runtime 使用既有 `RoutingConstraintsSchema` 校验持久化 JSON 后再恢复；未知或非法 metadata fail closed，不把不可信 JSON带入执行。`agent-channel-web` 的 conversation 与 shared conversation 公共投影统一移除该 runtime-private 键，不扩张 Web DTO。
6. retry 与 local recovery 从 root USER message content 取得有效用户问题，并从 metadata 取得结构化 routing constraints。它们不重建 textual directive。Checkpoint 中已有 `flowVariables` 时保持 checkpoint 事实；fresh retry 使用有效用户问题重新构造 `input_question`。
7. `DefaultAgentRoutingPolicy` 保留 raw directive parser 作为低层 Agent execution 的既有入口，但 product submit path 在执行前已经转换为 structured constraints。Skill/Workflow 的已有 governed routing 顺序与 fallback 不变。

内部 projection shape：

| 字段 | 类型 | 必填 | trusted source | owner 与校验 |
|---|---|---|---|---|
| `inputText` | `string` | 是 | accepted submit/edit text 或已保存 USER content | `agent-core` 生成；runtime 只携带 |
| `routingConstraints` | `RoutingConstraints` | 否 | schema-valid incoming constraints 加 directive-derived target | `agent-core` 映射；runtime 在持久化恢复时用既有 schema 校验 |

选择注入函数而不扩展 `AgentRoutingDecision`：routing decision 只描述处理路径，不能同时承担用户内容投影；插件 policy 的 frozen public result shape 因此不变。选择 root message metadata 而不新增 Record/table：该 metadata 已是 retry/recovery 的 accepted request facts 载体，结构化 target 与 USER content 共享同一 request/message idempotency anchor，不需要第二套持久化事实。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `重试编辑与恢复保持净化语义` | clean USER content 与 schema-valid structured routing facts 同锚点保存；retry/recovery 从两者重建 | retry、edit、queued/executing recovery 的 target 与 effective text 一致 |
| 可测试性 | 无新增黑盒质量目标 | parser unit、runtime contract 与 product-path E2E 分层覆盖 | 不以私有调用顺序替代 history/workflow/model 可观察断言 |

## `FN-2.6 指定技能处理`

### 目标与规范依据

指定 Skill 的现有治理与执行结果不变；本设计只改变 directive 来源进入该 Function 前的输入形状。

#### 本 Function 的目标 Requirements

canonical spec：`targeted-skill-routing`

本 change 不新增或修改该 spec Requirement。

### 当前实现

`TargetedSkillRouter` 已消费 `routingConstraints.targetSkill` 或 routing decision 的 `skillName`，通过当前 Agent assembly 和 Owner Scope 的 capability governance 加载 Skill；成功后继续既有 model loop。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Skill 路由使用结构化 target，模型使用有效问题 | raw directive 同时用于路由解析和模型 USER message | 上游必须在进入 Skill 路由前分离 target 与问题 |

### 修改方案

不修改 `TargetedSkillRouter`、Skill invocation contract 或 model-facing Skill tool。`FN-2.8` 把 directive 映射到现有 `routingConstraints.targetSkill`；当前 Function 继续使用既有 governed path。模型从 clean persisted USER message 读取有效问题。

无新增黑盒质量目标。

## `FN-9.2 加载和匹配配方`

### 目标与规范依据

显式 Workflow 目标的现有匹配与执行结果不变；本设计只改变 directive 来源进入该 Function 前的输入形状。

#### 本 Function 的目标 Requirements

canonical spec：`workflow-routing`

本 change 不新增或修改该 spec Requirement。

### 当前实现

`DefaultAgentRoutingPolicy` 可以从 raw `$workflow:` 或 `routingConstraints.targetRecipe` 选择 recipe。`executeRecipeRoute()` 把 `flowVariables.input_question` 原样传给 workflow engine。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Workflow 使用结构化 `targetRecipe` 和有效问题 | raw directive 既决定 recipe 又进入 `input_question` | 上游必须在 dispatch 前分离 target 与问题 |

### 修改方案

`FN-2.8` 把 directive 映射到现有 `routingConstraints.targetRecipe`；当前 Function 继续使用既有 recipe resolve、miss fallback 和 `WorkflowExecutionService.execute()`。由于 runtime 已用 effective text 构造 `flowVariables.input_question`，workflow engine 无需新增 directive 逻辑。

无新增黑盒质量目标。

## 跨 Function 协作与端到端流程

`FN-2.8` 是 directive text 的唯一解释者，并在 request acceptance projection 中产出 effective text 与 typed routing target。`FN-2.6` 或 `FN-9.2` 只消费对应 target；runtime lifecycle 只携带并持久化 projection；context-engine 与 workflow 只消费 clean content。任一后续模块不得重新扫描 `$skill:` 或 `$workflow:` 以恢复路由。

## 验证策略（Verification Strategy）

- unit：验证 parser/normalizer 对 none、skill、workflow、重复、位置、invalid 和 ambiguous 输入的确定结果。
- contract/characterization：验证 submit/edit/retry/recovery 使用 clean USER content 与 schema-valid routing metadata；非法 persisted metadata fail closed。
- integration：验证 Agent core 对 structured target 继续进入现有 Skill/Workflow governed path。
- e2e：通过 Web submit 断言 history、Workflow input 和 model messages 不含 directive，retry/edit 仍保持目标。
- architecture：验证 directive parser 仍只位于 `agent-core`，product composition 必须注入 projector，runtime/channel/context/workflow 不实现平行 parser。
- negative case：直接 target Web request 继续拒绝；invalid/ambiguous directive 不进入 Skill、Workflow 或 model execution。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/directive-capability-routing/spec.md`：合并 effective user question、持久化和恢复 Requirements，并增加 `FN-2.8` metadata。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.8-指令定向请求处理.md`：新增 canonical Function。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.6-指定技能处理.md`：移除 `directive-capability-routing` legacy mapping，仅保留 `targeted-skill-routing`。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.6-指定技能处理.md`：增加 `FN-2.8` 组成关系。
- `openspec/designs/features/D9-Workflow编排/D9.1-工作流执行/F-9.1-执行工作流.md`：增加 `FN-2.8` 组成关系。
- `openspec/designs/functions/D9-Workflow编排/D9.1-工作流执行/FN-9.2-加载和匹配配方.md`：保持 `workflow-routing` canonical 导航，补充对 `FN-2.8` 的协作摘要。
- `openspec/designs/functions/index.md`：增加 `FN-2.8` 导航。
- `openspec/designs/architecture/workflow-execution-and-routing.md`：补充分离后的 target/text 跨模块路径。
- `openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-app.md`：同步 normalization owner、acceptance projection 与 composition。
- `openspec/designs/spec-to-design-map.md`：更新 directive capability 的 Function 与验证导航。
- `openspec/overview.md`：无。
- ADR：无。

## 风险与取舍（Risks / Trade-offs）

- 已存在的污染历史不会自动修复；避免把用户引用的 directive 示例误判为历史控制语法。发布后新请求与新会话不再产生污染。
- runtime metadata 是不可信持久化 JSON；恢复时必须 runtime schema validation，失败不得降级为无约束执行。
- 底层直接构造 runtime coordinator 的测试可能不经过 product composition。测试 seam 缺省保持 identity projection，仅用于非产品 harness；architecture test 锁定 `agent-app` 产品装配必须提供 core projector。

## 待确认问题（Open Questions）

无。
