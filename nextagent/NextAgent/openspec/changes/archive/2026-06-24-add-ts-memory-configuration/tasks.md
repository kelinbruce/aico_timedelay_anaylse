## 0. 实施前置门禁

- [x] 0.1 确认 `add-ts-memory-core` 已在当前代码基线完成实施和验证，且 `LTM_DISABLED`、owner scope、核心 DTO/port、gateway-local store/retriever 装配和 search query 默认输入语义已经成为可消费 surface。
  验证：memory core contract/integration validation 记录可追溯，`agent-common`/`agent-contracts/gateway`/`agent-platform-gateway-local` 中的 memory port 与 store/retriever 已落地；若未满足，本 change 只能更新 OpenSpec，不得进入代码实施。归档顺序按 OpenSpec release 流程处理，不替代源码/测试核验。
  来源：proposal 交付状态与前置门禁、design 交付门禁

- [x] 0.2 确认当前 release scope 已纳入 Long-term memory 后置扩展实施，或已单独批准启动 `add-ts-memory-configuration`。
  验证：roadmap/release scope review 记录；若首版本地 release 仍排除 Long-term memory，本 change 仅保持规格准备状态。
  来源：`docs/nextagent-ts-change-roadmap-v2.md` 首版本地 release 不纳入的扩展候选

## 1. 配置契约与快照

- [x] 1.1 定义 `MemoryConfig` 运行时快照窄投影契约，覆盖 `enabled`、search 默认字段、配置状态和冻结后只读语义；不得把完整 `DefaultSystemConfig` 暴露为跨包 public contract。
  验证：contract test 断言字段、默认值和冻结后只读语义；运行 `npm run test:contract -- memory-configuration`。
  来源：`Memory configuration snapshot`、`Memory configuration namespace and defaults`

- [x] 1.2 定义 memory configuration schema 校验，覆盖布尔、数值范围、字段类型、未知字段和 owner 字段拒绝；在现有 `agent-app` 私有配置边界中更新 `RawDefaultSystemConfig.nextAgent` 和 `defaultSystemSchema`，使 `nextAgent.system?` 与 `nextAgent.memory?` 成为 sibling groups，且二者均不因对方存在而变为必填；后置 memory 子能力字段只能在 `nextAgent.memory.<owning-change>.*` 下注册，不得接收 `nextAgent.extraction.*`、`nextAgent.aging.*` 或独立运行时配置文件作为同等入口。
  验证：contract test 覆盖合法默认值、`search.default-limit=101`、`tenantId`/`subjectId` 字段、未定义 `nextAgent.memory.future.unreviewed-field` 字段、无 `nextAgent`、仅 `nextAgent.system`、仅 `nextAgent.memory`、二者同时存在、`nextAgent.extraction` / `nextAgent.aging` sibling group，断言非法配置失败或明确不生效。
  来源：`Memory configuration snapshot`、`Memory configuration namespace and defaults`

- [x] 1.3 将 app composition 的 memory 配置加载结果冻结为单一快照，并通过窄投影或注入依赖提供给已接入 memory consumers 使用。
  验证：integration test 构造 app composition，断言 memory gateway/core 测试替身和 capability 测试替身看到同一快照对象、同一快照版本或同一派生窄投影。
  来源：设计决策 1、`Configuration architecture boundaries`

## 2. 启停和失败语义

- [x] 2.1 实现 `nextAgent.memory.enabled` 缺失或为 `false` 到 `DISABLED` 快照的映射；只有显式 `true` 才进入 memory-enabled 配置路径。
  验证：integration test 分别省略 `nextAgent`、省略 `nextAgent.memory`、省略 `enabled` 和设置 `enabled=false`，断言 `MemoryConfig` 状态为 `DISABLED`，memory gateway/core 测试替身按 `LTM_DISABLED` 路径返回；另设 `enabled=true` 断言进入 `VALID` 且使用 search 默认值；不得要求内置 `default-system.yaml` 显式写入 `nextAgent.memory.enabled=false`。
  来源：`Memory configuration snapshot`、`Configuration failure and degradation semantics`

- [x] 2.2 实现非法配置 fail fast 或 unavailable 诊断，不允许 warn 后使用默认值继续成功。
  验证：negative startup/config test 分别注入越界数值、非法 owner 字段和未定义 memory 字段，断言应用不以 memory-enabled ready 状态启动或字段被明确标记不生效。
  来源：设计决策 2、`Memory configuration namespace and defaults`

- [x] 2.3 定义字段级 safe diagnostic，包含字段名、约束、reason code 和配置状态。
  验证：unit test 断言诊断包含字段和约束，不包含源配置全文、secret、路径或高基数字段。
  来源：`Configuration failure and degradation semantics`、`Configuration observability and redaction`

## 3. Memory 配置消费者边界

- [x] 3.1 将 memory gateway/core ports、后续 `agent-memory` 编排和显式接入的 memory consumers 的配置输入统一为消费冻结 `MemoryConfig` 或 app composition 派生的窄投影。
  验证：architecture test 或 dependency-cruiser 规则断言 consumers 不导入 app-private 配置实现；code review 检查点：无直接 env/source config 读取。
  来源：`Configuration architecture boundaries`、设计决策 1

- [x] 3.2 保持 context assembly、runtime lifecycle 和 channel stream projection 不因 memory configuration 改变。
  验证：architecture/characterization test 断言配置启用 memory 后不新增 context 自动注入路径、不新增 runtime terminal event、background job 或 stream event。
  来源：`Configuration architecture boundaries`

- [x] 3.3 确认 search 配置只提供默认 `limit` 和 `minConfidence`，不改变 memory core 排序公式。
  验证：contract test 断言配置快照不包含 ranking weight override；code review 检查点：memory core hybrid formula 不由本 change 修改。
  来源：设计决策 4

## 4. Agent 级描述和提示词覆盖

- [x] 4.1a 在 Agent assembly 中允许 `capabilityBindings[].description` 作为 safe description override fact，并在当前 release scope 未注册 memory tools provider 时拒绝非 memory Tool 或尚不可用 memory Tool 的覆盖请求，且不改变已有 builtin Tool descriptor。
   验证：Agent assembly contract test 断言非字符串 description 被拒绝或标记为无效，且 description 不改变 capability enable/disable、providerId、capabilityType、input/output schema、scope 或执行语义；integration test 断言 `builtin-tools/Read` description 不被 memory configuration 覆盖，并产生脱敏 `MEMORY_DESCRIPTION_OVERRIDE_REJECTED` 诊断。
   来源：`Agent-level memory description and prompt overrides`

- [x] 4.1b 在 `add-ts-memory-tools` 注册 `memory-tools` provider 和 `search_memory`、`get_memory_detail`、`add_memory` 后，将已绑定 memory capability 的 `capabilityBindings[].description` 投影为 trusted `ToolCatalogConfig.safeDescriptionOverride`，覆盖其 CapabilityDescriptor 的模型可见描述。
   验证：contract test 验证未设置→内置描述、`capabilityBindings[].description` 已设置→覆盖值生效、超出通用 Tool 描述上限（当前 512 字符）→截断 + `MEMORY_DESCRIPTION_TRUNCATED` 诊断；验证产品入口是已有 `agent.yaml` / Agent definition 的 binding 字段，`ToolCatalogConfig` 只作为 app composition trusted 投影存在，不作为用户直接编辑的独立配置文件。
   来源：`Agent-level memory description and prompt overrides`

- [x] 4.2 确认 memory configuration 不定义、解析、冻结或暴露 `promptTemplateIds`；memory extraction prompt selection 必须由 shared prompt registry / assembler 和 owning change 的 prompt purpose 处理。
   验证：integration/contract test 验证 `MemoryConfig` 不包含 prompt template ids；configuration 不产生 extraction prompt fallback、language unsupported 或 LLM strategy 诊断；`rg "promptTemplateIds|memory-extraction-" packages/agent-app/src/assembly packages/agent-contracts/src/agent-assembly` 无产品路径依赖。
   来源：`Agent-level memory description and prompt overrides`

- [x] 4.3 确保描述覆盖与已有 `agent.yaml` capability binding 解析和 app composition/capability Tool catalog 配置通道共享，提示词引用与已有 `agent.yaml` 解析和校验通道共享，不新增独立文件加载逻辑或单独 description section。
   验证：architecture/code review 检查点：不存在 `tools.yaml`、`memory-tools.yaml`、`memory.descriptionOverrides`、独立 override JSON、runtime/core/context 直接读取 `capabilityBindings[].description`，且 capability catalog 只消费 app composition 产出的 trusted Tool catalog 投影。
   来源：`Agent-level memory description and prompt overrides`

## 5. 可观测与脱敏

- [x] 5.1a 为配置加载成功、配置失败、memory disabled 和覆盖拒绝产生 structured log/metric。
  验证：observability test 捕获日志/metric，断言包含 stable event name、状态、reason code 和 bounded labels。
  来源：`Configuration observability and redaction`

- [x] 5.1b 在 `add-ts-memory-tools` 注册 memory tool catalog 后，为覆盖命中和超长截断产生 structured log/metric。
  验证：observability test 捕获覆盖命中和 `MEMORY_DESCRIPTION_TRUNCATED` 日志/metric，断言包含 stable event name、状态、reason code 和 bounded labels。
  来源：`Configuration observability and redaction`

- [x] 5.2 对配置、trusted override 和资源引用诊断执行脱敏，禁止输出完整 tool schema、prompt/template 内容、secret、token、附件内容和未脱敏路径。
  验证：redaction test 构造含敏感内容的非法 trusted override、非法 prompt/template ref 和配置，断言日志、SafeError、diagnostic、metric 不包含原文。
  来源：`Configuration observability and redaction`

## 6. 验证和收口

- [x] 6.1 运行 memory configuration 相关 unit、contract、integration、security 和 observability 测试。
  验证：`npm test -- memory-configuration`、`npm run test:contract -- memory-configuration`。
  来源：全部新增 requirements

- [x] 6.2 运行架构边界检查，确认配置实现未造成 private import、contract-to-implementation dependency 或 consumer 直接解析源配置。
  验证：`npm run lint:architecture`。
  来源：`Configuration architecture boundaries`

- [x] 6.3 运行 OpenSpec strict validation。
  验证：`cmd /c openspec validate add-ts-memory-configuration --strict`。
  来源：OpenSpec 变更验证门禁

## 7. 命名空间汇总和一致性审查

- [x] 7.1 仅在对应 memory change 已明确获准实施并通过自身 spec delta 定义字段后，更新 `MemoryConfig` 快照和 schema validation，汇总这些字段，确保命名空间注册中心承认已合并字段；字段物理路径必须保持在 `nextAgent.memory.<owning-change>.*`。
  验证：若 extraction/aging/maintenance 尚未获准实施，本任务保持未启动；若已获准，则 config contract tests 覆盖对应 `nextAgent.memory.<owning-change>.*` 字段的校验和冻结。
  来源：design 决策 3；spec requirement "Memory configuration namespace and defaults"

- [x] 7.2 审查命名空间汇总规则仍保持单一实施路径：后置字段只能由 owning memory change 通过 spec delta 注册，configuration 只能汇总和校验已获准字段，不得提前定义 extraction/aging/maintenance/sharing 行为字段，也不得把后置字段注册为 `nextAgent.<owning-change>.*` sibling group。
  验证：design.md 决策 3、spec 的命名空间扩展规则和 tasks 7.1 一致；`rg "nextAgent.memory.extraction|nextAgent.memory.aging|nextAgent.memory.maintenance|nextAgent.memory.sharing" openspec/changes/add-ts-memory-configuration` 只出现非目标、示例或条件性汇总描述；`rg "nextAgent\\.extraction|nextAgent\\.aging" openspec/changes/add-ts-memory-configuration` 只出现 forbidden-path 验证描述。
  来源：design 决策 3；spec requirement "Memory configuration namespace and defaults"

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/memory-configuration/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/memory.md`。
- 按需更新 `openspec/designs/contracts/configuration.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`。
- 仅在后续 local memory 编排实际接入时，按需更新 `openspec/designs/modules/agent-memory.md`；core local store/retriever 不经 `agent-memory` wrapper。
- 按需更新 `openspec/designs/modules/agent-capability.md`。
- 按需新增或更新 `openspec/designs/adr/memory-configuration-boundary.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 memory 状态机、配置 schema、模块 owner 或接口语义。

