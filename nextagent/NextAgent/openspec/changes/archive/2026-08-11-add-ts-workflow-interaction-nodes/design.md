## 背景和现状（Context）

interaction 节点族把 workflow graph 接到了 runtime pending input、Web stream projection、guardrail policy 和子流程递归执行上。它们既不是纯计算节点，也不是纯 capability 节点，需要严格落在既有 owner 边界上。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 明确 interaction 节点如何复用 runtime pending input 与 resume
- 明确 display / guardrail / delay / interrupt / sub-recipe 的执行语义
- 明确 pending input、checkpoint、sub-recipe mapping 和深度限制

**非目标：**
- 不提供交互式富 UI 组件
- 不提供自动超时恢复的 interrupt-gateway
- 不支持跨 recipe 隐式共享变量
- 不 owner主请求 dispatch、recipe 选择、通用 LLM 转换或 capability side effect

## 设计决策（Decisions）

1. `user-check`、`interrupt-gateway` 只复用 runtime pending input boundary，不新建 pending owner
2. `display-content` 只产生 safe text / markdown 投影，不产出 HTML / script
3. `guardrail-check` 通过已有 policy / hook 体系执行；现存 DSL token `guardrail_check` 仅作为兼容输入解析到标准 `guardrail-check`
4. `delay-gateway` 只依赖 scheduler + timer + `AbortSignal`
5. `sub-recipe` 的 DSL 输入字段保持 `recipe_name`；若内部执行契约存在映射，也不得反向修改 DSL 文案，并要求显式 `inputMapping` / `outputMapping`
6. user-check / display-content / guardrail-check / delay-gateway / interrupt-gateway / sub-recipe 的 node-specific schema 由本 change 定义；`agent-contracts/core` 不为这些字段冻结强类型

## 跨 Change 边界矩阵（Cross-Change Boundary Matrix）

- `package-composition`：负责 recipe load 和 startup wiring；interaction 节点只消费已装配 execution service / runtime boundary
- `workflow-routing`：负责主请求进入 workflow；`sub-recipe` 不得新建第二条 dispatch 规则，只能在当前 execution 内调用已注册 recipe
- `workflow-routing`：继续 owner WORKFLOW capability 可见性；`sub-recipe` 必须按当前 `agentId + recipe_name` 通过 app-composed recipe definition source 取回目标 recipe
- `workflow-execution-engine`：负责 waiting 前后的 execution 生命周期推进；interaction 节点只负责何时进入等待、何时产出投影或子流程结果
- `workflow-gateway-nodes`：负责基础控制流网关；`delay-gateway` / `interrupt-gateway` 是交互等待节点，不承担 `exclusive-gateway` 风格条件分支 owner
- `workflow-knowledge-nodes`：`recipe-choice` 负责产出 `recipe_name`；`sub-recipe` 只消费映射后的 recipe 名称，不重复做候选选择
- `workflow-llm-nodes`：负责通用 prompt assembly 和结构化模型输出；interaction 节点不得变成新的通用模型节点族
- `workflow-capability-nodes`：负责外部 tool / API / python / child agent side effect；interaction 节点不重建这类调用路径

## 触发机制（Trigger）

- interaction 节点 ready 时由 engine 触发
- `user-check` / `interrupt-gateway` 会把 execution 推入等待态，后续通过用户动作或外部 resume 异步继续
- `display-content` / `guardrail-check` / `delay-gateway` / `sub-recipe` 属于同步启动 + 异步等待完成

## 输入与前置条件（Inputs / Preconditions）

- 节点 `inputs`
- 当前 `contextVariables`
- runtime pending input / resume / cancel 边界可用
- 子 recipe 已注册且允许在当前 agent scope / owner scope 下执行

## 输出与副作用（Outputs / Side Effects）

- `user-check` / `interrupt-gateway` 产生 pending input 事实
- `display-content` 产生用户可见 stream projection
- `guardrail-check` 产生 pass / block 安全结果
- `sub-recipe` 产生子流程 safe 结果

## 核心判断逻辑（Core Decision Logic）

1. 识别节点类型与是否需要 pending input
2. 需要等待外部输入时，创建 pending fact 并暂停当前 execution
3. display / guardrail / delay / sub-recipe 按各自边界调用执行
4. 外部 resume 或用户回答返回后继续下游调度

## 状态 / 产物契约（State / Artifact Contract）

- `pending input`：语义为“workflow 节点等待外部动作的事实”，生命周期直到回答 / 超时 / cancel；owner 为 `agent-runtime`
- `display projection`：语义为“用户可见的安全内容投影”，消费方为 `agent-channel-web`
- `sub-recipe result`：与父节点 output 建立显式 mapping 关系，不共享隐式上下文
- `sub-recipe target`：必须经 recipe definition source `require(agentId, recipe_name)` 解析，禁止直接扫 recipe 集合

## 流程接入（Flow Integration）

- 上游：llm / capability / knowledge / gateway
- 下游：
  - `user-check` -> 用户回答后继续下游
  - `display-content` -> 直接继续下游
  - `guardrail-check` -> 后续 gateway / fail path
  - `sub-recipe` -> 将子结果映射回父 execution

## 失败与降级（Failure / Degradation）

- pending input 超时 -> 明确失败或按 `onError`
- external resume 缺失 -> execution 保持等待，不得静默继续
- `display-content` 非安全内容 -> 明确拒绝
- sub-recipe 深度超限 -> 明确失败

## 验收样例（Acceptance Examples）

- 正常路径：`user-check` 等到回答后继续执行
- 边界路径：`interrupt-gateway` 长时间等待外部 resume，execution 保持 waiting
- 失败路径：`guardrail-check` 返回 `block` 后走 fail path
- 递归路径：`sub-recipe` 在 3 层内正常完成，第 4 层明确失败

## recipe_result 契约对齐 DSL 规范

DSL 规范（docs/workflow/Recipe specification.md sub-recipe 节点）定义 `${recipe_result}` 为"子 Recipe 最后一个节点输出（map 结构）"。此前实现把 `${recipe_result}` 绑定为子 recipe 完整 `outputVariables`，偏离 DSL 规范。

本修正将 `${recipe_result}` 改为子 recipe answer node 的 `nodeResult.output`。answer node 定义为从 END 沿单前驱链反向遍历、跳过 gateway 节点（START/END/CONDITION/PARALLEL）、取第一个非 gateway 节点。该节点是 END 的最后一个非 gateway 前驱，即 DSL 所述"最后一个节点"。

### 父子 recipe answer 解析统一为 END 反向

同一套 recipe 逻辑下，一个 recipe 的 answer 节点不应因父/子角色而变。因此本次同时修正 `agent-core/agent/workflow-runtime-event-projector.ts` 的 `resolveAnswerNodeId`（父 recipe answer，决定哪个节点完成事件以 ANSWER 级高亮）和 `agent-workflow/nodes/shared.ts` 的 `resolveSubRecipeAnswerNodeId`（子 recipe answer，决定 `${recipe_result}` 绑定哪个节点 output），两者统一采用 END 反向解析：从 END 沿单前驱链回溯，跳过 gateway（START/END/CONDITION/PARALLEL），取第一个非 gateway 节点。

此前 projector 用 START 正向遍历，遇多后继 fork 即停止，在线性 recipe 上与 END 反向结果重合，但在带 fork/join 的 recipe 上会把 fork 前的初始化节点误判为 answer，而真正的汇总节点（join 后、END 前）被标为 DETAIL。END 反向解析对齐 DSL"最后一个节点输出"语义，使 fork/join 之前的分支结构不影响 answer node。父子统一后，同一 recipe 不论作父还是作子，answer 节点解析结果一致。

两个解析函数算法相同、方向相同，但因架构层规则（`agent-core` 不允许依赖 `agent-workflow`，见 dependency-cruiser.config.cjs layer 映射）和 `agent-contracts` 不承载纯导航函数的既定边界，无法共享单一实现。当前维持两份等价副本，各自注释互相指认；待边界扩展（如 `agent-contracts` 引入纯导航工具层）后统一。两份副本的等价性由 `recipeWithChain`（线性）和 `recipeWithForkJoin`（fork）projector 测试、`agent-workflow` 的 sub-recipe answer 测试共同钉死。

中间节点输出仍可通过父节点 `outputMapping` 从子 recipe `outputVariables` 显式映射，不进入默认 `${recipe_result}`。
### 边界与回退

- 子 recipe 无 END 节点或 END 无前驱 -> answer node 未定义 -> `${recipe_result}` 为空对象 `{}`
- END 前驱为多前驱 gateway（fork-join 直接接 END，无汇总节点）-> 无法沿单前驱链回溯 -> answer node 未定义 -> `${recipe_result}` 为空对象 `{}`
- answer node 执行失败或被跳过 -> `nodeResult.output` 为 `undefined` -> `${recipe_result}` 为空对象 `{}`
- 上述未定义情况均不回退为完整 `outputVariables`

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.5-执行交互节点` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-interaction-nodes/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**`Delay Gateway`、`Sub Recipe` 与 stable 正文不同，且 `Sub Recipe Answer Node Resolution` 尚未进入 stable spec。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
