# add-ts-task-trajectory

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
OpenSpec 归档：[`2026-06-24-add-ts-task-trajectory`](../../openspec/changes/archive/2026-06-24-add-ts-task-trajectory)
所属分组：Memory / Task Observation

状态：complete
类型：implementation
主要 owner：`agent-memory`
协作 owner：`agent-runtime`、`agent-observability`
依赖：`add-ts-memory-core`、`ship-ts-minimal-agent-kernel`

目标：
- 从 request run 中提取可审计任务轨迹，表达目标、约束、动作、事实和结果。
- 为长期记忆提取提供安全、可追踪、可测试的输入，而不是直接消费 raw prompt、raw model output 或 stream delta。

规格输入：
- Task trajectory SHALL be derived from canonical runtime facts and safe observation points.
- Trajectory facts MUST preserve run/session/agent/owner scope coordinates needed by downstream memory extraction.
- Task trajectory MUST NOT expose prompt text, raw model output, stream delta, credentials, local paths or raw provider errors.
- Memory extraction consumes trajectory projection as bounded input; it does not reinterpret runtime lifecycle state.
- Missing or incomplete trajectory input must degrade with safe diagnostic reason code and must not block terminal commit.

契约输入：
- 复用 runtime canonical timeline 和 memory extraction 输入边界。
- 复用 observability redaction/safe diagnostic vocabulary。
- 不新增 Web API、runtime command 或 gateway persistence owner。

实现约束：
- `agent-runtime` owns canonical lifecycle facts; `agent-memory` owns trajectory projection consumed by memory extraction.
- Projection 必须是 deterministic read/projection，不得产生 request lifecycle side effect。
- 不得把 raw conversation content、prompt、model response 或 high-cardinality local state 放入 trajectory audit facts。

非目标：
- 不改变 request lifecycle、terminal commit、stream projection 或 checkpoint semantics。
- 不定义通用 workflow event history。
- 不实现新的 long-term memory scoring 或 sharing policy。

验收要点：
- Tests cover normal trajectory extraction, missing source facts degradation and redaction boundaries.
- Memory extraction tests consume trajectory projection without depending on private runtime internals.
- Architecture review confirms runtime remains lifecycle owner and memory remains extraction owner.

并行边界：
- 可与 memory extraction/scoring changes 并行；本 change 只提供 trajectory input boundary。
- 不与 runtime lifecycle or timeline persistence changes 共享主 owner。
