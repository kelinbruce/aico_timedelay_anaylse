## 背景与问题（Why）

长期记忆当前可由 `add_memory`、自动提取和管理接口写入。自动提取只对部分候选执行本地静态敏感模式检查，模型工具写入和管理接口写入没有统一经过外部安全护栏；`LongTermMemoryStoreGateway` 也只负责持久化，不拥有内容安全准入。敏感知识可能因此进入长期保存、后续检索和模型上下文。

现有 `GuardrailGatewayPort` 已是 RobotRouter 的唯一受治理出口，但只提供问题、回答和 nl2py 检查，没有暴露知识内容安全校验。RobotRouter 的知识内容校验能够检查领导人、风控词、风控模型和可选隐私风险，适合作为长期记忆写入前的内容准入边界。

本 change 将“长期记忆写入准入”定义为：当 REMOTE guardrail binding 存在时，任何通过应用装配进入 `saveLongTermMemory` 或 `manualSaveLongTermMemory` 的文本内容必须完整通过知识内容校验后才能持久化；护栏未启用时保持现有长期记忆行为。

## 术语

- **知识校验分片**：由一条长期记忆的 `briefIndex`、一个换行分隔符和 `content` 按原始顺序组成的完整文本，以 Unicode code point 为单位连续切分得到的非空片段。每片最多 2000 个 code point，不重叠、不遗漏、不插入省略标记；`labels` 不属于知识校验文本。
- **知识校验批次**：按分片原始顺序组成的一次 `checkKnowledge` 请求；每批包含 1 至 5 个知识校验分片。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `GuardrailGatewayPort` 按现有 `checkQuestion`、`checkAnswer` 和 `checkNl2Python` 的定义方式提供知识内容校验操作：使用独立的 camelCase Input/Result、`checkKnowledge(input, signal?)` 方法、现有 RobotRouter provider/binding 和 adapter-owned wire mapping，并调用 `POST /rest/naie/guardrail/v1/text/security/check`。
- 长期记忆的模型工具写入、自动提取写入及管理接口新增或编辑共享同一个 `agent-memory` 写入准入边界。
- 长期记忆完整的 `briefIndex` 和 `content` 按每片最多 2000 个 Unicode code point、每批最多 5 片进行校验；所有批次全部通过后才允许一次持久化。
- 长期记忆调用显式启用隐私检查；通用知识校验 contract 保留调用方选择 `isPrivacy` 的能力。
- 任一分片违规、护栏不可用、响应非法或调用取消时不产生长期记忆写入，并向同步调用方或自动提取任务返回稳定、安全、可诊断的失败结果。

**非目标：**

- 不校验长期记忆 `labels`、`source`、scope、标识符、confidence、version 或其他非正文持久化字段。
- 不对命中内容做局部脱敏、模型改写或“写入后删除”；本 change 只允许整次写入放行或拒绝。
- 不修改 `LongTermMemoryStoreGateway`、`LongTermMemoryManagementPort`、`LongTermMemoryToolPort` 的方法签名，不修改 SQLite schema、remote memory wire contract 或长期记忆 Record shape。
- 不让 persistence adapter、Web channel、前端、模型或 capability 参数直接调用 RobotRouter。
- 不为 LOCAL 部署新增 guardrail provider；没有 REMOTE guardrail binding 时保持当前写入行为。
- 不对只改变 confidence、pin、archive、访问统计等非文本事实的 mutation 执行知识校验。
- 不在本 change 中为 publish/copy 已有长期记忆增加重复校验或历史数据批量重检。
- 不新增 `System-Language`、`X-Product-Id`、`X-Tenant-Id` 或其他知识校验专属 Header；Header 行为与现有 guardrail adapter 调用保持一致。

## 变更范围（What Changes）

- **新增** `GuardrailGatewayPort.checkKnowledge` 及其 Input/Result contract。定义形态沿用现有 guardrail 方法：`checkKnowledge(input, signal?)`、`GuardrailCheckKnowledgeInput` 和 `GuardrailCheckKnowledgeResult`；input 暴露 `texts` 和可选 `isPrivacy`，每个 `texts` 元素最多 2000 个 Unicode code point，一次最多 5 个元素。知识校验额外允许返回 `SafeError`，用于区分内容拒绝、依赖不可用与调用取消，不改变三个现有方法的返回契约。
- **新增** RobotRouter REMOTE guardrail adapter 的知识校验调用。adapter 使用与现有护栏操作相同的 JSON Header、超时和 cancellation 边界，严格校验顶层结果与逐片结果，且不得向上游暴露 `check_results[].detail`。
- **新增** `agent-memory` 包内的统一长期记忆写入准入实现。它可以在包内使用 `LongTermMemoryWriteCoordinator` 组织内容准入和写入顺序，但该类型与 factory 不从 `@nextagent/agent-memory` public index 导出，也不进入 `agent-app` composition contract；它不是 gateway 或 `agent-contracts` contract，不改变任何现有长期记忆 port。读取、mutation 和 sharing 仍直接使用原 gateway。
- **修改** app composition：沿用 `checkQuestion`、`checkAnswer` 和 `checkNl2Python` 的既有模式，只把 selected `GatewayBindings.guardrail` 与长期记忆 store 传给 `agent-memory` 已有 public factories。memory tool、自动提取和长期记忆管理服务分别在包内复用同一准入实现，不共享或向外暴露 coordinator 实例；guardrail binding 缺失时保持原 store 调用。
- **修改**长期记忆失败语义：护栏明确拒绝映射为不可重试的内容安全失败；护栏超时、网络失败、非成功 HTTP、非法响应或取消分别映射为安全失败，且 store 不得被调用。
- **修改**自动提取诊断：知识校验拒绝作为 unsafe candidate 计入，依赖不可用作为写入失败计入，均不得改变来源 RequestRun 的 terminal state。

## 需群内确认

- **已确认（2026-07-27）：**在 `packages/agent-contracts/src/gateway/index.ts` 的 frozen `GuardrailGatewayPort` 中新增 `checkKnowledge`，并新增 `GuardrailCheckKnowledgeInput`、`GuardrailCheckKnowledgeResult` public contract。该操作扩展现有 guardrail gateway contract，不修改 `LongTermMemoryStoreGateway`、`LongTermMemoryManagementPort`、`LongTermMemoryToolPort`、Web DTO、stream event 或 persistence Record。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `guardrail-gateway`：新增知识内容校验 contract、RobotRouter wire mapping、完整响应校验和安全失败边界。
- `memory-core`：新增由 `agent-memory` 拥有的文本写入在持久化前通过知识校验的准入要求。
- `memory-extraction`：新增自动提取写入被护栏拒绝或护栏不可用时的任务结果语义。
- `memory-tools`：新增 `add_memory` 被护栏拒绝、护栏不可用或取消时的结构化失败语义。

## 影响范围（Impact）

- `packages/agent-contracts`：扩展 guardrail gateway public contract 和 runtime validation vocabulary。
- `packages/agent-platform-gateway-remote`：增加 RobotRouter 知识校验 adapter 实现与 contract tests。
- `packages/agent-memory`：增加包内统一的写入准入实现、分片/批次构造和 tool/extraction/management 行为测试；不公开 `LongTermMemoryWriteCoordinator`，现有长期记忆 port 签名保持不变。
- `packages/agent-app`：只把 selected guardrail binding 与长期记忆 store 注入 `agent-memory` 的既有 public factories，不持有或传递 coordinator。
- `packages/agent-channel-web`：管理接口继续消费既有 `LongTermMemoryManagementPort` 和 SafeError 映射，不新增请求或响应字段。
- 测试与验证：增加 contract、unit、integration、architecture 和安全负例，覆盖完整分片、五片批次、跨批次、拒绝、不可用、取消、无 binding、禁止记录 raw detail 及 store 未调用。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/guardrail-gateway/spec.md`：合并知识内容校验 contract、REMOTE wire mapping 和失败语义。
- `openspec/specs/memory-core/spec.md`：合并长期记忆文本写入准入不变量。
- `openspec/specs/memory-extraction/spec.md`：合并自动提取知识校验和失败结果。
- `openspec/specs/memory-tools/spec.md`：合并 `add_memory` 知识校验失败行为。
- `openspec/overview.md`：补充长期记忆内容安全准入范围。
- `openspec/designs/architecture/guardrail-flow.md`：补充知识校验到 memory write 的跨模块流程。
- `openspec/designs/modules/guardrail-gateway.md`：补充 `checkKnowledge` contract 与 adapter 责任。
- `openspec/designs/modules/agent-memory.md`：补充包内写入准入实现、分片批次、取消传播和失败边界。
- `openspec/designs/adr/`：无。
- `openspec/designs/features/`：无。
- `openspec/designs/functions/`：无。
- `openspec/designs/spec-to-design-map.md`：增加相关 spec 到 guardrail/memory 设计的导航。

长期基线更新由归档流程执行，不属于实施阶段任务。
