## 设计范围

| Function | 变更类型 | 目标变化 | delta spec | 设计章节 | 唯一实现 owner |
| --- | --- | --- | --- | --- | --- |
| `FN-5.10 访问技能资源` | MODIFIED | committed Skill projection 的资源 authority 从 run lifetime 改为 execution-scope lifetime | `skill-resource-access` | `FN-5.10 访问技能资源` | `agent-capability` 的 `WorkspaceFilePort` |

本 change 只修改 Skill projection 的资源 authority 生命周期。Skill runtime Capability 的发现、激活和调用仍由当前 Agent assembly 与 capability governance 决定；execution scope 派生、sandbox 隔离执行和 gateway-local filesystem enforcement 的 owner 不变。

## FN-5.10 访问技能资源

### 目标与规范依据

目标是让身份与完整性有效的 committed Skill projection 成为其 execution scope 内持续、可恢复的只读资源 authority。资源 authority 不再绑定 `runId`，也不再依赖历史消息中的路径文本或当前 assembly 是否仍暴露对应 Skill runtime Capability。

本设计落地以下 Requirements：

- ADDED：`Skill projection scope authority 必须可从有效提交事实恢复`
- ADDED：`Skill projection scope authority 必须保持 execution scope 隔离`
- MODIFIED：`Skill resource access SHALL expose authorized resources through execution roots`
- MODIFIED：`Authorized Skill Projection Supplies A Bounded Python Module Root`
- MODIFIED：`Skill Scripts Use Workspace For Results And Temp For Intermediate Files`

### 当前实现

1. `packages/agent-runtime/src/execution-workspace/resolver.ts` 根据可信 `agentId`、`tenantId`、`subjectId` 和 isolation mode 派生 execution scope；`session` mode 额外纳入 `sessionId`。`runId` 不参与 `scopeKey`，物理根为 `<runtimeWorkspaceRoot>/<scopeKey>/`。
2. `packages/agent-capability/src/builtins/workspace-files/workspace-file-port.ts` 把成功投影的 Skill root 写入进程内 `authorizedSkillRoots`，该集合以 `agentId + runId` 为 key。Read、Glob、Grep 和 sandbox filesystem layout 只接受当前 run 集合中的 Skill root；`clearRun` 在 terminal cleanup 时删除该集合。
3. 同一文件中的 `reauthorizeSkillResources` 会重新校验 committed projection marker，再把 root 加入当前 run 集合。
4. `packages/agent-core/src/agent/default-agent.ts` 从 rendered context 扫描 `.nextagent/skills/<skillProjectionKey>/<skill-name>/` 路径，调用 reauthorizer，并注入 current-run refresh 消息。`packages/agent-capability/src/subsystem.ts` 通过公开的 `CapabilitySubsystem.skillResourceReauthorizer` 暴露该内部 port，`packages/agent-app/src/composition/request-runtime-composition.ts` 再把它接入公开的 `DefaultAgentDependencies.skillResourceReauthorizer`。
5. `packages/agent-capability/src/builtins/sandbox/sandbox-execution-port.ts` 消费 `WorkspaceFilePort.sandboxFilesystem` 产生的 roots；`packages/agent-platform-gateway-local/src/sandbox/restricted-local-sandbox.ts` 只负责挂载和执行约束。显式 Python script-path mode 按逻辑路径匹配一个 root，Python module mode 要求恰好一个 Skill root。
6. `packages/agent-capability/tests/skill-resource-projection.test.ts` 和 `packages/agent-core/tests/agent-routing-core.test.ts` 当前锁定 run-local authorization 和上下文补授权行为。

`fix-skill-resource-projection-refresh` 正在补偿第 2 点造成的跨 run 权限丢失，但其 current-run reauthorization 仍把 authority 生命周期绑定在 run 上。`normalize-skill-python-output-paths` 又把 `NEXTAGENT_SKILL_ROOT` 的可信来源写成 run-scoped authorization facts。本 change 必须在这两个 changes 完成并归档后实施，删除前者的补偿路径，并把后者的 Skill root 派生语义改为 execution-scope authority。

### GAP 分析

| 目标态 | 当前实现 | GAP |
| --- | --- | --- |
| committed projection 是 execution scope 内可恢复的 authority 事实 | authority 仅存在于 `agentId + runId` 内存集合 | run terminal 和进程重启会丢失 authority |
| 同一 scope 的任一 accepted run 可读取和显式执行有效 projection | 新 run 必须重新授权 | 物理 scope 生命周期与权限生命周期不一致 |
| authority 只来自可信 scope 内有效 committed projection | core 可从 rendered context 路径触发 reauthorization | 路径文本参与了权限恢复控制流 |
| 当前 assembly 不再暴露 Skill 时，已有 projection 仍可作为资源使用 | reauthorization 依赖当前 visible Skill descriptor | 资源 authority 与 Capability availability 被错误耦合 |
| `NEXTAGENT_SKILL_ROOT` 从当前 scope 的唯一 projection 选择结果派生 | 前序 change 规定其来自 run-scoped authorization facts | sandbox child environment 仍会继承错误的 run lifetime |
| gateway-local 只执行 filesystem policy | 当前边界基本满足 | 保持不变；不得把 scope/manifest 判定下沉到 gateway |
| temp 仍为 run-scoped，terminal 只清理 run-local state | `clearRun` 同时撤销 Skill roots | 必须拆除 Skill authority 的 terminal cleanup |

### 修改方案

#### 1. 以现有 committed projection 作为唯一持久 authority

`agent-capability` 的 `WorkspaceFilePort` 继续拥有 projection、文件工具授权和 sandbox filesystem layout。它必须使用 execution workspace resolver 返回的当前 `systemResources` 物理根作为可信 scope 边界，并在该边界内识别 `.nextagent/skills/<skillProjectionKey>/<skill-name>/`。

每个 Skill projection 已有的 committed identity marker、目标目录和完整性校验结果共同构成 authority 事实。实现必须复用现有 marker 校验和 safe path/symlink 约束，不新增 scope authorization index、数据库表、配置字段或第二套 hash/scope 派生逻辑。

`scopeKey` 不作为模型、Tool input、客户端 metadata 或新 public contract 传入。`WorkspaceFilePort` 必须仅消费 resolver 已解析的 execution view，避免在 capability 层重复 scopeKey 算法。

projection discovery 的判定顺序固定为：

1. 从当前 execution view 取得 `systemResources` root，并只检查其 `skills/` 直接子目录。
2. 跳过以 `.` 开头的 managed directories；候选目录名必须是 `skillProjectionKey`。
3. 读取候选目录直属的 `.projection.json`，按现有 manifest shape 校验 `schemaVersion`、`providerId`、`skillName`、`skillVersion`、`resourceCount` 和全部 resource entries。
4. 使用 manifest 的 `providerId + skillName + skillVersion` 重新派生 `skillProjectionKey`，结果必须与候选目录名完全相同；target root 必须恰好为候选目录下的 `<skillName>/`。
5. 复用 `projectionCommitted` 的完整树校验，逐项核对 path、kind、size、hash、file mode、symlink/hardlink 和额外文件。任一步失败都使整个候选 projection 不具备 authority。

精确路径访问先从逻辑路径取得 `<skillProjectionKey>/<skillName>`，再执行相同判定；全量 roots 操作按上述顺序枚举所有通过判定的候选。

#### 2. 按 scope 缓存已验证 roots，并从 committed facts 恢复

`WorkspaceFilePort` 删除以 `agentId + runId` 为 key 的 `authorizedSkillRoots` authority 集合，改为维护以 resolver 返回的 `systemResources.physicalPath` 为 key 的进程内 verified roots cache。该 physical path 是 scope identity 的内部结果，不对外发布，也不在 capability 层重新计算 `scopeKey`。

- 对精确 Read 或显式 sandbox script path，cache miss 时从逻辑路径解析候选 projection root，只校验当前 execution scope 内对应的 committed projection，并把成功结果加入当前 scope cache。
- 对 Glob、Grep、sandbox filesystem layout 和 Python module mode，当前 scope 第一次需要 root 集合时枚举并校验 `systemResources` 根下的 committed projection roots，随后复用该 scope cache。
- `projectSkillResources` 成功提交或刷新 projection 后，必须把通过提交校验的 root 写入当前 scope cache。
- 枚举必须排除 `.staging`、`.locks`、marker 文件、缺少提交身份、身份不匹配、完整性无效或越过 scope 边界的 subtree。
- cache entry 每次使用前必须确认 manifest 和 target root 仍存在、仍为当前 scope 内的普通目录且没有被 symlink 替换；条件不成立时立即删除 entry 并安全失败。projection cleanup 删除目录后不需要向 `WorkspaceFilePort` 发送反向失效事件。
- cache 只是 committed facts 的进程内验证结果，不是独立 authority：新进程或 cache eviction 必须按同一 discovery 规则恢复；`clearRun` 不得清理该 scope cache。cache 使用现有 bounded cache 上限和 eviction helper，不新增配置。

该路径允许 scope 内已存在且仍有效的 projection 在新 run 中直接复用，在新进程中通过首次 discovery 恢复；projection 被既有 cleanup 删除或校验失效后，下一次访问自然失去 authority。

#### 3. 删除 run reauthorization 补偿

目标态直接移除以下实现，不保留兼容 shim：

- `WorkspaceFilePort.reauthorizeSkillResources` 及其内部 input/result contract；
- `SkillResourceReauthorizer`；
- `RequestLocalCapabilityState.reauthorizedSkillRoots`；
- core 对 rendered context Skill path 的扫描、current visible descriptor 校验和 redisclosure 消息；
- `CapabilitySubsystem.skillResourceReauthorizer`、`DefaultAgentDependencies.skillResourceReauthorizer` 和 agent-app request runtime composition wiring；
- `clearRun` 对 Skill projection authority 的撤销。

`clearRun` 仍负责 snapshots、`temp/` 和其他既有 run-local state。Skill Tool 在成功激活时仍负责投影资源并在 generated Skill load message 中披露逻辑 root，但消息只用于模型导航，不再参与 authority 建立或恢复。

#### 4. 保持 sandbox 的唯一选择规则

`WorkspaceFilePort.sandboxFilesystem(context)` 必须返回当前 execution scope 内全部有效 committed Skill projection roots，并继续把这些 roots 标记为只读。`sandbox-execution-port` 从显式 script path 或单一 module root 选择结果派生可选 `NEXTAGENT_SKILL_ROOT`；`agent-platform-gateway-local` 只消费该 layout 和选择结果、实施 mount/ACL 与执行限制，不拥有 scope identity 或 projection manifest 判定。

- Python script-path mode 必须从显式逻辑脚本路径匹配唯一 projection root。
- Python module mode 必须仅在当前 scope 恰好有一个有效 projection root 时使用它。
- 零个或多个 roots 必须显式安全失败；不得按提交时间、词法顺序、module name 或当前 assembly 隐式选择。

因此，“同 scope 权限共享”不会扩大 module mode 的隐式选择能力。

#### 5. 保持只读、隔离和 public contract 边界

`.nextagent/skills/...` 继续只允许 Read、Glob、Grep 和 sandbox read/execute。Write、Edit、脚本写入和 projection subtree 越界必须继续拒绝。跨 subject、跨 agent、跨 tenant，以及 `session` isolation mode 下跨 session 的访问，由 resolver 派生的不同 execution root 物理隔离，并由 safe path 校验阻止逻辑路径逃逸。

本 change 不修改 `agent-contracts`、`ExecutionWorkspaceView`、`SandboxExecutionRequest`、Tool schemas、Web API、configuration 或 gateway persistence contract。它会删除 `agent-capability` 与 `agent-core` public package exports 中仅供 product composition 使用的 reauthorizer 字段，并同步删除 `agent-app` 唯一调用方；这些字段不是 frozen `agent-contracts`，不保留兼容 shim，也无需 `agent-contracts` 升级确认。

### 质量属性影响

| 属性 | 设计约束 | 验证观察点 |
| --- | --- | --- |
| 安全 | authority 只来自可信 execution view 内有效 committed projection；不接受路径文本、客户端或模型身份输入 | 构造历史路径、跨 subject、跨 agent、跨 session-isolated scope、invalid marker、symlink escape 均不可达且不泄漏存在性 |
| 可靠性/恢复 | filesystem committed fact 是唯一持久 authority；scope cache 只保存可重建验证结果 | 换 run、terminal cleanup、cache eviction、重建 `WorkspaceFilePort` 后仍可读取和显式执行 |
| 可诊断 | 沿用现有 safe reason code 和受控 sandbox failure；不发布 physical root | 无 root、多 root、invalid projection 返回稳定安全失败，Web/模型可见面不出现 physical path |
| 可维护 | 单一 owner、复用 marker 校验和 bounded cache helper、不新增 index/table | 无平行 authority store、无 scopeKey 重算、无 core 历史扫描 |
| 可测试 | 以文件工具和 sandbox 黑盒结果验证 scope authority | characterization/contract/architecture tests 覆盖允许路径和 negative cases |

## 验证策略

1. 在 `agent-capability` 写失败优先 characterization tests：同 scope 不同 run、terminal cleanup 后、重建 port 后仍可 Read/Glob/Grep 并生成可执行 sandbox layout；不同 scope、invalid marker、staging、locks 和 write 仍失败。
2. 在 `agent-core` 删除 current-run reauthorization 行为测试，并增加架构断言，保证 core 不再解析 Skill resource path 或拥有 projection authority。
3. 在 `agent-platform-gateway-local`/sandbox 现有测试中验证显式 script path 只匹配当前 scope root；Python module mode 对单 root 成功、零 root和多 root安全失败。
4. 运行受影响测试、后端完整门禁和 OpenSpec strict validation。该 change 不修改浏览器前端，因此不要求 frontend build/test。

## 长期基线刷新计划

归档前执行以下同步：

- stable spec：把本 change 的 delta 合入 `openspec/specs/skill-resource-access/spec.md`。
- Function：更新 `openspec/designs/functions/D5-Capability能力体系/D5.3-Skill与检索/FN-5.10-访问技能资源.md` 的前置条件、处理过程、结果和 Requirement 追踪。
- Feature：更新 `F-5.6 Skill 系统` 对跨 run/scope 资源复用的描述和 Function 映射。
- architecture：更新 `openspec/designs/architecture/skill-invocation-and-disclosure.md`，把 accepted-run root 改为 execution-scope committed projection authority，并删除历史消息补授权语义。
- modules：更新 `agent-capability.md` 的 WorkspaceFilePort ownership；更新 `agent-core.md`，明确 core 不参与 projection authority 恢复；检查 `agent-platform-gateway-local.md` 仍只负责 sandbox enforcement，只有导航陈述失真时才修改。
- spec-to-design map：同步 `skill-resource-access` 的 Requirement/Function/architecture/module 导航。
- overview、ADR、`agent-contracts`：无新增边界或永久决策，不修改。

## 部署、迁移与回滚

- 前置条件：`fix-skill-resource-projection-refresh` 和 `normalize-skill-python-output-paths` 必须先完成并归档，避免同一代码基线同时保留 run reauthorization、run-scoped Skill root environment 与 scope authority。
- 数据迁移：无。现有有效 committed projection marker 和目录直接成为 authority 事实。
- 部署：相关后端 package 作为同一版本发布，不维持新旧 authority 语义的兼容窗口。
- 回滚：回滚代码即可恢复 run-local authorization；现有 projection 仍为只读 managed data，不需要反向数据迁移。

## 风险与权衡

- 同一 scope 中累积的有效 projections 会增加文件工具可达的只读资源集合。这是 scope authority 的目标语义；既有 projection cleanup 仍是失效 owner，本 change 不新增自动撤销策略。
- 当前 assembly 不再暴露某 Skill 时，其有效 projection 仍可通过已知路径读取或显式执行。这是资源 authority 与 Capability invocation authority 的刻意分离，不允许借此发现、激活或调用该 Skill Capability。
- 多个有效 projections 会使 Python module mode 显式失败。该限制避免隐式 root 选择；调用方可使用显式 script path。
- 每个进程中，scope 第一次需要全量 roots 时会扫描并校验 Skill projection 目录；后续操作复用 bounded scope cache，并在 root/manifest 消失或被替换时安全失效。该方案避免每次 sandbox 调用重复 hash 全部资源，也不引入第二套持久 authority。

## Open Questions

无。
