## 背景和现状（Context）

当前 workflow 需要一个明确的实现载体，但这个 change 不应该承担 routing、调度和持久化责任。它的单一目标是：给 workflow 提供 package 边界和 startup wiring。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 创建 `agent-workflow` package
- 在 `agent-app` 中装配 `WorkflowExecutionService`
- 在启动期加载本地 recipe 文件，发布 `WORKFLOW` capability descriptor，并提供执行期 recipe definition source

**非目标：**
- 不做 recipe 数据库持久化
- 不做 intent routing
- 不做 engine 调度
- 不做 recovery / snapshot

## 设计决策（Decisions）

1. `agent-workflow` 只依赖 `agent-common` 和 `agent-contracts`
2. recipe 本地文件扫描归 `agent-app` startup owner
3. recipe 索引作为 `WORKFLOW` capability 进入 capability catalog；Recipe 只描述静态资源
4. 失败策略分两层：
   - wiring failure -> startup failure
   - 单个 recipe 文件非法 -> diagnostic + skip

## Package Boundary

package 公开面只需要：
- `.` -> `createWorkflowExecutionService`
- `./engine`
- `./nodes`

本 change 只建立骨架，不要求 engine 和 node handler 已经完整实现。

## Composition Wiring

`agent-app` startup 负责：
1. 创建 workflow service
2. 注入 `agent-core`
3. 加载本地 recipe 索引
4. 发布 `WORKFLOW` capability descriptor，并把 definition source 注入 workflow execution wiring

## Recipe Load

recipe load 只承接本地静态文件启动装配：

### 节点类型归一化（补充）

recipe loader 的 `normalizeNodeType` 同时支持连字符和下划线两种 YAML 风格的节点 type 别名，映射到内部大写枚举：
- `start-event` / `start_event` -> `START`
- `end-event` / `end_event` -> `END`
- `tool-choice` / `tool_choice` -> `TOOL_CHOICE`
- `guardrail-check` / `guardrail_check` -> `GUARDRAIL`

下划线别名与 `rag_index`、`api_choice` 等 YAML 字段命名风格保持一致。

- 默认路径：工程打包根目录（与 skills 根路径一致）下的 `recipes/` 与 `agents/{agentId}/recipes/`
- 两个默认路径都参与扫描；agent-specific recipe 用于覆盖或补充 root-level recipe 集
- 仅允许 workspace 内相对路径
- 使用 workflow minimal contract schema 校验

本 change 只把 recipe 作为进程内 capability descriptor 和 execution definition source 装配，不引入数据库表或持久化 owner。

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| package 边界 | T1 | build / architecture |
| app wiring | T2 | integration |
| recipe load | T3 | integration |
| path safety | T4 | security test |

## 风险与取舍（Risks / Trade-offs）

- [启动期 load 增加复杂度] -> 这是 startup composition 的合理职责
- [未来可能需要 durable recipe source] -> 由独立 change 处理，不预埋到当前 change

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.1-执行工作流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-package/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**`Composition Wiring`、`Local Recipe Loading`、`Recipe Path Ownership` 与 stable 正文不同。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
