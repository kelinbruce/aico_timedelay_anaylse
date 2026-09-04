# agent-local-file-roll

职责：提供 Node-only、无领域语义的本地逐行文件生命周期机制，包括有界异步 append、size/daily 轮转、current-active identity、原子 gzip、startup reconciliation、elapsed-time retention、无路径的 maintenance outcome，以及有界 flush/close。

非职责：不理解 operational log、audit、metrics、deployment、readiness 或业务失败语义；不在不同调用方之间共享 handle、buffer、timer、maintenance lane 或 lifecycle state。

Public exports：`@nextagent/agent-local-file-roll` 提供完整 roll handle 和不创建 active destination 的 maintenance handle；`@nextagent/agent-local-file-roll/testing` 仅供显式测试使用。

Allowed dependencies：`pino-roll`、`sonic-boom` 与 Node.js filesystem/zlib primitives。

Forbidden dependencies：`agent-common`、`agent-contracts`、任何 NextAgent implementation package，以及任何领域 DTO、日志 envelope、audit record 或 metric snapshot。

替换边界：否。它是受 dependency firewall 保护的 technical foundation，production consumer 仅限 `agent-log`、`agent-observability` 与 `agent-platform-gateway-local`。
