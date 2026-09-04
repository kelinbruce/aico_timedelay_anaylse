## 背景与问题（Why）

当前 NextAgent 已有统一 capability contract 和内置工具发现路径，但还缺少从 CLIP Server 动态发现普通 Tool capability 的接入点。CLIP Server 维护外部 API/capability catalog，并通过受控 `clipc` 边界提供发现和执行能力。

本 change 解决一个最小问题：把已配置、已注册的 `clip_server` custom provider 在启动时发现到的每一个 CLIP API/capability，分别作为普通 `CapabilityDescriptor(kind=TOOL)` 接入统一 capability catalog，并在被调用时通过统一 `CapabilityInvocationRequest` / `CapabilityInvocationResult` 边界执行。

## 变更范围（What Changes）

- 新增 `clip_server` custom provider adapter 的发现和执行接入。
- 复用现有 `CapabilityProviderKind.CUSTOM` 和 `providerType="clip_server"`，不新增 `CapabilityProviderKind`。
- 复用现有 `CapabilityProviderConfig.options.customOptions` 承载 CLIP source 配置，不新增 `agent-contracts` public contract。
- 启动期只支持一次 `STARTUP_SCAN`：读取已启用的 `clip_server` provider 配置，通过注入的 CLIP command runner 获取工具列表，验证后注册为普通 Tool descriptors。
- 执行期通过 `CapabilityInvocationRequest.capabilityId` 定位已发现 Tool，再由 `clip_server` executor 通过注入的 CLIP command runner 映射到 CLIP 私有 capability id 和 `clipc` 调用。
- `clip_server` adapter registration 必须与 discovery、executor 和 runner wiring 同时成立；不得只登记 `registeredCustomAdapterTypes` 却缺少实际 adapter wiring。
- `ClipBackedToolDiscovery` 和 `ClipToolExecutor` 通过同一 provider-scoped internal registry 共享 capability id 到 provider-private CLIP id/primitive 的映射；该映射不得进入模型可见 descriptor metadata。

## Capability 粒度

CLIP Server 是 provider/source，不是模型可见工具。CLIP Server 发现到的每一个可调用 API/capability（例如 A、B、C）分别规范化为一个普通 Tool capability，并进入统一 capability catalog。

模型可见的 tool call 目标是 A/B/C 对应工具名和参数；不暴露统一 `clipc`、`clip_api_call` 或 `api_name + args` dispatch 工具。`clipc` 只属于 executor/gateway 内部实现细节。

## Capability 影响（Capabilities）

### 修改的 Capability

- `agent-capability`：增加 `clip_server` custom provider discovery/executor adapter，并接入现有 catalog/invocation 路径。
- `agent-app`：在 composition root 同时注入 `clip_server` discovery/executor wiring 和 CLIP command runner 的生产实现，该实现必须复用现有 sandbox/gateway execution boundary。

### 不修改的 Capability

- `agent-contracts`：只复用既有 `CUSTOM + providerType`、`CapabilityDescriptor`、`CapabilityInvocationRequest` 和 `CapabilityInvocationResult`，本 change 不新增或重定义 public contract。

## 主要 Owner

- Owner 9 Tool Capability

## 非目标（Non-Goals）

- 不定义 CLIP 协议细节、认证机制、Adapter 路由逻辑或后端 API 执行语义。
- 不新增模型可见的统一 `clipc`、`clip_api_call` 或 `api_name + args` dispatch 工具。
- 不支持定时轮询、动态注销、手动 refresh、热更新或长期缓存刷新；这些能力后续独立 change 再定义。
- 不新增 `agent-contracts` public type、schema、enum 或 provider kind。
- 不新增 CLIP-specific gateway public port；CLIP command runner 是 `agent-capability` 内部注入抽象。
- 不新增 `SandboxExecutionRequest.executable` 枚举值；生产 runner 若调用 `clipc`，必须复用现有 sandbox/gateway execution boundary 的既有 executable 形态和受控命令模板。
- 不新增第二套 catalog、discovery、conflict resolution、invocation result 或 audit vocabulary。
- 不定义 bundled、local、remote installed、SkillHub、Agent-scoped Skill 或 Skill invocation/source 语义。
- 不真实暴露 raw CLIP payload、credential、local path、endpoint secret 或 adapter-private failure detail。

## 成功标准

- 未注册 `clip_server` custom adapter 时，CLIP-backed descriptor 不得进入可执行 catalog，并产生 safe diagnostic。
- 注册且配置有效时，启动扫描返回的 A/B/C 被验证并注册为普通 `TOOL` descriptors。
- 调用 A/B/C 时，executor 从 `CapabilityInvocationRequest.capabilityId` 派生 provider-private CLIP 调用，并把 runner 返回结果规范化为 `CapabilityInvocationResult`。
- CLIP command runner 不可用、配置非法或 descriptor 非法时，失败显式降级为 safe unavailable/diagnostic，不阻塞无关工具。
