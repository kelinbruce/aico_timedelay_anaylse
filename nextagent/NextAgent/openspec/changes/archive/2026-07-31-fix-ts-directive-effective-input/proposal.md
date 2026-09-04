## Why

使用 `$skill:<name>` 或 `$workflow:<name>` 指定处理目标的用户，期望系统把 directive 解释为本次请求的路由控制信息，并把剩余文本作为真实问题。当前系统会把完整输入继续作为用户问题，导致 directive 出现在工作流变量、模型输入和会话历史中；重试与编辑还会继续传播该文本。该行为会改变电信告警诊断问题的实际输入，并使后续轮次持续携带与问题内容无关的路由语法，因此需要在请求进入下游处理前形成唯一的有效用户问题。

本 change 定义“有效用户问题”：从已接受输入中移除全部已成功识别的 capability directive 后得到的用户问题文本。Directive 派生的路由目标仍是请求级结构化事实，不属于有效用户问题。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 对有效 `$skill:` 和 `$workflow:` directive，系统只把 directive 用于本次请求的受治理路由，把有效用户问题用于工作流执行、模型输入和可见会话历史。
- 重复执行、重试、编辑和运行恢复保持相同的有效用户问题与结构化路由目标，不通过重新暴露或拼接 directive 恢复路由。
- 无 directive 的请求保持原有问题文本和路由行为；非法或冲突 directive 继续 fail closed。
- 用户可见历史和后续模型上下文不再累积已经成功解释的 directive。

**非目标：**

- 不改变 agent-web 禁止直接提交 `routingConstraints.targetSkill` 或 `routingConstraints.targetRecipe` 的边界。
- 不放宽 Agent Scope、Owner Scope、runtime Capability 治理、预算、取消或 forbidden constraint。
- 不自动改写 change 生效前已经持久化的历史消息。
- 不新增 public Web API、stream event、runtime command 或 `agent-contracts` 字段。
- 不改变 slash command、普通文本中不符合 directive grammar 的内容或模型生成的 Skill tool call 语义。

## What Changes

- **BREAKING**：已成功解释的 `$skill:` 或 `$workflow:` directive 不再作为用户消息内容、工作流 `input_question` 或模型输入的一部分。
- 系统在请求持久化和下游执行前生成有效用户问题，并把 directive 派生目标保存为结构化请求路由事实。
- 重试与运行恢复从已保存的有效用户问题和结构化路由事实重建请求，不再依赖用户消息中保留 directive。
- 编辑请求对编辑后的输入重新执行同一 directive 解析与有效问题生成规则。
- 相同 directive 的重复引用全部从有效用户问题移除并归一为一个路由目标；非法或冲突 directive 不产生可执行目标。

## Feature 影响（Features）

### 新增 Feature

无。

### 修改的 Feature

- `F-2.6 指定技能处理`：组成 Functions 增加 directive 定向请求处理；指定 Skill 时，下游只消费有效用户问题。
- `F-9.1 执行工作流`：组成 Functions 增加 directive 定向请求处理；指定 Workflow 时，工作流输入只包含有效用户问题。

### 移除的 Feature

无。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-2.8 指令定向请求处理` → `specs/directive-capability-routing/spec.md`
  - 功能边界：为既有 `directive-capability-routing` capability 建立唯一 Function 映射；系统从用户输入识别 `$skill:` 或 `$workflow:`，产生一个受治理路由目标和一个不含已解释 directive 的有效用户问题。
  - 系统质量属性：可靠性/恢复、可测试性。

### 修改的 Function

- `FN-2.6 指定技能处理` → `specs/targeted-skill-routing/spec.md`
  - 功能边界：指定 Skill 的治理与执行边界不变；directive 解析和有效用户问题生成收敛到 `FN-2.8`。
  - 系统质量属性：无新增黑盒质量目标。
  - 映射说明：`targeted-skill-routing` 是 canonical spec；本 change 不修改其 Requirement，只修正归档导航中的 legacy 多 spec 映射。
- `FN-9.2 加载和匹配配方` → `specs/workflow-routing/spec.md`
  - 功能边界：显式 Workflow 目标的匹配与执行边界不变；directive 解析和有效用户问题生成收敛到 `FN-2.8`。
  - 系统质量属性：无新增黑盒质量目标。
  - 映射说明：`workflow-routing` 是 canonical spec；本 change 不修改其 Requirement，只增加对 `FN-2.8` 结构化路由结果的既有消费关系。

## 影响范围（Impact）

- 用户提交包含 directive 的请求后，历史消息显示真实问题而不是路由语法。
- Workflow 节点、模型和后续会话轮次接收真实问题。
- retry、edit 和 local recovery 的请求事实恢复测试需要更新。
- directive parser、请求接受与消息持久化、Agent routing、workflow dispatch 和上下文组装相关测试受到影响。
