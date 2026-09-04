## 背景与问题（Why）

部分电信网络 Skill 资源来自既有运维工具包或 API 资产包，目录结构中会包含 `.xxx` 形式的内部目录，例如 `assets/.schemas/`、`references/.vendor/` 或 `scripts/.helpers/`。当前 Skill resource projection 将所有点号开头的路径段视为 hidden directory 并过滤，导致这些受控资源无法通过 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` 投影给授权运行使用。

这类 `.xxx` 段不是路径穿越，也不是系统 projection 内部目录；只要资源路径整体继续满足路径规范化、容量、链接和特殊文件校验，就应作为普通资源目录处理。

## 变更范围（What Changes）

- 修改 Skill resource projection 的路径过滤语义：允许 `.xxx` 形式的目录段出现在任意相对路径层级，包括 root-level `.hidden/skip.py`。
- 继续拒绝空段、`.`、`..`、绝对路径、drive-qualified path、URL-like path、越界路径、symlink、hardlink、special file 和超过限制的路径。
- 不再限制顶层目录名；projection 安全边界由路径规范化、越界校验、链接/特殊文件校验、容量限制和授权 Skill projection subtree 共同约束。
- 不改变 `.nextagent/skills/.locks/`、`.nextagent/skills/.staging/`、`.projection.json` 等 projection 内部路径的授权边界。

## Capability 影响（Capabilities）

### 新增 Capability
无。

### 修改的 Capability
- `skill-resource-access`: 修改 Skill resource projection 对点号前缀内部目录段的过滤语义。

## 影响范围（Impact）

- 代码影响 `agent-capability` 的 `WorkspaceFilePort.projectSkillResources(...)` 路径过滤逻辑。
- 测试影响 `packages/agent-capability/tests/skill-resource-projection.test.ts`，新增 `.xxx` 内部目录投影和读取覆盖。
- 不影响 Web API、runtime command、gateway persistence schema、Agent Scope、Owner Scope 或 stream event contract。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/skill-resource-access/spec.md`：更新 Skill projection 路径过滤 requirement，记录 `.xxx` 目录和 root-level `.hidden/skip.py` 可投影。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/skill-invocation-and-disclosure.md`：归档时提炼路径过滤语义变化。
- `openspec/designs/modules/agent-capability.md`：归档时提炼 `WorkspaceFilePort` projection filter 行为。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：无。

验证入口：
- `npm test -- packages/agent-capability/tests/skill-resource-projection.test.ts`
- `openspec validate --all --strict`
