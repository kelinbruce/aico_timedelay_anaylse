# API-Backed Tool Source Design

## 目标

本 change 为 `providerKind=CUSTOM`、`providerType="clip_server"` 的 custom provider 增加一个最小可执行接入路径：启动时发现 CLIP Server 暴露的 API/capability，将每个有效 API/capability 注册为普通 `TOOL` descriptor；执行时通过统一 capability invocation 边界调用对应 Tool，并由注入的 CLIP command runner 通过现有 sandbox/gateway execution boundary 完成 `clipc` 调用。

本 change 只支持启动期一次性发现。定时轮询、手动 refresh、动态注销、热更新和真实 CLIP 协议扩展均不在本 change 内实现。

## Current State

- `agent-contracts` 已有 `CapabilityProvider`、`CapabilityProviderConfig`、`CapabilityDescriptor`、`CapabilityInvocationRequest` 和 `CapabilityInvocationResult`。
- `CapabilityProviderKind` 已包含 `CUSTOM`，且 custom provider 已通过 `providerType` 标识 adapter 类型。
- `agent-app` 已有 custom provider adapter registration 校验；未注册 custom adapter 可以产生 safe diagnostic。
- `agent-capability` 已有 `CapabilityDiscoveryFactory`、`StaticCapabilityCatalog` 和 governed invocation path。
- 当前缺口是：`providerType="clip_server"` 没有 discovery/executor adapter，也没有注入的 CLIP command runner 去通过现有 sandbox/gateway execution boundary 获取 CLIP tool facts 或执行 CLIP-backed tool。
- 当前 `createCapabilitySubsystem` 已支持注入 discovery factory，但 executor factory 只装配内置工具 executor；本 change 需要补齐 `clip_server` executor 注入或 adapter registry wiring，使 discovered CLIP-backed descriptors 能进入现有 governed invocation path。
- 当前 `SandboxExecutionRequest.executable` 不包含 `clipc`；本 change 不扩展该 public enum。runner 生产实现若调用 `clipc`，必须通过现有 sandbox/gateway execution boundary 的既有 executable 形态和受控命令模板完成。

## 唯一实施路径

1. App composition 显式注册 `clip_server` custom provider adapter。
2. Registration 只有在 app composition 同时提供 `clip_server` discovery factory wiring、executor wiring 和 CLIP command runner wiring 时才成立；不得只把 `clip_server` 放入 `registeredCustomAdapterTypes`。
3. Provider configuration 使用现有 `CapabilityProviderConfig`：`provider.providerKind="CUSTOM"`、`provider.providerType="clip_server"`，CLIP source 配置放在 `options.customOptions`。
4. `agent-capability` 的 discovery factory 识别已注册且已 wired 的 `clip_server` provider，创建 `ClipBackedToolDiscovery`。
5. 启动期 catalog 注册 discovery，并通过现有 eager discovery 路径执行一次 `STARTUP_SCAN`。
6. `ClipBackedToolDiscovery` 只通过注入的 CLIP command runner 调用 list/describe；runner 的生产实现由 `agent-app` 组合并复用现有 sandbox/gateway execution boundary，验证返回 facts，并把每个有效 API/capability 映射为一个普通 `CapabilityDescriptor(kind="TOOL")`。
7. Discovery 把 capability id 到 provider-private CLIP id/primitive 的映射写入同一 provider-scoped internal registry；该映射不进入 descriptor metadata、model context、stream output 或 safe error。
8. `ClipToolExecutor` 只接收 `CapabilityInvocationRequest`，用 `request.capabilityId` 从同一 provider-scoped internal registry 定位 provider-private CLIP capability id 和执行 primitive。
9. `ClipToolExecutor` 调用注入的 CLIP command runner 执行 provider-private 调用并接收受控结果；executor 验证后规范化为 `CapabilityInvocationResult`。

这条路径不新增第二套 catalog、第二套 invocation envelope、第二套 conflict resolution，也不要求模型调用统一 `clipc` 工具。

## Capability 粒度

CLIP Server 是 provider/source；CLIP Server 返回的每个 API/capability 是模型可见普通 Tool capability。模型只看到被治理后的 A/B/C Tool descriptor，不看到 `clipc`、`clip_api_call` 或 `api_name + args` dispatch tool。

Agent binding、conflict resolution、prompt disclosure、invocation 和 audit 均以映射后的普通 Tool capability 为粒度。`clipc` 命令名、CLIP primitive 和 provider-private capability id 只允许停留在 `clip_server` adapter、内部 runner 或 sandbox/gateway execution boundary 内部。

## 组件归属

| 组件 | 模块 | 说明 |
|------|------|------|
| `ClipBackedToolDiscovery` | `agent-capability` | 从 gateway 获取 CLIP tool facts 并映射为普通 Tool descriptors |
| `ClipToolExecutor` | `agent-capability` | 从 `CapabilityInvocationRequest` 派生 CLIP execution request 并规范化结果 |
| `ClipToolRegistry` 或等价内部 map | `agent-capability` | 保存 capability id 到 provider-private CLIP id/primitive 的内部映射 |
| `ClipCommandRunner` 或等价内部注入接口 | `agent-capability` | 内部 runner 抽象，提供 list/describe/execute，不作为 `agent-contracts` public port |
| runner 生产实现 | `agent-app` composition | 装配到现有 sandbox/gateway execution boundary；不得要求 `agent-capability` import gateway-local implementation；不得新增 `SandboxExecutionRequest.executable` 值 |
| executor wiring | `agent-capability` + `agent-app` composition | 把 `ClipToolExecutor` 加入现有 `CapabilityExecutorFactory` 路径，避免 discovered descriptor 调用时无 executor |

`agent-contracts` 不承载 `ClipBackedToolSource`、`ClipBackedToolProvider`、`ClipBackedToolDescriptor`、`ClipCommandGateway` 或 CLIP-specific public type。本 change 只复用现有 public capability contract 和现有 sandbox/gateway execution boundary。

## 配置

`clip_server` provider 使用现有 custom provider 配置入口：

```json
{
  "provider": {
    "providerId": "clip-backed",
    "providerKind": "CUSTOM",
    "providerType": "clip_server"
  },
  "discoveryMode": "EAGER",
  "options": {
    "customOptions": {
      "enabled": true,
      "clipPathRef": "clipc",
      "endpointRef": "clip-daemon",
      "timeoutMs": 5000,
      "retry": { "maxAttempts": 1 }
    }
  }
}
```

`customOptions` 必须在 `agent-capability` adapter 边界做 runtime validation。非法配置使该 provider activation 安全失败，不注册部分 executable descriptors。

## Discovery Flow

1. `ClipBackedToolDiscovery.listAll(signal)` 接收启动期 eager discovery 调用。
2. Discovery 校验 `customOptions`。
3. Discovery 调用注入的 CLIP command runner 获取候选 capability ids，再按需要获取 descriptor facts。
4. Discovery 验证每个 candidate 的 id、description、input schema 和 safe metadata。
5. 验证通过的 candidate 映射为普通 `CapabilityDescriptor(kind="TOOL")`，provider identity 使用当前 `clip_server` provider。
6. Discovery 把 provider-private CLIP id/primitive 写入 provider-scoped internal registry。
7. 验证失败的 candidate 不进入 executable catalog，并产生 safe diagnostic。

## Invocation Flow

1. Runtime/core 通过现有 governed capability invocation path 调用 `CapabilityInvocationRequest`。
2. `ClipToolExecutor` 校验 `request.capabilityId` 对应已发现 CLIP-backed Tool。
3. Executor 从 provider-scoped internal registry 读取 provider-private CLIP id/primitive。
4. Executor 调用注入的 CLIP command runner；命令、primitive 和 provider-private id 不来自模型参数。
5. Runner 的生产实现通过现有 sandbox/gateway execution boundary 返回受控 result envelope。
6. Executor 验证 result 并映射为 `CapabilityInvocationResult`。

## Failure And Diagnostics

- `clip_server` adapter 未注册：provider 配置不得贡献 executable descriptor，并产生 safe diagnostic。
- 配置非法：provider activation 失败，不注册 partial descriptors。
- Discovery 中部分 candidate 非法：非法 candidate 不进入 catalog；其他合法 candidate 可继续注册。
- CLIP command runner、sandbox/gateway execution boundary 或 CLIP daemon 不可用：受影响 descriptors 标记为 `UNAVAILABLE` 或调用返回 governed failure，不伪装成功。
- Diagnostics 只包含 provider id、capability id、safe reason code、safe counts 和 failure class；不得包含 raw CLIP payload、raw arguments、credential、local path、endpoint secret 或 adapter-private error detail。

## Deferred

- Polling / periodic sync。
- Manual refresh。
- Dynamic unregister / hot update。
- Long-lived cache invalidation policy。
- Additional model-visible dispatch Tool shape。
- Any `agent-contracts` refinement。

## 验证

- Unit tests for configuration validation and adapter registration failure。
- Unit tests for discovery mapping A/B/C into separate ordinary Tool descriptors。
- Unit tests that no generic `clipc` / `clip_api_call` descriptor is produced。
- Unit tests for invocation deriving CLIP execution from `CapabilityInvocationRequest.capabilityId`。
- Unit tests for runner unavailable and invalid descriptor safe diagnostics。
- Architecture check that `agent-capability` does not directly execute host process commands, does not import gateway-local implementation, and uses only injected runner backed by the existing sandbox/gateway execution boundary。
