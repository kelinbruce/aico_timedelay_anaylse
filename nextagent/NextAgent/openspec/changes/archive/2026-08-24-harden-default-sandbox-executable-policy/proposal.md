## Why

运维人员使用仓库内置系统配置启动本地 NextAgent 时，当前默认关闭 executable 名单校验，配置中的批准名单因而不会形成实际执行约束。任何能够从宿主受信位置解析的 executable 都可能通过 Bash 执行，这与电信网络智能体默认最小授权、安全失败和可审计运行的要求不一致。现在需要把仓库默认行为收敛为启用名单校验，并把默认可执行范围冻结为实际需要的领域命令、HTTP 调用和 Python 执行入口。

规范上下文：

- 适用配置：仓库内置 `default-system.yaml`。
- 默认校验状态：`sandbox.enabled=true`。
- 默认 executable allowlist：`clipc`、`curl`、`python`，除此之外不授权其他 executable。
- 默认 executable denylist：显式列出 shell、进程启动、写入、权限、系统管理、远程执行和容器管理等高风险入口；denylist 不承担已有专用 Tool 的职责去重，且不包含四个 allowlist 成员。
- 信任来源：仅 trusted startup/app composition；模型输入、客户端 metadata 和 runtime `Capability` 参数不得修改该名单。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 默认启动配置实际启用 executable allow/deny policy。
- 默认只允许 `clipc`、`curl` 和 `python` 进入既有 direct execution 路径。
- 默认 denylist 显式拒绝高风险宿主执行入口，即使后续 allowlist 被扩展，同名 denylist 项仍保持拒绝优先。
- 未在默认名单中的 executable 和需要 shell interpretation 的命令在进程启动前安全失败。
- 自定义部署继续能够通过可信启动配置声明自己的 `enabled`、`allowedExecutables` 和 `deniedExecutables`。

**非目标：**

- 不改变 executable 名单的精确名称匹配、denylist 优先和显式空 allowlist 拒绝全部请求等既有语义。
- 不新增参数级、目标域名级或 Python 代码级策略；`curl`、Python 和 `clipc` 继续使用各自已有的治理边界。
- 不改变 sandbox gateway、文件系统 root layout、环境清洗、超时、取消、输出限制或 safe error 契约。
- 不改变 runtime `Capability` catalog 或新增 Tool。

## What Changes

- **BREAKING**：仓库内置默认配置从关闭 executable 名单校验改为启用校验；依赖默认配置执行其他宿主 executable 的调用将被拒绝。
- 仓库默认 `allowedExecutables` 精确设置为 `clipc`、`curl`、`python`。
- 仓库默认 `deniedExecutables` 设置为本 change 冻结的精确高风险 executable 集合，且不与四个 allowlist 成员冲突。
- 默认配置下只允许名单成员进行既有 direct execution；shell composition 和未授权 executable 保持 fail closed。

## Feature 影响（Features）

### 修改的 Feature

- `F-6.3 沙箱执行`：默认部署从宽松宿主 executable 解析收敛为启用最小 executable 白名单，强化运维人员可依赖的默认执行安全保证；组成 Function 不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-6.3 沙箱执行命令` → `specs/sandbox-runtime/spec.md`
  - 功能边界：修改仓库内置配置下的默认校验状态和默认 executable 精确名单；自定义可信配置行为不变。
  - 系统质量属性：无新增黑盒质量目标；默认最小授权具有安全设计影响。
  - 映射说明：`sandbox-runtime` 是 canonical spec；不触及 legacy spec。

## 影响范围（Impact）

- 使用仓库默认配置的本地部署将不再执行 allowlist 外 executable，也不再接受 shell composition；denylist 成员在名单冲突时保持拒绝优先。
- 显式提供自定义 sandbox 配置的部署继续按其可信配置运行。
- 默认配置加载、配置 composition 和 sandbox contract tests 需要更新预期。
