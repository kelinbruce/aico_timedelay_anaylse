## 背景与问题（Why）

Skill 资源投影目前只按 `providerId`、`skillName` 与 `skillVersion` 复用 workspace 中的 committed projection。系统重启后，即使运维人员已修改本地 Skill 的 `SKILL.md` 或 `scripts/` 内容，只要版本未变化，首次 Skill 激活仍会命中旧 projection。模型会看到新的脚本提示，但 sandbox 只能访问旧目录，导致脚本不存在。

本地单实例服务的启动是受控的 Skill source 刷新边界。该边界应保证每个 Skill 在新进程中的首次激活重新物化其当前受治理资源，而不把逐次执行的源目录校验引入主路径。

## 变更范围（What Changes）

- `WorkspaceFilePort` SHALL 在每个服务进程内对每个 execution scope 中的 Skill projection identity 的首次请求强制重建 committed projection，忽略重启前遗留的 manifest。
- 首次重建 SHALL 继续使用现有 lock、staging、校验和 rename 原子发布路径；同进程并发首次请求 SHALL 共享同一次初始化结果。
- 同一进程内首次成功后，后续请求 SHALL 沿用现有 immutable manifest reuse 行为，不重新枚举或复制源资源。
- 运行中的源 Skill 修改不自动生效；必须重启服务或由后续独立 change 提供显式刷新入口。
- BREAKING：无。该 change 仅修正重启后的投影新鲜度。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `skill-resource-access`: 修改 Skill resource projection 的重启后首次激活语义。

## 影响范围（Impact）

- `packages/agent-capability/src/builtins/workspace-files/workspace-file-port.ts`：拥有进程内首次投影初始化与现有 projection publication。
- `packages/agent-capability/tests/skill-resource-projection.test.ts`：覆盖同版本 Skill 在模拟重启后修改 `SKILL.md` 与脚本文件时的刷新结果，以及同进程 reuse。
- 无 Web API、gateway contract、配置或持久化 schema 变更；workspace 清理由现有 execution cleanup owner 负责。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/skill-resource-access/spec.md`：补充重启后首次 Skill 激活必须重建投影、同进程复用及运行中修改非目标。

长期背景：

- `openspec/overview.md`：无。

设计视图：

- `openspec/designs/architecture/skill-invocation-and-disclosure.md`：补充 projection freshness 与服务进程边界。
- `openspec/designs/modules/agent-capability.md`：补充 `WorkspaceFilePort` 的首次投影初始化职责。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：更新 `skill-resource-access` 导航与验证入口。

验证入口：

- `packages/agent-capability/tests/skill-resource-projection.test.ts`
- `npm run build`
- `openspec validate fix-startup-skill-projection-refresh --strict`
