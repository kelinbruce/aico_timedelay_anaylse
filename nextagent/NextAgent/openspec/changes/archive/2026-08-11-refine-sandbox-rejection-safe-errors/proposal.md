# 优化 Sandbox 拒绝 Safe Error

## 背景与问题（Why）

当 sandbox 请求因调用形态非法而被拒绝时，agent 目前可能收到通用的 unavailable 失败。运维人员和模型无法可靠判断是平台不可用还是请求必须纠正，agent 可能反复重试同一个非法调用，而不是改变命令形态。

## 变更范围（What Changes）

- 区分 sandbox 请求拒绝与真正的 sandbox 启动或平台不可用。
- 把不支持的 Python 调用形态映射为带具体纠正提示的校验 safe error。
- 把真正的 sandbox/后台启动失败保留为 unavailable。

## 非目标（Non-Goals）

- 不允许 `python -c`、`python -` 或不支持的 Python 解释器选项。
- 不改变 sandbox 路径授权、可执行文件 denylist 策略或平台隔离。
- 不在公开 safe error 中暴露原始命令、宿主路径、stdout/stderr 或内部异常细节。

## Function 影响（OpenSpec Capabilities）

- 修改：`FN-Sandbox Runtime`，canonical name `sandbox-runtime`，spec `openspec/specs/sandbox-runtime/spec.md`。
  - 变更边界：capability 面向边界上的 sandbox 拒绝与 unavailable 失败分类。
  - 质量属性：可靠性/恢复、可诊断性、安全。

## 影响范围（Impact）

- 受影响 spec：`sandbox-runtime`
- 受影响 package：`agent-platform-gateway-local`、`agent-capability`
