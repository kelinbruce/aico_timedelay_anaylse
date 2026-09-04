# ADR: 本地 Runtime 恢复启动门

## 状态

Accepted

## 背景

本地单实例运行中，进程重启会留下 queued、executing 或 terminal-pending run。若启动后立即接受调度，same-session lane 和 terminal visibility 会与持久化事实不一致。

## 决策

runtime 启动时先执行 bounded recovery scan/claim，并在 recovery gate 完成后开放正常 scheduler dispatch。恢复过程只基于 owner+agent scoped durable facts，不依赖进程内缓存。

无法安全恢复的 run 必须提交 recovery failed terminal，而不是停留在不可见状态或只写日志。

## 取舍

- 放弃启动后懒恢复，因为用户会看到 lane/状态不一致。
- 放弃多实例 lease 语义，因为当前基线只承诺本地单实例。
- 放弃无终态跳过异常 run，因为会破坏 conversation/timeline 可审计性。

## 后果

启动耗时包含 bounded recovery。正常 submit/scheduler 必须等待 recovery gate，避免重复派发或 lane 冲突。

## 验证

- startup recovery gate tests。
- queued/executing/terminal-pending 分类 tests。
- recovery failed terminal 可见性 tests。
