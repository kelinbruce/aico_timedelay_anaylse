## Why

运维人员当前只能通过 `deniedExecutables` 排除已知危险命令；当部署要求只授权一组经过批准的诊断工具时，任何未被预先识别并加入黑名单的宿主 executable 仍可能被执行。这无法满足高安全等级电信网络环境的最小授权要求，因此 sandbox 需要可选的 executable 白名单策略。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 运维人员可以通过可信启动配置声明 `allowedExecutables`；字段存在时，系统只执行白名单中的 executable。
- 黑名单继续受支持；黑白名单同时配置时，executable 必须在白名单中且不在黑名单中，黑名单拥有拒绝优先级。
- 显式空白名单表示不允许执行任何 executable；字段缺失时保持现有仅黑名单行为。
- 白名单模式只允许单 executable 的 direct execution；任何需要 shell interpreter 的组合请求均被拒绝。
- 仓库内置默认配置保留 `curl` 与 `clipc` 白名单，但默认关闭 executable policy 校验。
- 配置拒绝继续产生安全、可诊断且不泄漏宿主细节的失败结果。

**非目标：**

- 不允许模型输入、客户端 metadata 或 runtime Capability 参数修改 executable policy。
- 不新增参数级命令授权、路径授权、网络授权或通配符/正则匹配。
- 不新增可配置 shell 操作符黑名单，也不依赖穷举危险字符实现安全边界。
- 不改变 `sandbox.enabled=false` 的可信本地执行语义。
- 不改变 remote sandbox 自身的策略配置契约。

## What Changes

- 新增可选可信启动配置 `sandbox.allowedExecutables`，按 executable 名称精确匹配。
- 将仓库内置 `default-system.yaml` 配置为 `enabled: false` 和 `allowedExecutables: [curl, clipc]`。
- 修改 restricted local sandbox 的 executable policy：启用校验且白名单字段存在时，非白名单 executable 被安全拒绝；黑名单命中始终拒绝。
- 白名单字段存在时禁止进入 trusted shell execution path；需要 shell interpretation 的请求被安全拒绝，其他 shell-like 文本仅作为 direct execution argv 传递。
- 保持 `allowedExecutables` 缺失时现有 denylist 行为和默认兼容性。

## Feature 影响（Features）

### 修改的 Feature

- `F-6.3 沙箱执行`：运维人员除既有黑名单外，可选择以显式白名单收窄本地 sandbox 可执行范围。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-6.3 沙箱执行命令` → `specs/sandbox-runtime/spec.md`
  - 功能边界：可信启动配置可在既有黑名单基础上启用 executable 白名单，未授权或被禁止的命令安全失败。
  - 系统质量属性：安全、可维护性、可测试性、可诊断性。
  - 映射说明：canonical spec；本 change 仅修改 `sandbox-runtime`。

## 影响范围（Impact）

- 运维配置新增可选字段；未配置部署保持当前行为，显式空数组会拒绝全部 executable。
- 本地 sandbox 配置契约、app composition、Bash 配置投影和相关 contract/adapter 测试受影响。
- 使用白名单的部署必须显式列出所需 executable；同时命中黑白名单的名称仍被拒绝。
