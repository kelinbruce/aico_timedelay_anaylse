## Why

用户 Query 主动长期记忆召回目前将多种前置条件、L1/L2 读取失败和运行态校验归并为少量诊断码。运维人员无法仅通过 operational 日志判断 Hook 未生效的具体阶段。

## 目标与非目标

目标：在保持已有聚合诊断码兼容的前提下，为主动召回补充稳定、无敏感内容的关键阶段诊断码，使日志可区分调用坐标不完整、依赖读取失败、L1/L2 调用失败或取消。

非目标：不新增诊断字段，不记录 Query、记忆正文、ID 或 Owner Scope；不修改 gateway、黄区 remote 实现、重试策略或上下文准入策略。

## What Changes

- 保留已有的最终输入、binding、RequestRun、根消息和未命中聚合诊断码。
- 新增坐标不完整、Assembly/RequestRun/根消息读取失败，以及 L1/L2 取消和失败诊断码。
- 保持现有 `diagnosticCode`、候选数、详情数和准入结果的安全投影方式。

## Function 影响（OpenSpec Capabilities）

- `memory-tools`：修改主动召回的 L1/L2 可诊断结果要求。
- `lifecycle-hook-execution`：修改主动召回 Hook 的安全诊断摘要要求。

## 影响范围

- `packages/agent-app/src/composition/user-query-memory-recall-hook.ts`
- `packages/agent-memory/src/user-query-memory-recall.ts`
- 对应单元测试
