## 目标

允许 Skill resource projection 保留 `.xxx` 路径段，包括 root-level `.hidden/skip.py`，使既有电信运维工具包和 API 资产包无需改名即可被授权运行读取。

## 当前差距

稳定规格和当前实现都把 hidden directories 作为一类统一拒绝对象，并限制顶层资源目录。实现落点是 `WorkspaceFilePort.projectSkillResources(...)` 调用的 `isSafeProjectionRelativePath(...)`，其中 `segment.startsWith(".")` 会过滤所有点号前缀段，包括 `.hidden/skip.py` 和 `assets/.schemas/chatbi.yaml` 这类业务资源路径。

## 选定方案

唯一实现路径：修改 `agent-capability` 中 `isSafeProjectionRelativePath(...)` 的 segment 过滤规则。

- 继续拒绝空段、`.`、`..`。
- 不再因为 `segment.startsWith(".")` 拒绝 `.xxx`。
- 不再限制顶层目录名，安全相对路径均可投影。
- 继续使用现有 `hasForbiddenDirectorySyntax(...)`、`assertContained(...)`、staged tree verification、symlink/hardlink/special file 检查和 resource count/path length 限制。
- 不新增配置项，不新增 capability contract，不修改 sandbox mount 形态。

该方案只改变 governed Skill resource 的 projection 过滤，不改变普通 workspace file path 规则，也不授权整个 `.nextagent` root。

## 质量属性审视

- 安全：`.xxx` 作为普通相对路径段生效，`.`、`..`、绝对路径、URL-like path、drive-qualified path、symlink、hardlink、special file 仍拒绝；测试覆盖 root-level `.hidden` 和内部 `.schemas` 可读、projection 内部 `.staging`/`.locks` 未授权。
- 性能/容量：不改变 200 files、路径长度和 staged verification 策略；无新增扫描范围。
- 可靠性/恢复：不改变 committed marker、lock、staging、rename 和 cleanup 流程。
- 可维护性：保持单点过滤函数，不引入平行 allowlist 或配置分支。
- 可测试性：通过 `skill-resource-projection.test.ts` 覆盖正向和负向行为。
- 审计/可追溯性：不新增日志字段或高基数字段；行为由 OpenSpec change 和测试记录。

## 归档前基线更新

- `openspec/specs/skill-resource-access/spec.md`：更新 projection filtering requirement。
- `openspec/designs/architecture/skill-invocation-and-disclosure.md`：提炼 `.xxx` 内部目录允许规则。
- `openspec/designs/modules/agent-capability.md`：提炼 `WorkspaceFilePort` projection filter 规则。
