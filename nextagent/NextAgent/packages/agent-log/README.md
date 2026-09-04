# agent-log

职责：拥有 operational log 的唯一物理 writer、Pino envelope、console/file sink、surface-bound `RuntimeLogger`、redaction/size budget、overload及 maintenance lifecycle evidence 与 operational file policy。

非职责：不写 audit record 或 metric snapshot，不读取 operational archive，不创建 observation，不向业务 package 暴露 Pino、SonicBoom、pino-roll 或文件生命周期类型。

Public exports：`@nextagent/agent-log`；`@nextagent/agent-log/testing` 仅供显式测试使用。

Allowed dependencies：`agent-common`、`agent-local-file-roll` 与 `pino`。只有 `agent-app` composition 和显式测试可以创建 concrete writer。

Forbidden dependencies：`agent-contracts`、其他 implementation package、gateway storage、provider SDK，以及 operational log 之外的 audit/metrics 输出实现。

替换边界：是。业务 owner 只接收 structural `RuntimeLogger`，concrete writer 保持在 composition boundary。
