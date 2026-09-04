# Design: Watermark Lazy Config Provider

## 问题根因

`readWatermarkEnabled` 在 `create-app.ts` composition 阶段同步调用一次，读取 `{agentsRoot}/{activeAgentId}/config/config.json`。K8s 部署中 agents 目录由 CSI 卷异步挂载，进程启动时文件可能不存在，`readFileSync` 抛 `ENOENT`，函数返回 `false`，水印 port 不注入，后续请求无法恢复。

## 同类配置读取对比

| 配置 | 读取时机 | 缓存 | 模式 |
|---|---|---|---|
| 文件上传 (ChatUploadFileConfig) | 请求时 | statSync 指纹 | RemoteChatUploadConfigProvider |
| Skill (agent-owned) | 请求时 | 无 | SEARCH + locate |
| Recipe | 首次调用时 | Map 缓存 | lazy + cache |
| 水印 (当前) | 启动时 | 无 | readFileSync 一次 |

## 设计方案

### WatermarkConfigProvider

新增 `WatermarkConfigProvider` 接口，暴露 sync `get(): boolean` 方法。内部使用 `statSync` 指纹缓存（`size + mtimeMs`），同 `RemoteChatUploadConfigProvider` 的 `computeConfigFingerprint` 模式：

1. 构造时不读文件
2. `get()` 调用时：计算 config.json 的 statSync 指纹
3. 指纹与缓存一致 → 返回缓存值
4. 指纹不一致或无缓存 → 调用 `readWatermarkEnabled(systemConfig)` 读文件 → 缓存结果 + 指纹
5. 文件不存在 → 指纹为 undefined → 返回 false

`readWatermarkEnabled` 函数保留不动，provider 内部复用其路径解析和 JSON 校验逻辑。

### 接口变更

将 channel 层依赖接口中的 `watermarkEnabled?: boolean` 替换为 `getWatermarkEnabled?: () => boolean`：

- **composition-contracts.ts**: `WebChannelRegistrationContext.watermarkEnabled` -> `getWatermarkEnabled`
- **requests.ts**: `WebChannelDependencies.watermarkEnabled` -> `getWatermarkEnabled`
- **web-stream-delivery.ts**: `WebStreamDeliveryRequest.watermarkEnabled` -> `getWatermarkEnabled`
- **websocket.ts**: `WebSocketStreamDependencies.watermarkEnabled` -> `getWatermarkEnabled`

sync 接口，所有 check 点从 `dependencies.watermarkEnabled === true` 改为 `dependencies.getWatermarkEnabled?.() === true`，不需要 async 改造。

### 注入点变更

`channel-composition.ts` 两处注入点（`registerProductWebChannel` + `registerIrWebChannel`），当 `gatewayBindings.watermark` 存在时：

- 当前：`!context.watermarkEnabled` 为 true 时跳过 port 注入
- 改为：总是注入 port + 传递 `getWatermarkEnabled`

这样 port 始终可用（binding 存在时），水印是否生效由请求时 `getWatermarkEnabled()` 懒读取决定。

### create-app.ts 变更

当前代码：`const watermarkEnabled = gatewayBindings?.watermark !== undefined ? readWatermarkEnabled(systemConfig) : false;`

改为：`const watermarkConfigProvider = gatewayBindings?.watermark !== undefined ? createWatermarkConfigProvider(systemConfig) : undefined;`

传递 `getWatermarkEnabled: watermarkConfigProvider?.get.bind(watermarkConfigProvider)` 到 channel layer。

## 性能分析

`statSync` 是微秒级系统调用，仅在 config.json 指纹变化时才触发一次 `readFileSync` + `JSON.parse`。与每次请求调用的 watermark HTTP 网关（毫秒级网络 IO）相比可忽略。同 `RemoteChatUploadConfigProvider` 已在生产使用此模式。

## 边界确认

1. **不修改 transform 逻辑**：500 字符阈值、fail-open、作用对象不变。
2. **不修改持久化**：水印仍在读取时动态调用，不写回。
3. **不修改 runtime**：水印仍是 channel 层独有，runtime 不感知。
4. **readWatermarkEnabled 保留**：测试继续使用，provider 内部复用。
5. **guardrail 不受影响**：guardrailEnabled 保持 boolean，因为 guardrail 不需要读配置文件。
