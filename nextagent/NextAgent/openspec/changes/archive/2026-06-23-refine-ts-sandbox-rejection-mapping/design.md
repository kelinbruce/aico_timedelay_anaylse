## 设计概述

本 change 不改 public gateway contract，只在既有 `safeError` / observability 语义内细化 restricted local sandbox 的分类。

### 决策 1：request rejection 与 adapter unavailability 分离

restricted local sandbox 在以下场景属于 request rejection，而不是 adapter unavailable：

- builtin executable 不受支持
- path argument 不安全或不在受信 root 内
- request environment 不满足 restricted local sandbox 校验

这些场景说明 sandbox adapter 仍然可用，只是拒绝了当前 request。因此：

- 日志事件必须使用独立 rejected event
- `safeError` 仍可复用既有 unavailable-shaped gateway result，但必须携带稳定 rejection reason 供上层映射

### 决策 2：capability-facing vocabulary 复用既有错误码

为避免新增平行 public error vocabulary：

- `unsupported-executable` -> `COMMAND_NOT_ALLOWED`
- `unsafe-path` -> `CAPABILITY_PATH_REJECTED`

上层 capability-safe 映射仍保留 `sandboxReasonCode` 作为内部 safe detail 追踪 sandbox owner reason。

### 决策 3：真正 unavailable 继续保留 `SANDBOX_UNAVAILABLE`

只有基础设施层不可执行时，才继续映射为 `SANDBOX_UNAVAILABLE`，例如：

- adapter prerequisite 缺失
- child process 无法启动
- trusted executable locator 无法解析

### 决策 4：本 change 不改变已执行结果语义

一旦进程成功启动并进入 execution path：

- non-zero exit 继续由 tool owner 按既有语义处理
- timeout / canceled / output overflow 继续按既有语义处理

本 change 只细化 request rejection，不扩展 command execution failed vocabulary。
