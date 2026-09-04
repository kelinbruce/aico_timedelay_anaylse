# add-ts-watermark-lazy-config

## Why

水印配置 `watermarkEnabled` 当前在应用启动时同步读取一次 `{agentsRoot}/{activeAgentId}/config/config.json`。在 K8s 部署中，agents 目录（`/opt/share/`）由 `sop-csi-driver` 异步挂载的 CSI 数据卷填充。Node 进程在卷就绪前启动，导致 `readFileSync` 抛 `ENOENT`，`readWatermarkEnabled` 返回 `false`，水印永久禁用——即使配置文件后续就绪且内容正确。

同仓的文件上传配置（`ChatUploadFileConfig`）、Skill 发现和 Recipe 加载均在请求时懒加载读取，不受 CSI 卷异步挂载影响。水印是唯一在启动时同步读、不缓存、不重试的配置，需要改为与同类配置一致的懒加载模式。

## What Changes

- **修改** `watermark-gateway` spec 中 "Watermark is disabled by default and controlled by config" requirement，增加请求时懒加载读取约束（MODIFIED watermark-gateway）。
- **修改** `watermark-composition.ts`，新增 `WatermarkConfigProvider`，使用 `statSync` 指纹缓存（同 `RemoteChatUploadConfigProvider` 模式），在请求时读取 `watermarkEnabled`。
- **修改** channel 层依赖接口，将 `watermarkEnabled?: boolean`（启动时定死）替换为 `getWatermarkEnabled?: () => boolean`（请求时懒读取），sync 接口，不需要改 async 调用链。
- **修改** composition 注入点，binding 存在时总是注入 watermark port + provider，不再因启动时配置读取失败而跳过 port 注入。

## Non-Goals

- 不改变水印 transform 逻辑（500 字符阈值、fail-open、作用对象等均不变）。
- 不改为 async 读取——`statSync` + `readFileSync` 的 sync 路径足够快（微秒级），与现有 `readWatermarkEnabled` 一致。
- 不修改 `readWatermarkEnabled` 函数签名——保留供测试和向后兼容使用。
- 不修改 watermark gateway binding 创建逻辑——binding 在启动时由 gateway selection 创建，不受影响。

## Validation

- `npx vitest run packages/agent-app/tests/watermark-config.test.ts`
- `npx vitest run packages/agent-channel-common/tests/web-stream-delivery-watermark.test.ts`
- `openspec validate add-ts-watermark-lazy-config --strict`
- `npm run lint:architecture`
