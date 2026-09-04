## 当前实现基线（Current Baseline）

### Guardrail contract 与 adapter

- `packages/agent-contracts/src/gateway/index.ts` 中的 `GuardrailGatewayPort` 当前提供 `checkQuestion`、`checkNl2Python` 和 `checkAnswer`。它没有知识内容校验操作。
- `packages/agent-platform-gateway-remote/src/guardrail/robotrouter-guardrail-gateway.ts` 是 RobotRouter 的 REMOTE adapter。三个现有操作都使用 `content-type: application/json`，自行建立 5 秒或 10 秒 timeout，并把调用方 `AbortSignal` 连接到内部 controller；provider options 只包含 `providerId`、`endpoint` 和测试用 `fetch`。
- question/answer check 当前把非成功 HTTP、网络失败、超时和非法响应收敛为 fail-closed 的 `isLegal=false`；nl2py 返回 `status=false`。现有 contract 没有可供 memory owner 区分“策略拒绝”和“依赖不可用”的知识校验结果。
- `tests/contract/guardrail-gateway-contracts.test.ts` 覆盖 REMOTE binding、question check 和 nl2py 的基本 wire mapping；现有测试没有知识接口、批量 item 对齐或 raw `detail` 泄漏断言。

### 长期记忆写入路径

- `packages/agent-memory/src/memory-tool-port.ts` 的 `saveLongTermMemory` 接收 `AbortSignal`，完成取消前置检查后直接调用 `LongTermMemoryStoreGateway.saveLongTermMemory`。
- `packages/agent-memory/src/long-term-memory-management.ts` 的 `saveLongTermMemory` 和 `manualSaveLongTermMemory` 接收 `AbortSignal`，经统一 `invoke` helper 直接调用 store。
- `packages/agent-memory/src/memory-extraction.ts` 对新 candidate 和现有记录的 source evidence fusion 都直接调用 `options.store.saveLongTermMemory`。完整 extraction cycle 已有 deadline signal，但 persistence store 方法不接收该 signal。
- 自动提取 candidate validation 已用本地静态模式拒绝部分 credential、token、路径和敏感用户特征；该检查只覆盖 extraction candidate，不能统一约束 tool 和 management 写入。
- `LongTermMemoryStoreGateway.saveLongTermMemory` 与 `manualSaveLongTermMemory` 是 persistence contract，不接收 `AbortSignal`。SQLite 实现拥有最终 request validation、CAS 和事务；它不调用其他 gateway。
- 当前有效输入中，`briefIndex` 最多 2048 个 Unicode code point，`content` 最多 4000 个；`labels` 最多 10 个。`saveLongTermMemory` 和 `manualSaveLongTermMemory` 都可能新增或更新文本。

### Composition

- `packages/agent-app/src/composition/memory-maintenance-composition.ts` 分别把 raw `longTermMemoryStore` 交给 memory tool port、extraction scheduler 和 aging scheduler。
- `packages/agent-app/src/composition/channel-composition.ts` 使用同一个 raw store 创建 `LongTermMemoryManagementService`。
- `GatewayBindings.guardrail` 已由 app composition 提供给 Web guard-forward 和 capability layer，但没有进入 memory composition。
- 当前三条长期记忆内容写入路径没有共享的 application write coordinator。直接把 `LongTermMemoryStoreGateway` 包装为同形 decorator 会丢失调用方 cancellation context，因为现有 persistence method 没有 signal 参数。

## 目标设计（Proposed Design）

### 1. 新增 provider-neutral 的知识校验 contract

接口定义沿用现有 guardrail 操作的组织方式：

- 方法命名使用 `checkKnowledge(input, signal?)`，与 `checkQuestion`、`checkAnswer` 和 `checkNl2Python` 一致。
- request/result 继续作为 `agent-contracts/gateway` 中的独立 interface，并使用 camelCase 字段；provider snake_case 只停留在 REMOTE adapter。
- 复用现有 `RobotRouterGuardrailProviderOptions`、`RobotRouterFetch`、provider readiness/binding、`content-type: application/json` 和 5 秒 timeout 模式，不新增第二个 provider 或 transport abstraction。
- 不修改 `checkQuestion`、`checkAnswer` 或 `checkNl2Python` 的方法签名和失败行为。

在现有 `GuardrailGatewayPort` 增加：

```ts
interface GuardrailCheckKnowledgeInput {
  readonly texts: readonly string[];
  readonly isPrivacy?: boolean;
}

interface GuardrailCheckKnowledgeResult {
  readonly isLegal: boolean;
}

interface GuardrailGatewayPort {
  checkKnowledge(
    input: GuardrailCheckKnowledgeInput,
    signal?: AbortSignal
  ): Promise<GuardrailCheckKnowledgeResult | SafeError>;
}
```

与现有 question/answer 操作把 provider failure 收敛为 `isLegal=false` 不同，知识校验必须让 memory owner 区分“内容被明确拒绝”和“依赖不可用/调用取消”：前者是不可重试的策略结果，后两者分别具有重试与取消语义。因此 `checkKnowledge` 使用 `GuardrailCheckKnowledgeResult | SafeError`，而不修改三个现有方法或为整个 guardrail port 引入新的统一 envelope。这是本 change 唯一的 guardrail result-shape 差异。

`texts` 的稳定 contract 是 1..5 个非空 string，每项 1..2000 Unicode code points。`isPrivacy` 在通用 contract 中保持 optional：调用方提供时 adapter 原样映射，缺失时 adapter 不发送 `is_privacy`，由 provider 使用默认值。长期记忆写入不是可配置例外，`agent-memory` 包内准入实现每次显式传 `true`。

REMOTE adapter 新增 `checkKnowledge` implementation，固定调用：

```text
POST /rest/naie/guardrail/v1/text/security/check
Content-Type: application/json
```

body 只包含 `texts` 和存在时的 `is_privacy`。本 change 不引入通用 Header factory，也不改变现有 question/answer/nl2py 请求。知识调用继续使用 question/answer 的 5 秒 timeout，并把调用方 cancellation 合并进内部 controller。

adapter 在 HTTP boundary 对 request 和 response 做 runtime validation。顶层 `is_legal` 只接受 boolean；item `is_legal` 按 provider wire 定义只接受精确字符串 `"true"` 或 `"false"`，并立即归一为 boolean。所有 HTTP 200 响应都必须包含与 `texts` 数量完全相同的 ordered items；缺失、数量不等或 item 值非法时返回 `GUARDRAIL_KNOWLEDGE_UNAVAILABLE`。结构合法后，顶层 false 或任一 item false 返回 `{ isLegal: false }`。adapter 不把 `detail` 放入 provider-neutral result。

错误映射固定为：

| 条件 | SafeError code | category | retryable |
|---|---|---|---|
| NextAgent 输入不满足 1..5 项、非空、每项至多 2000 code points | `GUARDRAIL_KNOWLEDGE_REQUEST_INVALID` | `VALIDATION` | false |
| RobotRouter HTTP 400 | `GUARDRAIL_KNOWLEDGE_REQUEST_INVALID` | `VALIDATION` | false |
| timeout、网络失败、非 400 非成功 HTTP、JSON 或 success body 非法 | `GUARDRAIL_KNOWLEDGE_UNAVAILABLE` | `UNAVAILABLE` | true |
| 调用方 signal 取消 | `GUARDRAIL_KNOWLEDGE_CANCELED` | `CANCELED` | false |

### 2. `agent-memory` 新增包内统一的写入准入实现

`agent-memory` 新增包内模块，由 memory tool、自动提取和长期记忆管理实现通过相对路径复用。模块可以用以下 implementation coordinator 组织内容准入和写入顺序：

```ts
interface LongTermMemoryWriteCoordinator {
  saveLongTermMemory(
    request: SaveLongTermMemoryRequest,
    options?: VersionedWriteOptions,
    signal?: AbortSignal
  ): Promise<LongTermMemoryRecord | SafeError>;

  manualSaveLongTermMemory(
    request: ManualSaveLongTermMemoryRequest,
    signal?: AbortSignal
  ): Promise<LongTermMemoryRecord | SafeError>;
}
```

`LongTermMemoryWriteCoordinator` 及其 factory 只允许从 `agent-memory` 内部模块导出给同包实现使用，不得从 `packages/agent-memory/src/index.ts` 或 `@nextagent/agent-memory` public package export 暴露。`agent-app`、`agent-channel-web` 和其他 package 不得 import、持有或传递该类型。它不是 `agent-contracts` contract，不成为新 port 或 gateway，不拥有 persistence validation、CAS、事务、读取、mutation、sharing 或 lifecycle。它复用原 request/record/write-options contract，不新增 memory DTO 或 Record。`LongTermMemoryStoreGateway`、`LongTermMemoryManagementPort` 和 `LongTermMemoryToolPort` 的方法签名全部保持不变。

`agent-app` 继续作为 composition root 选择 `LongTermMemoryStoreGateway` 与可选 `GatewayBindings.guardrail`，但只把这些既有依赖传给 `agent-memory` 的现有 public factories/options：

- `createLongTermMemoryToolPort` 的 options 接收可选 `GuardrailGatewayPort`，并在包内创建准入实现。
- memory extraction scheduler/cycle 的 options 接收可选 `GuardrailGatewayPort`，并在包内创建准入实现。
- `createLongTermMemoryManagementService` 的 dependencies 接收可选 `GuardrailGatewayPort`，并在包内创建准入实现。

三个入口复用同一个包内 factory、算法和失败映射，但 coordinator 无可变状态、缓存、幂等锚点或共享生命周期，因此不要求共享同一个对象实例。要求共享实例只会把 `agent-memory` implementation type 泄漏给 `agent-app`，不增加安全性或一致性。

选用包内 implementation coordinator 而不是同形 store decorator，原因是知识校验属于 remote 慢边界，必须消费调用方已经存在的 cancellation context；现有 persistence gateway 的 local atomic write 不承诺中途 abort，也不接收 signal。为本场景给 `LongTermMemoryStoreGateway` 增加 signal 会扩大 frozen persistence contract，且把 remote preflight 与 local transaction cancellation 混为一体。

包内 coordinator 的唯一执行顺序为：

1. 调用方沿用既有 schema/candidate validation，构造可信 scope 和 memory write request。
2. signal 已取消时返回 `LTM_CONTENT_GUARD_CANCELED`。
3. guardrail 缺失时直接调用 raw store，保持现有行为。
4. guardrail 存在时构造完整 admission text、分片和批次。
5. 按批次原始顺序串行调用 `checkKnowledge({ texts: batch, isPrivacy: true }, signal)`；任一批次不合法或失败立即停止。
6. 所有批次通过后再次检查 signal；未取消时调用 raw store exactly once，且不把 signal 传入 store。store 开始执行后沿用当前 atomic write 语义，不尝试中断事务。

取消上下文全部来自现有入口，不新增或修改长期记忆 port：

| 调用入口 | 现有取消来源 | 包内准入实现的使用方式 |
|---|---|---|
| `LongTermMemoryToolPort.saveLongTermMemory` | capability execution budget、RequestRun 取消 | 沿用已有 `signal`，只传给知识校验并在落库前复查 |
| `LongTermMemoryManagementPort.saveLongTermMemory` / `manualSaveLongTermMemory` | Web 请求 aborted/connection close | 沿用已有 `signal`，只传给知识校验并在落库前复查 |
| memory extraction | extraction deadline、scheduler cancellation | 沿用已有 deadline signal，传给知识校验并在落库前复查 |
| `LongTermMemoryStoreGateway` | 无 | contract 与调用方式保持不变，不接收 signal |

映射到 memory domain 的结果固定为：

| knowledge result | memory write result | 是否调用 store |
|---|---|---|
| 所有 batch legal | raw store result | 一次 |
| `{ isLegal: false }` | `LTM_CONTENT_GUARD_BLOCKED / POLICY_DENIED / retryable=false` | 否 |
| `GUARDRAIL_KNOWLEDGE_UNAVAILABLE` 或 adapter 非预期安全失败 | `LTM_CONTENT_GUARD_UNAVAILABLE / UNAVAILABLE / retryable=true` | 否 |
| signal canceled 或 `GUARDRAIL_KNOWLEDGE_CANCELED` | `LTM_CONTENT_GUARD_CANCELED / CANCELED / retryable=false` | 否 |
| `GUARDRAIL_KNOWLEDGE_REQUEST_INVALID` | `LTM_CONTENT_GUARD_UNAVAILABLE / UNAVAILABLE / retryable=false` | 否 |

最后一行表示 app 已生成违反 frozen guard contract 的请求，是安全配置/实现失败而不是用户可修正的 memory 内容；它 fail-closed 且不向外暴露 raw guard input。

### 3. 完整文本分片与批次算法

包内准入实现对 `saveLongTermMemory` 和 `manualSaveLongTermMemory` 使用同一个纯函数：

```text
admissionText = briefIndex + "\n" + content
codePoints = UnicodeCodePoints(admissionText)
fragments = consecutiveChunks(codePoints, maxSize=2000)
batches = consecutiveChunks(fragments, maxSize=5)
```

算法不 trim、不重新序列化 `content`、不读取 `labels`，也不在 fragment 中增加字段名、索引或省略标记。`fragments.flatMap(UnicodeCodePoints)` 必须严格等于 `codePoints`。所有调用按 batch 和 fragment 原始顺序执行。

按当前 write schema 最大值，admission text 最多为 `2048 + 1 + 4000 = 6049` code points，即最多 4 个 fragments，可在一次 `checkKnowledge` 调用中完成。包内准入实现仍按 5 项分批，以直接满足 `checkKnowledge` contract 并避免把 provider 容量假设散落到调用方。

### 4. 三条写入路径共享包内实现

`agent-app` 在 gateway layer 完成并冻结 `GatewayBindings.guardrail` 后，只把 selected guardrail binding 与既有 memory gateways 注入 `agent-memory` public factories：

```text
agent-app selected dependencies
  ├─ LongTermMemoryStoreGateway
  └─ GatewayBindings.guardrail?
             │
             v
agent-memory existing public factories/options
             │
             v
package-internal LongTermMemoryWriteCoordinator
             │
             ├─ checkKnowledge(..., signal)
             └─ raw store write
```

三个入口分别在 `agent-memory` 内部创建并使用 coordinator：

- `createLongTermMemoryToolPort`：`add_memory` 使用包内 coordinator；search/detail 继续使用现有 store/retriever。
- `createMemoryExtractionScheduler` / `runMemoryExtractionCycle`：新 candidate 和 existing-record save fusion 使用包内 coordinator；list/get/mutate 继续使用 raw store。
- `createLongTermMemoryManagementService`：save/manualSave 使用包内 coordinator；read/delete/mutate/retriever/sharing 继续使用现有 gateways。

`composeProductChannelLayer` 可以把 selected guardrail binding 作为 `createLongTermMemoryManagementService` 的 dependency，但不得接收 coordinator；`agent-channel-web` 仍只消费完成装配的 `LongTermMemoryManagementPort`。`memory-aging`、publish/copy 和其他非文本写操作继续接收 raw store/sharing gateway。现有长期记忆 port 的方法签名和 channel/capability 调用方式不变；`agent-app` 只负责依赖选择和注入，不构造 memory coordinator，也不实现分片、策略、错误映射或 memory 业务逻辑。

### 5. 调用方失败投影

- memory tool 直接消费包内准入实现返回的 SafeError，并沿用现有 capability result 投影；新增 guard codes 不改变 Tool、AgentLoop 或 RequestRun contract。
- extraction 在现有 `mapStoreError`/write outcome 边界把 `LTM_CONTENT_GUARD_BLOCKED` 映射为 `CANDIDATE_UNSAFE`，把 `LTM_CONTENT_GUARD_UNAVAILABLE` 保留为失败 reason。现有 cycle 聚合据此产生 SKIPPED、PARTIAL 或 FAILED。
- management service 沿用现有 `invoke` 和 Web SafeError mapping；`POLICY_DENIED` 与 `UNAVAILABLE` 使用现有 category-to-HTTP 规则，不增加 Web DTO。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证方向 |
|---|---|---|
| 安全 | 完整 `briefIndex + content` 在写前检查；任一失败均不落库；privacy 对 memory 固定为 true；labels 明确排除；provider `detail`、raw response 和文本不得出 adapter/diagnostic | 黑盒拒绝与 store-not-called tests；raw canary 泄漏负例；contract runtime validation |
| 性能/容量 | 单 fragment 上限 2000 code points、单 call 上限 5；按当前 memory schema 每次写最多一次 remote call、四个 fragments；batch 串行并遇阻即停 | 2000/2001/6049 边界测试；call count 与 fragment reconstruction 断言 |
| 可靠性/恢复 | guard enabled 时 fail-closed；guard 缺失保持现状；所有 guard side effect 完成后才启动一次 persistence write；store idempotency/CAS 不变 | timeout、HTTP、invalid body、cancel、retry 与 expectedVersion integration tests |
| 可维护性 | `agent-memory` 包内单一实现拥有策略，adapter 只拥有 wire，store 只拥有 persistence，app 只注入既有依赖；不复制三套分片逻辑、不暴露 coordinator 且不修改现有长期记忆 port | architecture dependency checks；public export 负例；三个入口共享实现的 tests |
| 可测试性 | 分片/批次为纯确定函数；guardrail 和 store 均可用既有 public contract stub；失败码和调用次数稳定 | unit、contract、integration、app composition tests |
| 审计/可追溯性 | 不新增包含内容的 audit；复用 capability/extraction/management 现有安全结果，最多记录稳定 reason code 和 bounded count | observability canary tests；人工审查无 `detail`、content、scope 进入 telemetry |

## 验证策略（Verification Strategy）

- **Unit**：验证 Unicode code point 分片、2000/2001/6049 边界、最多五片批次、完整重构、不读取 labels、串行 early-stop、cancel-before-store 和 exactly-once store ordering。
- **Contract**：以 mock RobotRouter 验证 endpoint、JSON Header、`texts`/`is_privacy` wire shape、string item normalization、item count、HTTP 400、timeout、invalid JSON/body 和 `detail` 丢弃。
- **Integration**：分别从 `add_memory`、extraction 和 management save/manualSave 触发包内准入，断言 pass 时写一次，blocked/unavailable/canceled 时零写入，并验证无 binding 的既有行为和现有 port 签名不变。
- **Architecture**：断言 RobotRouter 仍只能由 remote guardrail adapter 调用；`agent-memory` 不依赖 remote adapter；persistence gateway 不依赖 guardrail；`LongTermMemoryWriteCoordinator` 不从 public index 导出且不被 `agent-app`/channel import；app composition 只注入 selected dependencies。
- **Security negative cases**：使用可识别 canary 同时放入正文、provider `detail` 和 raw error，断言 SafeError、capability result、extraction diagnostic、Web response、log、metric、trace 和 audit 均不包含 canary；使用 label-only canary 断言它不进入 guard request。
- **Regression**：运行 backend build、unit、contract、architecture 和 strict OpenSpec gate，证明 memory lifecycle、terminal commit 和现有 guardrail input/output/nl2py 路径不变。

## 风险与取舍（Risks / Trade-offs）

- 知识校验增加 REMOTE memory write 延迟，并使 guardrail 故障阻断写入。按当前长度一次写最多一个 remote call，5 秒 timeout 和 fail-closed 与内容安全目标一致；依赖恢复后由同步调用方显式重试，extraction 由后续周期重试。
- `labels` 按产品决定不进入知识校验，因此 label 中的敏感文本不由本能力保护。现有 label 数量和长度 validation 保留；若未来要求检查 labels，必须修改 admission text contract，不能在 adapter 中静默加入。
- 固定长度分片可能把依赖跨片上下文的风险模式分开。当前约束保证每个 code point 都进入同一次 provider request的有序 `texts` 列表；是否需要 overlap 或语义分句不在 provider contract 中，当前实现不得自行插入或重复内容。
- 新 contract 允许 caller 显式传 `isPrivacy=false`，这是通用知识校验能力的一部分；memory 包内准入实现不暴露该选择并始终传 true。测试必须防止 app config、tool input 或 Web body覆盖该值。

## 已确认事项（Confirmed Decisions）

- **已确认（2026-07-27）：**群内已确认 frozen `GuardrailGatewayPort` 新增 `checkKnowledge` 以及 `GuardrailCheckKnowledgeInput`、`GuardrailCheckKnowledgeResult`，且不修改现有长期记忆 ports、Web DTO、stream event 或 persistence Record。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-8.2-检索和写入记忆` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/guardrail-gateway/spec.md`、`openspec/specs/memory-core/spec.md`、`openspec/specs/memory-extraction/spec.md`、`openspec/specs/memory-tools/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
