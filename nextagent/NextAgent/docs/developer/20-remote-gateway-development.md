# Remote Gateway 开发指南

这一篇面向需要在外部仓库开发 remote gateway package 的团队。目标是说明三件事：

- 如何开发 remote `GatewayProvider`
- 如何通过 gateway configuration 选择 remote binding
- 如何在 remote entrypoint 中注入并启动 NextAgent

## 先说结论

remote gateway 的正确边界是：

- `agent-app` 只接收 `GatewayProvider` SPI，不 import 任何具体 remote package。
- 外仓 remote entrypoint 负责 import 具体 remote provider，并调用 `createNextAgentApp({ gatewayProviders })`。
- `gateway.gateways[]` 只负责选择哪个 gateway adapter 走 `REMOTE`，不承载 vendor endpoint、credential、SDK client 等私有接入细节。
- `@nextagent/agent-platform-gateway-remote` 是参考实现 package，不是零参数可启动入口。

最小启动形态：

```ts
import { createNextAgentApp } from "@nextagent/agent-app";
import { createRemoteGatewayProvider } from "@nextagent/agent-platform-gateway-remote";

const app = createNextAgentApp({
  gatewayProviders: [createRemoteGatewayProvider()]
});

await app.start();
```

## 关键概念

### GatewayProvider SPI

`GatewayProvider` 来自 `@nextagent/agent-contracts/gateway`。remote package 只需要实现这个 SPI：

```ts
import type { GatewayProvider } from "@nextagent/agent-contracts/gateway";

export function createRemoteGatewayProvider(): GatewayProvider {
  return {
    providerId: "vendor-remote-gateway",
    deploymentMode: "REMOTE",
    supportedAdapterKinds: ["sandbox", "rag-knowledge", "skillhub"],
    create(input) {
      const selectedKinds = new Set(input.selectedEntries.map((entry) => entry.adapterKind));

      return {
        providerId: "vendor-remote-gateway",
        deploymentMode: "REMOTE",
        readiness: {
          state: "READY",
          evidenceRef: "gateway-provider:vendor-remote-gateway:ready",
          safeMessage: "Vendor remote gateway provider is ready."
        },
        ...(selectedKinds.has("sandbox") ? { sandbox: vendorSandboxGateway } : {}),
        ...(selectedKinds.has("rag-knowledge") ? { ragRetrieval: vendorRagRetrievalGateway } : {})
      };
    }
  };
}
```

SPI 约束：

- `deploymentMode` 必须是 `"REMOTE"`。
- `supportedAdapterKinds` 必须只声明当前 package 真正能提供的 adapter。
- `create(input)` 只能为 `input.selectedEntries` 中选中的 adapter 创建 binding。
- 未选中的 adapter 不得作为副作用创建。
- selected adapter 缺少 binding 时必须返回 `BLOCKED` readiness 或抛出安全错误，由 `agent-app` fail closed。
- 返回的 `GatewayBindings` 不得暴露私有 SDK client、连接池、raw endpoint、raw credential 或 provider 原始配置。

### GatewayBindings

remote provider 当前可返回的稳定 binding 包括：

| Adapter kind | GatewayBindings 字段 | 说明 |
| --- | --- | --- |
| `sqlite` | `stores` | 远端持久化 store bindings；只有 vendor 真正实现完整 store port 时才声明 |
| `sandbox` | `sandbox` | 远端 sandbox execution gateway |
| `rag-knowledge` | `ragRetrieval` | 远端 RAG retrieval gateway |
| `scheduled-maintenance` | `scheduledMaintenance` | 远端维护任务 gateway |
| `skillhub` | 无专用字段 | 当前通过 capability/source 侧 SPI 注入，不新增私有 `GatewayBindings` 字段 |

## 如何开发 remote package

如果 remote gateway 仍在外仓独立开发，推荐把相同结构映射到外仓自己的 remote gateway module；如果与当前仓合并打包，则直接落在 `packages/agent-platform-gateway-remote`：

```text
packages/agent-platform-gateway-remote/
├── package.json
├── src/
│   ├── index.ts                         # public export facade
│   ├── bindings/
│   │   └── remote-gateway-bindings.ts   # selected binding assembly
│   ├── providers/
│   │   └── remote-gateway-provider.ts   # GatewayProvider SPI implementation
│   ├── sandbox/
│   │   └── vendor-sandbox-gateway.ts
│   ├── rag/
│   │   └── vendor-rag-retrieval-gateway.ts
│   ├── scheduled/
│   │   └── vendor-scheduled-maintenance.ts
└── tests/
    └── remote-gateway-provider.test.ts

packages/agent-remote-deployment/
├── package.json
└── src/
    └── index.ts                         # app + local provider + remote provider assembly
```

本仓 `@nextagent/agent-platform-gateway-remote` 的参考代码按同样职责拆分：

| 参考路径 | 外仓职责 |
| --- | --- |
| `src/providers/remote-gateway-provider.ts` | 实现 `GatewayProvider`，校验 REMOTE selection，调用 bindings assembly |
| `src/bindings/remote-gateway-bindings.ts` | 根据 selected adapter kind 组装 `GatewayBindings`，缺 binding 时 fail closed |
| `src/sandbox/reference-remote-sandbox.ts` | 把 vendor sandbox client 适配为 `SandboxGatewayPort` |
| `src/rag/reference-remote-rag-retrieval.ts` | 把 vendor RAG client 适配为 `RagRetrievalGateway` |
| `src/scheduled/reference-remote-scheduled-maintenance.ts` | 把 vendor scheduled maintenance client 适配为 `ScheduledMaintenanceGatewayPort` |

remote gateway package 的 `package.json` 应只暴露 public entry：

```json
{
  "name": "@nextagent/agent-platform-gateway-remote",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "dependencies": {
    "@nextagent/agent-contracts": "1.0.0"
  }
}
```

如果 remote gateway 代码与当前仓合并打包，则不再保留独立 vendor gateway 包，而是把 remote gateway 实现放入 `@nextagent/agent-platform-gateway-remote`，只保留 `agent-remote-deployment` 作为部署装配包。依赖方向保持：

```text
agent-platform-gateway-remote -> agent-contracts
agent-remote-deployment -> agent-app / agent-platform-gateway-local / agent-platform-gateway-remote
```

`src/index.ts` 只导出 public factory 和稳定 adapter facade：

```ts
export { createRemoteGatewayProvider } from "./providers/remote-gateway-provider.js";
export { createVendorSandboxGateway } from "./sandbox/vendor-sandbox-gateway.js";
export { createVendorRagRetrievalGateway } from "./rag/vendor-rag-retrieval-gateway.js";
```

`src/providers/remote-gateway-provider.ts` 按 selected entries 创建 binding：

```ts
import type {
  GatewayAdapterKind,
  GatewayBindings,
  GatewayProvider,
  GatewayProviderCreateInput
} from "@nextagent/agent-contracts/gateway";

const supportedAdapterKinds: readonly GatewayAdapterKind[] = [
  "sandbox",
  "rag-knowledge",
  "skillhub"
];

export function createRemoteGatewayProvider(): GatewayProvider {
  return {
    providerId: "vendor-remote-gateway",
    deploymentMode: "REMOTE",
    supportedAdapterKinds,
    create(input) {
      const selectedKinds = new Set(input.selectedEntries.map((entry) => entry.adapterKind));

      if (selectedKinds.has("sandbox") && !isVendorSandboxReady()) {
        return blocked("sandbox");
      }

      return {
        providerId: "vendor-remote-gateway",
        deploymentMode: "REMOTE",
        readiness: {
          state: "READY",
          evidenceRef: "gateway-provider:vendor-remote-gateway:ready",
          safeMessage: "Vendor remote gateway provider is ready."
        },
        ...(selectedKinds.has("sandbox") ? { sandbox: createVendorSandboxGateway() } : {}),
        ...(selectedKinds.has("rag-knowledge") ? { ragRetrieval: createVendorRagRetrievalGateway() } : {})
      };
    }
  };
}

function blocked(reason: string): GatewayBindings {
  return {
    providerId: "vendor-remote-gateway",
    deploymentMode: "REMOTE",
    readiness: {
      state: "BLOCKED",
      evidenceRef: `gateway-provider:vendor-remote-gateway:${reason}`,
      safeMessage: "Vendor remote gateway provider is not ready."
    }
  };
}
```

`src/bindings/remote-gateway-bindings.ts` 推荐只做 selected binding assembly：

```ts
import type {
  GatewayBindings,
  GatewayProviderCreateInput
} from "@nextagent/agent-contracts/gateway";
import { createVendorRagRetrievalGateway } from "../rag/vendor-rag-retrieval-gateway.js";
import { createVendorSandboxGateway } from "../sandbox/vendor-sandbox-gateway.js";

export function createVendorRemoteGatewayBindings(input: GatewayProviderCreateInput): GatewayBindings {
  const selectedKinds = new Set(input.selectedEntries.map((entry) => entry.adapterKind));

  return {
    providerId: "vendor-remote-gateway",
    deploymentMode: "REMOTE",
    readiness: {
      state: "READY",
      evidenceRef: "gateway-provider:vendor-remote-gateway:ready",
      safeMessage: "Vendor remote gateway provider is ready."
    },
    ...(selectedKinds.has("sandbox") ? { sandbox: createVendorSandboxGateway() } : {}),
    ...(selectedKinds.has("rag-knowledge") ? { ragRetrieval: createVendorRagRetrievalGateway() } : {})
  };
}
```

## 如何配置 binding

系统配置通过 `gateway.gateways[]` 选择 adapter。配置字段使用 `gatewayKind`，冻结后的 selection snapshot 内部会映射为 `adapterKind`。

### 全 remote 示例

```json
{
  "gateway": {
    "gateways": [
      { "gatewayId": "remote-stores", "gatewayKind": "sqlite", "deploymentMode": "REMOTE" },
      { "gatewayId": "remote-sandbox", "gatewayKind": "sandbox", "deploymentMode": "REMOTE" },
      { "gatewayId": "remote-rag", "gatewayKind": "rag-knowledge", "deploymentMode": "REMOTE" },
      { "gatewayId": "remote-maintenance", "gatewayKind": "scheduled-maintenance", "deploymentMode": "REMOTE" },
      { "gatewayId": "remote-skillhub", "gatewayKind": "skillhub", "deploymentMode": "REMOTE" }
    ]
  }
}
```

### local + remote 混合示例

```json
{
  "gateway": {
    "gateways": [
      { "gatewayId": "local-stores", "gatewayKind": "sqlite", "deploymentMode": "LOCAL", "sqliteFileRef": "paths.sqliteFile" },
      { "gatewayId": "remote-sandbox", "gatewayKind": "sandbox", "deploymentMode": "REMOTE" },
      { "gatewayId": "remote-rag", "gatewayKind": "rag-knowledge", "deploymentMode": "REMOTE" },
      { "gatewayId": "remote-skillhub", "gatewayKind": "skillhub", "deploymentMode": "REMOTE" }
    ]
  }
}
```

配置规则：

- 每个 `gatewayKind` 在同一配置中最多出现一次。
- `deploymentMode: "REMOTE"` 表示该 adapter 必须由 injected remote provider 支撑。
- 配了 remote entry 但没有注入 remote provider 时，启动必须阻断。
- remote provider 没有声明支持 selected `gatewayKind` 时，启动必须阻断。
- selected binding 缺失时，启动必须阻断，不允许回退到 local。
- vendor endpoint、credential、tenant route、PaaS SDK 连接参数应由外仓 remote package 自己读取和校验，不放进 NextAgent 通用 gateway configuration。

## 如何使用

### 外仓 remote deployment package

remote deployment package 由外仓拥有，可以依赖 `agent-app` 和 local gateway：

```ts
import { createNextAgentApp } from "@nextagent/agent-app";
import { createLocalGatewayProvider } from "@nextagent/agent-platform-gateway-local";
import {
  createReferenceRemoteRagRetrievalGateway,
  createReferenceRemoteSandboxGateway,
  createRemoteGatewayProvider
} from "@nextagent/agent-platform-gateway-remote";

export function createRemoteNextAgentApp({ remoteGatewayClients }) {
  return createNextAgentApp({
    gatewayProviders: [
      createLocalGatewayProvider(),
      createRemoteGatewayProvider({
        providerId: "vendor-remote",
        bindings: {
          sandbox: createReferenceRemoteSandboxGateway(remoteGatewayClients.sandbox),
          ragRetrieval: createReferenceRemoteRagRetrievalGateway(remoteGatewayClients.ragRetrieval)
        }
      })
    ]
  });
}
```

启动脚本：

```ts
import { createRemoteNextAgentApp } from "@nextagent/agent-remote-deployment";

const app = createRemoteNextAgentApp({ remoteGatewayClients });
await app.start();
```

runtime package 标准启动 entry：

```ts
import { startRemoteRuntimePackage } from "@nextagent/agent-remote-deployment";

await startRemoteRuntimePackage(packageRoot);
```

参考实现会读取 `${packageRoot}/config/default-system.yaml`，同时注入 `createLocalGatewayProvider()` 和 `createRemoteGatewayProvider()`。只有 `gateway.gateways[]` 选择到 `deploymentMode: "REMOTE"` 的 adapter 时，才会按需读取对应远端 endpoint：

```text
NEXTAGENT_REMOTE_SANDBOX_ENDPOINT
NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT
```

如果部署包使用 `bin/nextagent-start` launcher，推荐在 `config/default-system.yaml` 的 `deployment` 下声明 REMOTE entrypoint：

```yaml
deployment:
  mode: REMOTE
  deploymentEntrypointRefs:
    REMOTE:
      module: "@nextagent/agent-remote-deployment"
      exportName: "startRemoteRuntimePackage"
```

`candidate-manifest.json` 仍会提供默认 LOCAL entrypoint 和包元数据；`default-system.yaml` 中的 `deployment.deploymentEntrypointRefs` 会覆盖或补充 manifest entry map。`deployment.mode: "REMOTE"` 选择合并后的 `REMOTE` entrypoint；REMOTE entrypoint 未声明、不可加载或不导出指定函数时启动必须阻断，不能回退到 LOCAL。

本仓提供可复制代码示例：`packages/agent-platform-gateway-remote` 和 `packages/agent-remote-deployment`。其中 `agent-platform-gateway-remote` 提供 `createRemoteGatewayProvider()` 与 adapter reference；deployment 包负责把 `agent-app`、`agent-platform-gateway-local` 和 remote provider 装配起来。

### 基于参考实现二开

如果外仓希望先复用仓内参考实现，可以显式传入 bindings：

```ts
import { createRemoteGatewayProvider } from "@nextagent/agent-platform-gateway-remote";

export const provider = createRemoteGatewayProvider({
  providerId: "vendor-remote-gateway",
  bindings: {
    sandbox: vendorRemoteSandbox,
    ragRetrieval: vendorRemoteRagRetrieval,
    scheduledMaintenance: vendorRemoteScheduledMaintenance
  }
});
```

也可以传 factory，按 selected entries 延迟创建：

```ts
import { createRemoteGatewayProvider } from "@nextagent/agent-platform-gateway-remote";

export const provider = createRemoteGatewayProvider({
  providerId: "vendor-remote-gateway",
  bindings: (input) => {
    const selectedKinds = new Set(input.selectedEntries.map((entry) => entry.adapterKind));

    return {
      ...(selectedKinds.has("sandbox") ? { sandbox: createVendorSandboxGateway() } : {}),
      ...(selectedKinds.has("rag-knowledge") ? { ragRetrieval: createVendorRagRetrievalGateway() } : {})
    };
  }
});
```

这条路径只适合作为二开参考或过渡封装。目标态仍建议外仓直接实现自己的 `GatewayProvider`，避免把 vendor access baseline 藏在 NextAgent 仓内。

## 验证清单

remote gateway package 至少应覆盖这些测试：

- provider `deploymentMode` 固定为 `"REMOTE"`。
- provider `supportedAdapterKinds` 与真实能力一致。
- `create(input)` 只返回 selected adapter 对应 binding。
- 未选择的 adapter 不会被创建。
- selected binding 缺失时返回 `BLOCKED` readiness 或安全失败。
- returned `GatewayBindings` 不包含 raw endpoint、raw credential、SDK client、连接池或 provider 私有配置。
- remote entrypoint 调用 `createNextAgentApp({ gatewayProviders: [...] })`，不提供不完整的零参数默认启动。

仓内验证命令：

```bash
npm run build
npm test
npm run test:contract
npm run lint:architecture
openspec validate --all --strict
```

## 常见问题

### 是否可以让 `agent-app` 直接 import remote provider？

不可以。`agent-app` 是 composition root，只接收 `GatewayProvider` SPI 和结构化 options。具体 provider 由 local / remote entrypoint import 后注入。

### remote package 能不能提供零参数启动入口？

只有当这个 package 自己拥有完整 remote bindings、factories、配置读取和 readiness 校验时才可以。作为通用参考实现的 `agent-platform-gateway-remote` 不提供零参数可启动入口。

### `gateway.gateways[]` 是否应该放 remote endpoint 和 credential？

不应该。gateway configuration 只负责 adapter selection、deployment mode、provider resolve 和 bindings handoff。endpoint、credential、SDK client、tenant route 等属于 vendor remote package 的私有 access baseline。

### `skillhub` 为什么没有 `GatewayBindings.skillhub`？

当前 `skillhub` 通过 capability/source 侧 SPI 注入，不在 `GatewayBindings` 中新增私有字段。配置里可以选择 `gatewayKind: "skillhub"`，但具体 SkillHub 能力接入应由 remote package 的 capability/source 实现负责。

## 相关文档

- [部署说明](./12-deployment.md)
- [业务二次开发指南](./18-business-secondary-development.md)
- [架构概览](./02-architecture.md)
- [`agent-platform-gateway-remote` README](../../packages/agent-platform-gateway-remote/README.md)
