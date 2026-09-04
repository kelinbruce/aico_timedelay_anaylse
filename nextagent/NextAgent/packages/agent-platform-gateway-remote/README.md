# agent-platform-gateway-remote

职责：remote gateway adapter skeleton、fetch-compatible remote service boundary、PaaS sandbox gateway adapter boundary 和 failure normalization。

非职责：不把 PaaS SDK、sandbox SDK、remote endpoint SDK、driver-specific record 或 platform topology 泄漏到 runtime、core、context、channel、capability 或 contracts。

Public exports：`@nextagent/agent-platform-gateway-remote`。本 package 属于外部 remote gateway 实现代码边界，仅作为 remote provider / adapter implementation reference；支持 vendor / 客户侧在独立代码仓跨仓开发、替换和二次开发。当前仓内代码只提供可复制参考，不是主仓必须承载的唯一产品实现。remote app entrypoint 由外部 vendor package 拥有并显式注入完整 remote bindings / factories。

参考目录结构按“外仓可复制 module”组织：

```text
src/
├── bindings/
│   └── remote-gateway-bindings.ts
├── providers/
│   └── remote-gateway-provider.ts
├── rag/reference-remote-rag-retrieval.ts
├── sandbox/reference-remote-sandbox.ts
├── scheduled/reference-remote-scheduled-maintenance.ts
└── index.ts
```

如果 vendor 希望把 remote 相关代码与 NextAgent 当前代码放进同一个 workspace 一起编译构建，remote gateway 实现可合并到本 package，只额外保留 deployment 装配包；如果采用跨代码仓开发，则外仓应保留等价结构并通过 package 依赖接入：

```text
packages/
├── agent-platform-gateway-remote/
│   └── src/
└── agent-remote-deployment/
    ├── package.json
    └── src/index.ts
```

依赖方向必须保持：

```text
@nextagent/agent-remote-deployment
  -> @nextagent/agent-app
  -> @nextagent/agent-platform-gateway-local
  -> @nextagent/agent-platform-gateway-remote
```

`@nextagent/agent-platform-gateway-remote` 不得依赖 `@nextagent/agent-app`，否则会重新形成 `agent-app` / concrete gateway 的循环依赖风险。`@nextagent/agent-remote-deployment` 同样属于外部实现代码边界，是负责装配 app、local provider 和 remote provider 的部署参考包；vendor 可在外仓提供等价 deployment package。

职责切分：

| 目录 | 职责 |
| --- | --- |
| `providers/` | 实现 `GatewayProvider` SPI，只处理 selected entries、readiness 和 fail closed |
| `bindings/` | 组装 `GatewayBindings`，只返回 selected adapter 对应 port |
| `sandbox/`、`rag/`、`scheduled/` | 把 vendor client 适配成稳定 gateway port，不把 endpoint / credential / SDK 类型暴露给 contracts |

`createRemoteGatewayProvider()` 是二开参考入口，不是零参数可启动入口。外仓 vendor package 应显式传入被选中的 remote gateway bindings：

```ts
import { createRemoteGatewayProvider } from "@nextagent/agent-platform-gateway-remote";

export const provider = createRemoteGatewayProvider({
  providerId: "vendor-remote-gateway",
  bindings: {
    stores: vendorRemoteStores,
    sandbox: vendorRemoteSandbox,
    ragRetrieval: vendorRemoteRagRetrieval,
    scheduledMaintenance: vendorRemoteScheduledMaintenance
  }
});
```

provider 只会把当前 `GatewayProviderCreateInput.selectedEntries` 选中的 adapter 对应 binding 返回给 `agent-app`；未选中的 binding 不进入调用路径。若 selected adapter 缺少对应 binding，provider 返回 `BLOCKED` readiness，由 `agent-app` fail closed。`skillhub` 当前通过 capability/source 侧 SPI 注入，不在 `GatewayBindings` 中新增私有字段。

adapter 参考实现示例：

```ts
import {
  createReferenceRemoteRagRetrievalGateway,
  createReferenceRemoteSandboxGateway,
  createRemoteGatewayProvider
} from "@nextagent/agent-platform-gateway-remote";

export const provider = createRemoteGatewayProvider({
  providerId: "vendor-remote-gateway",
  bindings: (input) => {
    const selectedKinds = new Set(input.selectedEntries.map((entry) => entry.adapterKind));
    return {
      ...(selectedKinds.has("sandbox")
        ? { sandbox: createReferenceRemoteSandboxGateway(vendorSandboxClient) }
        : {}),
      ...(selectedKinds.has("rag-knowledge")
        ? { ragRetrieval: createReferenceRemoteRagRetrievalGateway(vendorRagClient) }
        : {})
    };
  }
});
```

Allowed dependencies：`agent-common`、架构授权的 `agent-contracts/gateway` subpath、fetch-compatible client 和 adapter-local PaaS SDK。

Forbidden dependencies：runtime private state、Web channel private paths、provider SDK leakage into contracts；gateway implementation 源码不得依赖 `agent-app`。

替换边界：是，gateway adapter 可整包替换。
