# ADR: 请求取消终态边界

## 状态

Accepted

## 背景

cancel 是用户可见的 runtime command。它必须停止可取消的执行路径，同时保持 terminal commit、conversation history 和 stream timeline 的唯一事实来源。

## 决策

cancel command 由 Web channel 认证并校验 schema 后交给 runtime。runtime 是唯一 cancel lifecycle owner，负责校验 request/run scope、传播 cancellation context、提交 cancelled terminal 或返回已 terminal fact。

Agent core、model provider、capability provider 和 channel 只消费 cancellation context 或投影结果，不直接写 terminal message、timeline terminal event 或 run status。

## 取舍

- 放弃 channel 直接关闭 stream 表示 cancel，因为 transport close 不是 request terminal fact。
- 放弃 capability provider 自行提交 cancelled，因为 provider 不拥有 run lifecycle。
- 放弃只做 in-memory abort，因为进程重启后无法审计 cancelled terminal。

## 后果

late model/capability output 必须被 runtime terminal guard 丢弃或 safe failed。cancel 成功与否必须可以通过 API/stream/history 观察。

## 验证

- cancel queued/running run 的 runtime tests。
- late output 不覆盖 cancelled terminal 的 characterization tests。
- channel 不写 terminal lifecycle 的 architecture tests。
