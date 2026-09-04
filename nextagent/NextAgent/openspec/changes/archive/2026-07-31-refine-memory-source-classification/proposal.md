## 背景与问题（Why）

长期记忆记录使用 `KnowledgeSourceType` 区分来源，管理界面将 `CONFIGURED` 展示为“用户设定”，将 `LEARNED` 展示为“智能沉淀”。当前管理界面的手工新增路径和模型可调用的 `add_memory` 路径都写入 `CONFIGURED`，导致智能体在问答执行中通过工具产生的记忆被展示为“用户设定”，无法反映实际产生入口。

本变更明确来源由受信入口确定：用户通过长期记忆管理界面发起的手工保存属于 `CONFIGURED`；智能体在请求执行期调用 `add_memory` 以及后台 `extraction`、`dreaming` 产生的记忆属于 `LEARNED`。本次只修订已冻结的 `memory-tools` 行为契约和对应实现。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 智能体在问答请求执行期调用 `add_memory` 新增记忆后，记录来源为 `LEARNED`，管理界面显示“智能沉淀”。
- 来源值由受信写入入口确定，不由模型工具输入选择。

**非目标：**

- 不新增、删除或重命名 `KnowledgeSourceType` 枚举值。
- 不改变管理界面手工新增路径；该入口继续写入 `CONFIGURED`。
- 不改变 `extraction`、`dreaming` 路径；这些入口继续写入 `LEARNED`。
- 不改变 `add_memory` 的触发条件、输入结构、`ACTIVE` 快速写入路径、幂等、owner scope、失败语义或结构化内容规则。
- 不迁移或重写本变更实施前已经持久化的记忆来源。
- 不改变来源筛选菜单、来源显示文案或共享记忆语义。

## 变更范围（What Changes）

- **修改** `memory-tools`：`add_memory` 构造 `SaveLongTermMemoryRequest` 时必须写入 `knowledgeSourceType=LEARNED`。
- **移除** `add_memory` 将智能体工具写入归类为 `CONFIGURED` 的既有行为。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `memory-tools`：新增“`add_memory` 来源由可信入口确定”需求，冻结智能体工具写入的 `knowledgeSourceType=LEARNED`。

## 影响范围（Impact）

- `packages/agent-memory/src/memory-tools.ts` 的 `add_memory` 保存请求构造。
- `packages/agent-memory/tests/memory-tools-provider.test.ts` 的工具写入契约测试。
- 长期记忆管理界面通过既有列表和详情投影观察到来源从“用户设定”变为“智能沉淀”；前端不需要新增映射或接口。
- Gateway、SQLite 数据结构、`agent-contracts` 公开类型、Channel DTO 和管理 API 数据结构保持不变。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/memory-tools/spec.md`：新增“`add_memory` 来源由可信入口确定”需求。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无。
- `openspec/designs/modules/agent-memory.md`：补充可信写入入口到 `KnowledgeSourceType` 的归类规则。
- `openspec/designs/adr/memory-tools-boundary.md`：补充 `add_memory` 属于 `LEARNED` 来源的长期决策。
- `openspec/designs/features/`：无。
- `openspec/designs/functions/`：无。
- `openspec/designs/spec-to-design-map.md`：仅在归档工具判断导航需要变化时更新。

长期基线更新由归档流程执行，不是实施阶段任务。
