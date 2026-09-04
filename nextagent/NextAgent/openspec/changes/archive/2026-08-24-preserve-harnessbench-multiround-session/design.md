## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.13 HarnessBench 评测` | 同一上游 session 的多轮请求复用候选持久化边界与 NextAgent session，不同执行保持隔离 | `harnessbench-evaluation` | `FN-10.13 HarnessBench 评测` |

## `FN-10.13 HarnessBench 评测`

### 目标与规范依据

本设计修正 TestHarness 对多轮 task 的生命周期所有权：同一上游 session 的首轮负责创建候选根和 NextAgent session，后续轮次只重启 local runtime 并向同一 session 提交新 request；产品 session、memory 和 context 行为保持不变。

#### 本 Function 的目标 Requirements

canonical spec：`harnessbench-evaluation`

- `ADDED`：`多轮任务保持会话连续且跨任务隔离`

设计约束：上游 session id 是不可信字符串，只能经过有界可读前缀与完整值 SHA-256 摘要形成候选目录 key；session 映射只位于对应候选根内，不进入报告、产品 contract 或 request body。HarnessBench 对同一 session 的轮次按顺序执行，本 change 不增加并发 round 调度。

### 当前实现

- `executeHarnessTask` 每次调用都对 `runRoot/candidates/<safe session id>` 执行递归删除，再复制 candidate template。
- 每次调用启动 local runtime 后都调用公开 `POST /api/v1/sessions` 创建新 session，并以返回值解析 execution workspace、提交 request 和读取 stream。
- 每轮 finally 都停止 local runtime；该停止动作本身不要求删除 candidate root。
- candidate root 当前只使用替换非法字符后的 session id，两个不同原始值可能映射到同一路径。
- 现有真实 local-runtime 集成测试只执行单轮，没有表达同 session 第二轮或不同 session 隔离。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 同 session 复用候选持久化与 NextAgent session | 每轮删除 candidate root 并新建 session | 第一轮持久化事实和 session identity 在第二轮前丢失 |
| 不同 session/task/run 隔离 | run 已隔离，但目录 key 只有字符替换 | 存在不同原始 session id 产生同形目录 key 的碰撞风险 |
| 首轮完整初始化后才发布复用状态 | 没有复用状态 | 缺少原子映射发布和不完整初始化恢复规则 |
| 非法复用状态安全失败 | 没有映射校验 | 缺少 schema、session identity 和 containment 校验 |

### 修改方案

1. `executeHarnessTask` 是候选生命周期唯一 owner：它通过 `harnessCandidateKey` 以 `safe prefix + SHA-256(session id)` 形成 `candidateKey`，并通过 `loadHarnessSessionState` 在 `runRoot/candidates/<candidateKey>` 下查找私有 `.harnessbench-session.json`。
2. 状态文件不存在时视为“未完成初始化”：删除该精确 candidate root 后重新从 template 复制，写入每轮端口配置并启动 runtime，通过公开 session API 创建 NextAgent session；只有 session 创建成功后才用同目录临时文件 + rename 原子发布映射。
3. 状态文件存在时先验证完整 JSON shape、固定 schema version、当前上游 session id 的 SHA-256、非空且符合安全标识格式的 NextAgent session id。任一校验失败抛出安全 `candidate_prepare/SESSION_STATE_INVALID`，不删除或使用现有状态。
4. 每轮仍重新生成 candidate 内的受信配置和 provider route，以获得本轮空闲端口；配置刷新不得删除 SQLite、workspace 或其他持久化事实。启动 runtime 后，已初始化轮次跳过 session create，直接使用映射中的 NextAgent session id。
5. execution workspace 继续由 public resolver 基于可信固定 Agent/Owner Scope 与复用 session id 解析。每轮导入当前 HarnessBench workspace、提交新 request、等待 terminal、导出结果，并在 finally 停止 runtime。candidate root 只由 run root 的生命周期清理，不由单轮执行删除。

私有状态：

| 字段 | 类型与约束 | trusted source | 用途 |
|---|---|---|---|
| `schemaVersion` | required integer，固定 `1` | TestHarness 常量 | fail closed 版本校验 |
| `upstreamSessionHash` | required lowercase 64 位 hex | CLI session id 的 SHA-256 | 防目录 key 碰撞及错配 |
| `nextAgentSessionId` | required non-empty safe identifier，最长 200 字符 | 成功 session-create response | 后续轮次公开 API 坐标 |

状态只存于候选根，使用前 candidate root 必须由 `resolve(runRoot, 'candidates', candidateKey)` 直接构造且 candidateKey 不含路径分隔符。状态不包含 credential、prompt、模型输出、Owner Scope 或主机路径。

#### 备选方案（Alternatives Considered）

- 多轮间保持同一个 Node/local runtime 进程常驻：能复用 session，但需要跨独立 generic CLI 进程管理 daemon、健康检查和清理，扩大生命周期与并发复杂度；不选择。
- 每轮新建 session，再把前序消息复制到新 session：会伪造产品 history/context 路径并掩盖 session persistence 缺陷；禁止。
- 仅停止删除 candidate root，但每轮仍创建新 session：能保留数据库，却仍不能验证同一 session 的连续性；不完整。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `多轮任务保持会话连续且跨任务隔离` | 原子状态发布、缺失状态重建、非法状态 fail closed、每轮 runtime 有界停止 | 同 session 复用、不同 session 隔离、不完整初始化恢复、非法 JSON/hash/session id 拒绝 |

## 验证策略（Verification Strategy）

- unit：验证候选 key 对同值稳定、不同同形字符串不碰撞；状态缺失、非法版本、hash 错配和非法 session id 产生安全失败。
- integration：使用真实 local runtime HTTP/SSE 与确定性模型连续执行同一个 HarnessBench session 两轮；第二轮断言复用相同 NextAgent session，并从 session history/context 获得第一轮事实。再以不同 upstream session 断言返回不同 NextAgent session。
- regression：HarnessBench 全套无凭据测试验证单轮执行、workspace bridge、报告、评分和既有 recovery profile 无回归；真实 `007-session-memory` profile 在凭据可用时按需运行。
- architecture/security：确认只修改 `tests/harnessbench/**` 与 active change，不改变 `packages/**`、公共 contract、产品默认配置或评分语义；路径派生、状态校验和报告安全边界经语义检视。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/harnessbench-evaluation/spec.md`：新增多轮会话连续与隔离 Requirement。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.13-HarnessBench评测.md`：同步处理过程和多轮会话连续性规格。
- `openspec/designs/features/D10-二次开发与平台集成/D10.3-测试与扩展/F-10.13-HarnessBench能力评测.md`：同步多轮 task 的可信评测价值。
- `openspec/overview.md`：同步多轮评测会话连续性摘要。
- `openspec/designs/architecture/e2e-quality-gates.md`：同步 TestHarness candidate/session 生命周期与隔离边界。
- `openspec/designs/modules/agent-test-kit.md`：无。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：更新 `harnessbench-evaluation` 摘要，不改变导航关系。

## 风险与取舍（Risks / Trade-offs）

- 每轮重启 runtime 依赖 SQLite 和 session store 的真实恢复能力；这正是多轮评测应覆盖的产品事实，失败时应由诊断定位而不是由 TestHarness内存缓存绕过。
- 首轮在 session 创建后、状态 rename 前崩溃会留下不完整 candidate；下轮因状态缺失删除并重建，避免使用孤儿 session。
- candidate 状态延长到 task/run 生命周期会增加临时磁盘占用；现有 run root 已拥有候选清理边界，不新增跨 run 保留。

## 待确认问题（Open Questions）

无。
