# agent-test-kit

职责：schema samples、fake gateway、contract fixture、architecture test helpers。

非职责：不进入产品配置，不作为真实 provider、adapter 或 runtime 实现。

Public exports：`@nextagent/agent-test-kit`。

Allowed dependencies：`agent-common`、`agent-contracts` test-only public subpaths、`agent-plugin-sdk` public types、测试工具。

Forbidden dependencies：production adapter private paths、provider SDK、Web framework implementation internals。

替换边界：否。它只服务测试。
