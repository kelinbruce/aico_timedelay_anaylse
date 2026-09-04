## 背景与问题（Why）

NextAgent 的 workflow 执行当前只有 local 模式：`InMemoryWorkflowExecutionService` 在本进程内遍历 recipe flow graph，逐节点调用本地 node handler（LLM、capability、knowledge、interaction 等），recipe 定义从 app-composed recipe definition source 解析，recipe 可见性由 RECIPE capability catalog 表达。这套机制把"执行引擎"和"执行位置"耦合在一起——recipe 只能在持有完整 node handler 依赖（model invocation、capability catalog、knowledge gateway）的进程内执行。

电信网络智能体场景存在明确的拉远诉求：同一套 recipe 契约和执行接口需要部署到不同的执行位置。典型场景包括：边缘节点只做轻量入口编排，重 recipe 执行集中到区域中心服务；多套部署共享一个集中式 workflow 执行服务以统一治理 recipe 版本和执行审计；特定网络能力（网管系统对接、配置核查、告警定位）只在受控的远端执行环境可达，本地进程无法直接持有这些 capability。

当前架构缺少一个与 local 接口一致、仅执行位置不同的 remote 执行通道。`WorkflowExecutionService` 端口已经定义了统一的 `execute(request, signal, observer, runtime)` 契约，`agent-core` 消费方不感知执行位置；但唯一的实现是进程内 engine，且没有远端网关适配层把请求转发到远端服务并把结果、事件、pending input 安全映射回来。需要在保持现有 local 行为不变的前提下，新增 remote 执行模式，使 local 和 remote 共享同一 `WorkflowExecutionService` 端口，仅模式不同。

## 变更范围（What Changes）

- 新增 `WorkflowExecutionMode`（`"local"` | `"remote"`），默认 `"local"`。`agent-app` 启动组合时按可信配置选择模式；模式只影响 `WorkflowExecutionService` 实例的构造来源，不影响 `agent-core` 消费方调用形态。
- 新增 `WorkflowRemoteExecutionGateway` gateway port（`agent-contracts/core`），定义远端 workflow 执行的传输契约：以 `WorkflowExecutionRequest` 为入参，返回 `AsyncIterable<WorkflowRemoteExecutionStreamItem>`（流式产出 `WorkflowExecutionEvent`，最终产出 `WorkflowExecutionResult`），接收 `AbortSignal`。gateway port 是 async contract。port 放在 core 而非 gateway，因为 gateway subpath MUST NOT 依赖 core 业务 subpath，而本 port 需要复用 core 的 workflow 契约类型。
- 在 `agent-platform-gateway-remote` 新增 fetch-based `WorkflowRemoteExecutionGateway` 适配器实现，隔离 HTTP driver、credential、endpoint 和 safe error mapping 细节；远端不可达、超时、未授权或非法响应映射为 `SafeError`，不泄露 raw provider error、path 或 credential。
- 在 `agent-workflow` 新增 `createRemoteWorkflowExecutionService`，产出实现 `WorkflowExecutionService` 端口的 `RemoteWorkflowExecutionService`：将 `execute` 委托给 `WorkflowRemoteExecutionGateway`，在事件流式到达时实时回放到 observer（而非批量回放），把远端 WAITING 结果中的 pending input 通过本地 `runtime.requestPendingInput` 注册为本地 pending input，并把本地 id 回填到返回结果。事件实时回放使 `agent-core` 的 `WorkflowRuntimeEventProjector` 能在远端执行期间实时投影为 runtime timeline 事件，供页面呈现和持久化。
- `agent-app` composition 扩展：当配置模式为 `"remote"` 时，构造 `RemoteWorkflowExecutionService` 并注入 `agent-core`；`agent-core` 消费方代码不变。composition root 按 mode 直接选择 factory，不修改 `WorkflowExecutionServiceFactoryOptions`；`workflowExecutionServiceFactory` 优先于 mode 选择。
- local 与 remote 共享同一 `WorkflowExecutionRequest` / `WorkflowExecutionResult` / `WorkflowExecutionEvent` / `WorkflowExecutionObserver` 契约；不新增平行 DTO、不改变 `agent-core` 调用签名。
- 不新增 Web API、runtime command 或持久化 store。远端服务的 recipe registry 归属、远端服务端实现留给后续独立 change。gateway port 与 fetch 适配器在首版即支持 SSE 流式 event 传输，使远端执行期间的 streaming delta 实时到达 runtime timeline。
- **BREAKING**：无。local 模式行为和默认值不变；remote 模式是新增能力，未配置时完全不生效。

## Capability 影响（Capabilities）

### 新增 Capability
- `workflow-remote-execution-mode`: 定义 workflow 远端执行模式的行为边界——模式选择、远端 gateway port 契约、接口一致性、safe error mapping、远端响应 schema 校验、observer 事件回放、cancellation 传播、pending input 桥接和 composition 注入规则。

### 修改的 Capability
- `workflow-package`: Composition Wiring 需求扩展——`agent-app` 启动组合时 MUST 按 `WorkflowExecutionMode` 选择 local 或 remote `WorkflowExecutionService` 实现，默认 local。

## 影响范围（Impact）

 - `agent-contracts/core`：新增 `WorkflowRemoteExecutionGateway` port 和 `WorkflowRemoteExecutionStreamItem` 契约，与 `WorkflowExecutionService` 同属 workflow 执行契约族。
- `agent-contracts/core`：不修改现有 workflow contract；`WorkflowExecutionService` 端口签名不变。
- `agent-workflow`：新增 `createRemoteWorkflowExecutionService` 和 `RemoteWorkflowExecutionService` 实现；新增远端 event 回放和 pending input 桥接逻辑。
- `agent-platform-gateway-remote`：新增 fetch-based `WorkflowRemoteExecutionGateway` 适配器和工厂。
- `agent-app`：composition 扩展模式选择和远端 gateway 注入；config schema 增加 workflow execution mode 与远端 endpoint 配置。
- `agent-core`：消费方代码不变，仍通过 `WorkflowExecutionService` 端口调用。
- 安全：远端 gateway 必须映射为 safe error，不得泄露 prompt、raw model output、raw provider error、path、credential；owner scope 和 agent scope 字段只能来自可信 composition，不得来自远端响应覆盖。
- 测试：需要 contract 测试（gateway port 行为）、architecture 测试（边界隔离、无 private import）、characterization 测试（local 与 remote 结果等价性）、安全 negative 测试（safe error 不泄露、scope 不可被远端覆盖）。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/workflow-remote-execution-mode/spec.md`：新增——模式选择、远端 gateway port、接口一致性、safe error mapping、远端响应 schema 校验、observer 回放、cancellation、pending input 桥接、composition 注入。
- `openspec/specs/workflow-package/spec.md`：修改——Composition Wiring 需求增加模式选择。

长期背景：
- `openspec/overview.md`：补充 workflow 支持 local/remote 双执行模式、默认 local 的产品定位。

设计视图：
- `openspec/designs/architecture/workflow-remote-execution-mode.md`：新增——跨模块流程（agent-app → RemoteWorkflowExecutionService → gateway → 远端服务）、gateway 边界、safe error mapping、远端响应 schema 校验、observer 回放、pending input 桥接、安全与质量属性。
- `openspec/designs/modules/agent-workflow.md`：补充 RemoteWorkflowExecutionService 职责、远端 gateway 消费关系。
- `openspec/designs/modules/agent-platform-gateway-remote.md`：补充 fetch-based workflow remote gateway 适配器职责。
- `openspec/designs/modules/agent-app.md`：补充 workflow execution mode composition wiring。
- `openspec/designs/adr/workflow-remote-sse-streaming.md`：新增——SSE 流式 event 传输的设计决策。
- `openspec/designs/spec-to-design-map.md`：补充 workflow-remote-execution-mode spec 到 design 的导航。

验证入口：
- `openspec validate --all --strict`
- `npm run build`
- `npm run test:contract`
- `npm test -- --run workflow-remote`
- `npm run lint:architecture`
