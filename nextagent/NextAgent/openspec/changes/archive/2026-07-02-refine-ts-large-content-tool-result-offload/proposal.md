## 背景与问题（Why）

当前 large-content 基线（`large-content-references` capability）把 fresh tool / capability result 的处理阈值固化为 `inline-max-bytes = 8192 chars`、aggregate `= 16384 chars`、preview `= 1024 chars`。这套阈值是为"任何略大结果都尽早外置"设计的，但在电信网络智能体真实负载下暴露出两个问题：

1. **阈值过低，频繁触发不必要的存盘**。单条 8KB 即外置、聚合 16KB 即按大小依次外置，导致大量本可 inline 的中等结果被写入 `tool-results/<refId>.txt` 并退化成 1KB 预览，模型不得不反复 `read` 读回，turn 内往返成本高、缓存命中率低。真实工具结果（配置导出、拓扑快照、日志切片）动辄数十 KB，8KB 阈值既保不住上下文完整性，又徒增磁盘与读回开销。

2. **`Read` 放行是硬编码特例**。`read` 这类本就不应截断的工具（其结果分页语义已由工具自身保证）的放行逻辑散落硬编码，不可扩展。

本变更把 fresh tool result 的 large-content 策略收敛到"按真实容量分级"的统一处理逻辑，并把冻结决策的缓存保真语义显式化。

## 变更范围（What Changes）

### 阈值与默认值调整（BREAKING）

- `inline-max-bytes`（单结果外置阈值）默认值由 `8192 chars` 提升到 `50000 chars`（约 100KB）。超过该阈值的 fresh 文本结果 MUST 存盘为 `tool-results/<refId>.txt`，模型只收到约 `2KB`（`2048 chars`）的开头预览加 `file_path` 与 `read` 读回指令。
- `preview-max-chars` 默认值由 `1024 chars` 提升到 `2048 chars`。
- aggregate 阈值（同一轮并行工具结果聚合预算）默认值由 `16384 chars` 提升到 `200000 chars`。超预算时从最大块开始依次存盘替换为预览，直到总和降到预算内。
- 阈值为**固定默认值**（不可配置）；阈值语义（单结果超阈 → `PERSISTED_PREVIEW`；聚合超预算 → 按大小从大到小 offload）保持不变。

### Infinity 工具策略

- host 在 externalizer 装配时把某工具加入 `infinityToolNames` 集合（默认含 `Read`），等价于该工具阈值置 `Infinity`——其结果 MUST 永不外置 / 截断，即使超过单结果或聚合阈值。Infinity 是 per-tool 的，不传播。

### 冻结决策与缓存保真

- 已在本轮 / 前序处理过（已写入 `replacement` evidence）的结果 MUST 冻结决策：后续重放原样复用既有 `SessionMessage.content` / `metadata.replacement`，不重新计算阈值、不重新外置、不改写 model-visible 形态，以保住 prompt cache 命中。该语义已在基线中存在（`frozen-from-prior-decision`），本变更将其显式约束到"同一轮并行批次内的冻结 + 原样重放"路径。

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改的 Capability

- `large-content-references`: 修改"Large content is externalized by policy"、"Large-content thresholds and configuration are fixed"、"Model-visible large content has stable replacement forms"三个 requirement 的默认阈值、preview 上限、`infinityToolNames` 注入与冻结重放语义。

## 影响范围（Impact）

- **代码**：`packages/agent-context-engine/src/large-content/`（`thresholds.ts`、`applier.ts`、`aggregate-offloader.ts`、`classifier.ts`、`preview-reader.ts`、`index.ts`）；`packages/agent-app/src/composition/large-content-externalizer.ts`（`infinityToolNames` 注入）。
- **契约**：`agent-contracts/session` 的 `ReplacementEvidence` schema 不新增字段；reason code 词表不新增（复用 `size-above-inline-threshold` / `aggregate-above-budget` / `empty-output` / `frozen-from-prior-decision`）。
- **测试**：`packages/agent-context-engine/tests/large-content-*.test.ts`、`packages/agent-app/tests/large-content-externalizer.test.ts`、`tests/architecture/large-content-cross-baseline.test.ts` 需按新阈值与 Infinity 路径更新。
- **运维 / 缓存**：阈值上调后单轮 inline 体积增大，prompt cache 命中率与每轮 token 成本随之变化；冻结重放路径保住跨轮 cache。

## 归档前更新基线（Baseline Promotion Plan）

归档前需提炼以下长期基线：

- `openspec/specs/large-content-references/spec.md`：更新"首版默认值"小节的阈值数字（`50000` / `200000` / `2048`）、`infinityToolNames` 注入与冻结重放约束；同步对应 Scenario。
- `openspec/specs/large-content-readback/spec.md`：若 `read` Infinity 放行影响读回契约边界，补充说明。
- `openspec/designs/modules/agent-context-engine.md`：更新 large-content 模块核心设计落点（阈值常量、`infinityToolNames` 注入、冻结重放）。
- `openspec/designs/adr/`：新增一条 ADR 记录"阈值从 8KB/16KB 上调到 50KB/200KB、Infinity 工具"的取舍理由。
- `openspec/designs/spec-to-design-map.md`：补充 / 更新 `large-content-references` → ADR 与模块设计的导航。
- `openspec/overview.md`：补充本变更对缓存命中与单轮 token 成本影响的长期背景。
