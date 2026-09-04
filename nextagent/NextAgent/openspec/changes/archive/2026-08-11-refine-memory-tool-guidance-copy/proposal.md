## Why

当前内置 memory 工具描述与 `SYSTEM_PROMPT/memory.md` 指导正文在"何时记/记什么"这一最关键策略面上信息不足且职责切分不清晰，导致模型在电信网络运维场景下经常错过用户明确给出的稳定偏好、历史信息更正、消歧确认和可复用排障经验，影响长期记忆命中率与跨会话一致性。

具体问题：

- `add_memory` 默认描述仅保留"用户明确要求记住"这一条触发条件，未覆盖用户更正历史信息、消歧后确认、稳定偏好/约束、任务执行异常可复用经验等电信运维高频存记忆场景；存记忆策略散落在 `memory.md` 而工具自身缺乏对应引导。
- `search_memory` 默认描述把检索触发、category 选择、`purpose` 语义、L1/L2 渐进披露压成一段长文，参数引导不够结构化，模型容易误用 `categoryFilter` 或忽略 `get_memory_detail` 的 L2 下钻路径。
- `get_memory_detail` 默认描述未明确"何时不调用"与单次 ID 上限，模型存在重复拉取全量详情或漏拉取的倾向。
- `memory.md` 与工具描述的职责边界过严：`memory.md` 被禁止承载任何与工具调用相关的最小提示，导致策略层与工具描述割裂，策略正文难以与工具参数引导形成连贯指引。

## 目标与非目标

目标：

- 把三个内置 memory 工具的默认 `CapabilityDescriptor.description` 文案升级为更结构化、更贴合电信运维存取记忆决策的版本，仍保留为 spec 固化的默认文案，Agent definition 仍可通过 `capabilityBindings[].description` 覆盖。
- 收紧 `memory.md` 与工具描述的职责边界：`memory.md` 继续以策略层为主（何时记、记什么、不记什么、何时检索、核验与边界），但允许承载与策略紧密相关的最小调用提示（如单次 ID 上限、按 category 的内容字段格式），仍不得重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义和 `nextAction` 回执等纯机制细节。
- 保持工具行为契约、输入输出 schema、scope 安全、失败语义、capability 暴露门禁、`memoryEnabled` 渲染门禁和 architecture 边界不变。

非目标：

- 不新增、不重命名、不退役 memory 工具或 Requirement；不改 tool input/output schema 字段；不改 `MemoryConfig`、memory-core、memory-extraction、memory-aging 行为。
- 不引入新工具（`update_memory`、`forget_memory` 仍不暴露）。
- 不改 Agent definition 通过 `capabilityBindings[].description` 覆盖描述的机制，不新增配置项或扩展点。
- 不改 `memory.md` 的 section 渲染顺序、`memoryEnabled` 渲染门禁、文件位置和 assembly 装配流程。

## What Changes

- `memory-tools` spec：MODIFIED 三个 Requirement 的"Default tool description"固化文案——
  - `search_memory L1 retrieval`：改为结构化"何时检索 + 参数引导"两段式，保留 `categoryFilter` 选择、`purpose` 仅对 `USER_CHARACTERISTICS` 生效、L1 摘要与 `get_memory_detail` 下钻的语义。
  - `get_memory_detail L2 retrieval`：明确单次最多 20 个 `longTermMemoryIds`、返回完整结构化字段、与 `search_memory` briefIndex 的衔接关系。
  - `add_memory structured write`：改为"引用 memory 策略段 + 按 category 列出内容字段格式"，内容字段格式仅作为最小调用提示，规范化仍由工具层负责。
- `prompt-template-assembly` spec：MODIFIED `System prompt memory guidance section` Requirement——放宽 `memory.md` 正文边界，允许承载与存取策略紧密相关的最小调用提示（如单次 ID 上限、按 category 的内容字段格式清单），仍 MUST NOT 重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义、`nextAction` 回执、文件路径、`MEMORY.md`、`update_memory` / `forget_memory`。
- `packages/agent-memory/src/memory-tools.ts`：把三段 `description` 替换为新固化文案（单 string 字面量，不再用 `+` 拼接）。
- `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md`：替换为新的策略正文，按 `search_memory` / `get_memory_detail` / `add_memory` 三个工具组织"何时用 + 何时存 + 不存什么"，包含首屏用户特征加载、按需召回、五类存记忆触发条件和最小调用提示。

## Function 影响（OpenSpec Capabilities）

- `FN-8.2 检索和写入记忆`（`memory-tools`，MODIFIED）：修改 `search_memory L1 retrieval`、`get_memory_detail L2 retrieval`、`add_memory structured write` 三个 Requirement 的默认工具描述固化文案与描述边界。
- `FN-10.4 自定义工具和提示词`（`prompt-template-assembly`，MODIFIED）：修改 `System prompt memory guidance section` Requirement 的 `memory.md` 正文边界。

## 影响范围

- `openspec/specs/memory-tools/spec.md`
- `openspec/specs/prompt-template-assembly/spec.md`
- `packages/agent-memory/src/memory-tools.ts`
- `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md`
- 相关 prompt-template-assembly 与 memory-tools 单元/契约测试（仅断言文案 / section 出现的测试需同步）
