[返回 Roadmap V2](../nextagent-ts-change-roadmap-v2.md)

## Alpha E2E 回归 Gate

Alpha（串行底座）已归档 change 的最小问答内核行为缺乏使用真实 product process 的 E2E 回归保护。本 gate 使用 Alpha 级 product composition（无 local auth、无 WebSocket、无 P0 工具注册）作为 P0 能力变更期间的 Alpha 核心路径回归保护。

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-e2e-alpha-kernel-gate`](../nextagent-ts-changes/add-ts-e2e-alpha-kernel-gate.md) | complete | 使用真实 Alpha 级 product process、真实 HTTP/SSE 和真实 local persistence 验证 Alpha 最小问答内核（6 个 e2e-alpha-xx 用例），作为串行底座核心路径回归保护。 | [详情](../nextagent-ts-changes/add-ts-e2e-alpha-kernel-gate.md) |
