# agent-platform-gateway-remote

## 职责

承载 remote gateway adapter skeleton、fetch-compatible remote adapter skeleton、PaaS sandbox gateway adapter skeleton、remote complete-service memory adapter boundary 和 failure normalization。

SkillHub compatibility adapter belongs here when a deployment enables remote Skill content. It owns concrete service URL / credential resolution, HTTP path and wire DTO handling, legacy ZIP or single-file payload decoding, safe materialization into a controlled staging root, and conversion of provider-private package/service consistency facts into provider-neutral content consistency before returning a normalized staged Skill folder to `agent-capability`.

## 非职责

不把 remote SDK、PaaS sandbox SDK、OS/container API 或平台内部错误类型泄漏到 contracts、core、runtime、capability 或 model。

## 依赖

允许依赖 `@nextagent/agent-common`、`@nextagent/agent-contracts/gateway` 和 adapter-local libraries。不得依赖 Web channel、runtime implementation、core、app composition 或其它 implementation package。

## 核心设计落点

- REMOTE/PaaS deployment package在 infrastructure boundary直接拥有 official OTLP HTTP/protobuf metric exporter composition；signal-specific endpoint优先于general endpoint，并只允许标准 headers/compression/timeout。缺 endpoint时metrics degraded，不使用localhost默认值或LOCAL文件fallback。
- Remote audit只消费entrypoint-selected `GatewayBindings.audit`；缺失或服务失败不得fallback到LOCAL文件、SQLite或operational log。

- 落实 `architecture/ts-backend-architecture.md` 的 remote gateway replacement boundary 和后续 PaaS 多实例运行形态。
- 当前默认产品路径仍使用 gateway-local；remote gateway endpoint、PaaS sandbox adapter、remote complete-service memory protocol 和 long-running/cancelable gateway cancellation 由后续 change 定义。
- `agent-capability` must not consume SkillHub service-private URL, credential, `packageBytesBase64`, archive shape or HTTP DTO facts; remote gateway adapters normalize those facts before crossing the capability access boundary.
- Remote adapter 必须把 remote service/PaaS SDK 行为转换成稳定 gateway contract，不向核心模块泄漏 SDK 类型或 provider-native error。
- Remote complete-service memory backend 若被 app composition 选择，必须实现同一 consumer-facing long-term memory gateway ports，并与 local backend lifecycle orchestration 互斥。本地 task trajectory/extraction/aging/revival helper 不得在 remote complete-service memory backend 下运行。
- Remote Working Memory or Long-term Memory providers, when introduced, must return complete capability-specific bindings for the selected gateway entry. A remote Long-term Memory provider must provide store and retriever from the same provider; a remote Working Memory provider must preserve request/session composite transaction semantics through its own provider boundary. Provider-private endpoint, credential, client and wire DTO facts must not enter domain packages.
- `createRemoteApiCallPort` 实现 `ApiCallPort` 的 REMOTE deployment 占位：当前返回 503 `UNAVAILABLE`，UDS 实际调用方式后续填充。`agent-app` composition 按 `deploymentMode=REMOTE` 选择该实现并注入到 `toolDependencies.apiCallPort`。该占位确保 REMOTE 部署下 `ApiCall` tool descriptor 进入 unavailable 状态而非 catalog 装配失败。

## 替换边界

是。Remote platform gateway adapter 可整包替换。

## 验证关注点

- PaaS sandbox SDK、remote API SDK 和 provider-specific errors 不得泄漏到 contracts/core/runtime/capability/model。
- PaaS 多实例启用时正确性不得依赖 sticky session 或 process-local lifecycle。
- Remote complete-service memory backend 启用时，本地 memory lifecycle scheduler/helper 必须保持 disabled；远端服务错误必须映射为 presentation-safe outcome。
- failure normalization 必须返回 presentation-safe outcome。

## Public Exports

`@nextagent/agent-platform-gateway-remote`
