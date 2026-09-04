## 背景和现状（Context）

`WorkspaceFilePort` 当前在磁盘上发现同一 projection identity 的 committed manifest 后立即复用。identity 不包含服务进程代次，因此重启后会把旧 Skill 资源当作当前资源。现有实现已拥有 lock、staging、内容写入校验与 rename 发布，不需要引入新的 filesystem owner。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 重启后的首次 Skill 激活必须物化当前受治理资源。
- 同一服务进程中保持既有 immutable projection reuse，避免每次执行扫描源目录。
- 并发首次激活只执行一次 publication。

**非目标：**

- 不支持运行中编辑本地 Skill 后自动刷新。
- 不新增内容摘要、持久化跨进程缓存、Web API 或显式刷新命令。
- 不支持多服务实例共享同一 execution workspace 后相互覆盖同一 projection identity；该部署模型需要后续以内容地址化 projection 单独定义。

## 设计决策（Decisions）

### D1：`WorkspaceFilePort` 以进程内初始化集合拥有首次刷新

`createWorkspaceFilePort(...)` 创建一个私有 `initializedProjectionBases` 集合，键是当前 `ExecutionWorkspaceView` 中该 Skill 的物理 projection base。`projectSkillResources(...)` 对未初始化 base 不调用 `projectionCommitted(...)` 的 reuse 快路径，而是进入现有 lock/staging/publication 流程；成功发布后才将 base 标记为 initialized。后续同 scope 调用才允许 manifest reuse。

同一 `WorkspaceFilePort` 中，现有基于 scope-local projection key 的 filesystem lock 串行化 publication。获得 lock 后再次检查当前 projection base 的 initialized 状态，后到调用直接复用已发布结果，避免并发调用重复复制。失败或 abort 不标记 initialized，使下一次调用可安全重试。

选择该方案是因为服务重启是本地部署受控 source refresh 边界，且只需修复重启后的陈旧投影。放弃每次执行计算内容 revision：它会让每次 Skill activation 承担额外源目录扫描/hash。放弃原地无条件清理所有 workspace：会扩大影响面并删除不属于本 change 的用户数据。

### D2：首次刷新仍使用原子 staging publication

首次刷新完全复用现有 staging tree validation、target 删除、rename 与 manifest 写入。它不直接写入已授权 projection root；失败时不授权当前 run，且不留下可被模型访问的 staging/lock 路径。

### D3：运行中变更保持显式边界

首次初始化成功后的资源集合在当前进程内冻结。运维人员需要重启服务才能让本地 Skill 修改进入新的首次刷新；该限制由 spec 明示，避免隐藏的源文件轮询与不可预测的执行行为。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 复用现有路径过滤、staging 校验和按 run 授权；首次刷新不扩大 `.nextagent` 授权。 | projection negative assertions |
| 性能/容量 | 每个 key 每个进程最多一次额外投影；后续调用不扫描或复制。 | focused reuse test 的 list/read call count |
| 可靠性/恢复 | 成功后才标记 initialized；失败/abort 保持可重试，发布仍经 staging/rename。 | focused refresh and failure characterization |
| 可维护性 | 状态仅属于 `WorkspaceFilePort`，不增加跨 package contract。 | focused code review、architecture gate |
| 可测试性 | 通过两个 port 实例共享同一 runtime workspace 模拟重启。 | `skill-resource-projection.test.ts` |
| 审计/可追溯性 | 不新增日志或公开字段；现有 safe diagnostics 保持不泄露 source path。 | focused safe-path assertions |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 重启后首次激活刷新同版本资源 | 1.1, 2.1 | `skill-resource-projection.test.ts` |
| 同进程后续调用复用 | 1.1, 2.2 | resource list/read call count assertions |
| 并发和失败不误标记 initialized | 1.1, 2.3 | focused concurrency/failure test |
| change 规格与类型正确 | 3.1 | `npm run build`; `openspec validate fix-startup-skill-projection-refresh --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/skill-resource-access/spec.md`。
- 架构设计：`openspec/designs/architecture/skill-invocation-and-disclosure.md` 承载 freshness 边界。
- 模块设计：`openspec/designs/modules/agent-capability.md` 承载 `WorkspaceFilePort` owner。
- ADR：无；这是局部 lifecycle 修复。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] 多实例共享同一 execution workspace 会竞争原地刷新。 -> 本 change 明确限制为单实例独占本地 workspace；共享部署后续改用内容地址化 key。
- [风险] 运行中编辑不会生效。 -> 将服务重启作为明确运维动作；后续需要时另设显式刷新 change。
- [风险] 首次 activation 增加一次 I/O。 -> 只在每 key 每进程一次，后续复用。

## 迁移计划（Migration Plan）

无需数据迁移。部署新版本后，首次使用每个 Skill 会覆盖其旧 projection；若 publication 失败，现有安全失败与后续重试路径生效。回滚后恢复旧 reuse 语义。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/skill-resource-access/spec.md`：同步首次刷新和同进程 reuse 的行为契约。
- `openspec/designs/architecture/skill-invocation-and-disclosure.md`：同步服务进程 freshness 边界。
- `openspec/designs/modules/agent-capability.md`：同步 owner 与初始化职责。
- `openspec/designs/spec-to-design-map.md`：更新导航和 focused verification。
- `openspec/overview.md`、ADR：无。

## 待确认问题（Open Questions）

无。
