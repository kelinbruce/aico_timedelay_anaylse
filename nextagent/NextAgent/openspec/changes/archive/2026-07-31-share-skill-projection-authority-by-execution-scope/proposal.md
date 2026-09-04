## Why

电信网络任务经常需要在多轮对话中重复读取同一 Skill 的规程、参考资料或执行脚本。当前同一 Agent、租户和用户的多轮请求虽然复用同一个 execution scope 和同一份已提交 Skill projection，但每个新 run 都会丢失该 projection 的文件访问权限；系统必须从历史上下文恢复路径、重新核验当前 Skill 可见性并再次授权，才能读取或执行已经位于当前 execution scope 的资源。

这种行为把资源的物理生命周期定义为 execution scope，却把同一资源的访问生命周期缩短为 run，导致同一 scope 内的后续请求出现与目录归属不一致的拒绝或隐式补偿。系统需要让成功提交的 Skill projection 在其可信 execution scope 内形成持续、可恢复的资源 authority，同时继续阻止其他 Agent Scope、Owner Scope 或 session-isolated scope 访问该资源。

### 术语

- **Skill projection scope authority**：成功提交且身份与完整性有效的 Skill projection，在其可信 execution scope 内形成的持续只读资源权限。同一 execution scope 的 accepted runs 可以读取资源并通过受治理 sandbox 执行其中的脚本；该 authority 不授予写权限，也不授予调用对应 Skill runtime Capability 的权限。

### 规范上下文

- 默认 `subject` isolation mode 下，execution scope 由可信 Agent Scope 和 Owner Scope 派生，同一 Agent、租户和用户的不同 session/run 共享该 scope。
- `session` isolation mode 下，execution scope 还包含可信 `sessionId`，不同 session 不共享该 scope。
- `agentVersion`、`agentAssemblyRef` 和 `runId` 不参与 execution scope 派生；它们也不改变 Skill projection scope authority 的归属。
- Skill runtime Capability 是否可发现、激活或调用，继续由当前 accepted Agent assembly 和 capability governance 决定。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 同一可信 execution scope 内，任一 accepted run 都能读取已经成功提交且仍然有效的 Skill projection。
- 同一可信 execution scope 内，受治理 sandbox 能执行上述 projection 中允许执行的 Skill 脚本。
- 进程重启后，系统仍能从已提交 projection 的受信事实恢复相同的 scope authority，不依赖上一 run 的内存授权状态或历史消息。
- 不同 execution scope 之间保持不可见、不可读、不可执行。
- Skill projection 始终保持 system-managed 和只读。

**非目标：**

- 不改变 Skill runtime Capability 的发现、激活、调用、版本选择或 Agent assembly binding。
- 不允许模型输出、历史路径文本、客户端 metadata 或工具参数创建或扩大 scope authority。
- 不允许 `Write`、`Edit`、Skill 脚本或其他动态代码修改 `.nextagent/skills/...`。
- 不改变 `temp/` 的 run-scoped 生命周期，也不把临时文件提升为 scope-scoped 资源。
- 不在本 change 中新增 Skill projection 的显式撤销 API、配置开关或独立持久化表。

## What Changes

- **BREAKING 行为修正**：Skill projection 的资源 authority 从 current-run lifetime 改为 execution-scope lifetime。run terminal 不再撤销已提交 projection 在同一 scope 内的读取和脚本执行权限。
- 成功提交且身份与完整性有效的 projection 成为该 execution scope 的唯一持久 authority 事实；仅有逻辑路径文本不产生 authority。
- 同一 scope 的后续 accepted run 和进程重启后的 accepted run 可以直接使用有效 projection，不再要求基于历史上下文执行 current-run reauthorization 或注入重新披露消息。
- 文件工具和 sandbox 只暴露当前可信 execution scope 内有效的 committed projection；其他 scope、未提交、暂存、锁目录、损坏或身份不一致的 projection 保持不可访问。
- Skill projection 的读取和脚本执行权限按 scope 共享；写入权限仍被拒绝。

## Feature 影响（Features）

### 修改的 Feature

- `F-5.6 Skill 系统`：已激活 Skill 的受控资源在可信 execution scope 内跨 session/run 持续可用；资源复用不再依赖每轮重新激活或历史上下文补偿，同时保持跨 scope 隔离和只读保证。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.10 访问技能资源` → `specs/skill-resource-access/spec.md`
  - 功能边界：把已提交 Skill projection 的可读和受治理脚本执行权限从 current accepted run 扩展为整个可信 execution scope；明确 authority 的建立、恢复、隔离、失效和只读结果。
  - 系统质量属性：安全、可靠性/恢复。
  - 映射说明：`skill-resource-access` 是 canonical spec；本 change 不触及其他 legacy spec。

## 影响范围（Impact）

- Agent 用户在同一 execution scope 的后续轮次中可以稳定复用已投影的电信规程、参考资料和诊断脚本，不再因 run 切换收到资源未授权结果。
- Agent 开发者不再需要依赖历史消息保留 Skill resource root 才能恢复访问权限。
- 不新增或修改 Web API、配置字段、gateway DTO、数据库表或客户端请求字段。
- 后端 Skill resource projection、文件访问、sandbox filesystem layout、run terminal cleanup 及相关测试会受到影响。
- `fix-skill-resource-projection-refresh` 定义的 current-run reauthorization 补偿路径与本 change 的目标 authority lifetime 冲突；本 change 必须在该 change 完成并归档后串行实施，并以本 change 的目标态替代该补偿语义。
- `normalize-skill-python-output-paths` 当前把 `NEXTAGENT_SKILL_ROOT` 的可信来源表述为 run-scoped Skill projection authorization facts；本 change 必须在该 change 完成并归档后串行实施，并把该环境变量改为从当前 execution scope 的有效 committed projection 选择结果派生。
