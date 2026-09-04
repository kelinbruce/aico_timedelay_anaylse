# ADR: 会话 Lane 快照查询

## 状态

Accepted

## 背景

same-session lane scheduling 需要知道当前 session 是否已有 active、queued 或 terminal-pending run。若只靠进程内状态，进程重启、retry、cancel 和恢复都会产生不一致。

## 决策

gateway-local 提供 owner+agent+session scoped lane snapshot query，返回 durable run/session facts。runtime scheduler 使用该 snapshot 判断是否派发 queued run、是否接受 retry/cancel 结果后的下一步调度，以及 recovery 后 lane 是否可继续。

gateway 只返回事实，不在 store 内做调度选择。

## 取舍

- 放弃 channel/runtime 进程内列表作为唯一 truth，因为重启后丢失。
- 放弃 gateway 直接选择 next run，因为调度语义属于 runtime。
- 放弃 active-run conflict 直接拒绝新 submit，因为 stable 基线支持 same-session queued lane。

## 后果

submit 可以在同 session 已有运行中 run 时创建 queued run。scheduler 只能在 lane clear 后派发下一 run，并保持 sequence/history 可观察。

## 验证

- lane snapshot query contract tests。
- same-session queued scheduling tests。
- cancel/retry/recovery 后 lane dispatch tests。
