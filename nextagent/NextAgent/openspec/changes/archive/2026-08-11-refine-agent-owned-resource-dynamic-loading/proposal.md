# refine-agent-owned-resource-dynamic-loading

## Why

Remote 部署场景下，agent-owned 本地资源（`config/config.json` 中的 `chat-upload-file-config`、`resource/*.jsonl` 中的分类问题）在产品 pub 后才被放置到 `opt/share/{serviceName}/agents/{activeAgentId}/` 下。当前实现存在两个问题：

1. **ChatUploadFileConfig 启动时冻结**：`preloadAttachmentCompositionAsync` 在应用启动时一次性读取 `config/config.json` 并冻结为内存快照。`/api/v1/runtime/bootstrap` 端点和上传路由都消费这个快照。pub 流程下文件在启动后才到位，bootstrap 返回默认值（markdown-only），前端无法正确控制上传按钮显隐；上传校验也使用旧值。

2. **CategoryQuestionCatalog 空结果永久缓存**：`DefaultCategoryQuestionCatalog` 已有运行时按需加载和缓存机制，但当 agent package 目录已存在而 `resource/*.jsonl` 文件尚未到位时，首次请求会缓存一个空 catalog（`categories: []`），后续即使文件到位也返回空结果。`category-question-source` spec 显式要求"Catalog 数据在应用生命周期内不可变；文件变更后需要重启应用才能生效"，这一约束需要放松。

两个问题的共同根因是：agent-owned 本地资源缺少运行时文件变更检测和缓存失效机制。

## What Changes

- 新增 `ChatUploadConfigProvider`：基于文件 fingerprint（`size + mtimeMs`）的缓存失效机制，每次 `get()` 调用检测 `config/config.json` 是否变化，变化则重新加载，未变化则返回缓存值。配置文件不存在时返回 `undefined`（不再返回默认值），bootstrap response 不包含 `chatUploadFileConfig` 字段，上传路由拒绝上传请求。
- bootstrap 端点和上传路由改为运行时调 `provider.get()` 获取当前 config。
- 前端在 bootstrap response 不包含 `chatUploadFileConfig` 时，禁用上传按钮并显示提示语（"文件上传功能未配置"）；不再静默 fallback 到 markdown-only 默认值。
- 修复 `DefaultCategoryQuestionCatalog` 缓存：空结果（文件不存在导致的空 catalog）不被永久缓存；已缓存的 catalog 在文件 fingerprint 变化时失效重载。
- 放松 `category-question-source` spec 中"Catalog 数据不可变"的约束，改为支持 fingerprint-based 缓存失效。

## Non-Goals

- 不修改 `WebRuntimeBootstrapConfig` response schema（前端拿到的 JSON 结构不变）。
- 不修改 `BlobStoreGateway` 存储实现或 HOFS 集成（`hofsBucketName` 当前在 staged-upload-runtime 中未被使用，不在本次范围内）。
- 不修改 agent assembly hot-reload 机制（`createHotReloadingActiveAssemblyRegistry` 已正确实现 fingerprint 检测，本次只是将同一模式应用到 config 和 catalog）。
- 不修改配置文件路径解析逻辑（`AgentPackageSourceLocator` 和 `agentsRoot` 推导不变）。
- 不处理部署时序问题（pub 流程必须在用户可访问页面前完成文件放置，代码层面无法解决文件未到位时的首次请求）。

## Impact

- `agent-attachment-runtime`：新增 `ChatUploadConfigProvider`（fingerprint 缓存）。
- `agent-session`：修复 `DefaultCategoryQuestionCatalog` 缓存失效逻辑。
- `agent-channel-web`：bootstrap handler 和 upload 路由改为 `await provider.get()`。
- `agent-app`：composition 创建并注入 provider。
- 不影响 local 部署行为（配置文件在启动时已就位，首次请求加载并缓存，效果与当前一致）。
- 远程部署严格改善：配置文件到位后首次请求即可获取正确值，不再需要重启容器。

## Validation

- `openspec validate refine-agent-owned-resource-dynamic-loading --strict`
- `openspec validate --all --strict`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
