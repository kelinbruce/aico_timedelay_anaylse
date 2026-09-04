## 背景和现状（Context）

NextAgent 在 remote 部署场景下，agent-owned 本地资源（`config/config.json`、`resource/*.jsonl`）通过产品 pub 流程放置到 `opt/share/{serviceName}/agents/{activeAgentId}/` 下。该放置发生在应用容器启动之后。当前实现中，两类资源的加载时机不同，但都存在文件后到位无法感知的问题。

### ChatUploadFileConfig

配置加载链路：`preloadAttachmentCompositionAsync` -> `loadChatUploadFileConfigFromAgent` -> `AgentPackageRootLocator.locate(activeAgentId)` -> 读取 `{agentPackageRoot}/config/config.json` -> 解析 `chat-upload-file-config` 字段 -> 校验（Cap + Warn）-> 返回 `ChatUploadFileConfig`。

这个加载发生在 `createNextAgentAppAsync` -> `prepareCompositionInputsAsync` 阶段（应用启动时），结果被冻结为内存快照，注入到：
- `WebChannelRegistrationContext.chatUploadFileConfig` -> `registerWebChannel` deps -> bootstrap handler 返回值
- `registerTrustedIdentityWebChannel` deps -> upload 路由的 `chatUploadFileConfig` 依赖

运行时（bootstrap 端点、upload 路由）只消费这个快照，不重新读取文件。

### CategoryQuestionCatalog

`DefaultCategoryQuestionCatalog` 已有运行时按需加载和缓存：`loadCatalog` -> 检查 cache -> 未命中则 `doLoadCatalog` -> `source.locateResourceDir` -> `loadFromResourceDir` -> `parseJsonlFile` -> 缓存结果。

但缓存存在两个缺陷：
1. **空结果被永久缓存**：当 `resourceDir` 存在但 JSONL 文件不存在时，`loadFromResourceDir` 返回 `{ catalog: { categories: [] }, evidence }`（非 undefined），`loadCatalog` 将其 `cache.set(cacheKey, entry)`，后续请求永远命中这个空缓存。
2. **已缓存结果不失效**：即使 JSONL 文件后来被创建或修改，缓存不会失效，因为没有任何 fingerprint 检测机制。

`category-question-source` spec 显式约束"Catalog 数据在应用生命周期内不可变；文件变更后需要重启应用才能生效"，这一约束需要放松。

### 已有的 fingerprint 模式

`createHotReloadingActiveAssemblyRegistry`（`assembly-composition.ts`）已正确实现了 agent.yaml 的 fingerprint 热重载：通过 `statSync` 获取 `size + mtimeMs` 作为 fingerprint，每次 `active()` / `require()` 调用时检测变化，变化则重新编译。本次将同一模式应用到 `ChatUploadFileConfig` 和 `CategoryQuestionCatalog`。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- bootstrap 端点每次请求时获取当前生效的 `ChatUploadFileConfig`（而非启动时快照）。
- 上传路由每次请求时获取当前生效的 `ChatUploadFileConfig` 用于校验。
- `CategoryQuestionCatalog` 在 JSONL 文件变化后能自动失效重载，不要求重启。
- 文件不存在时 fallback 到默认值，与当前行为一致。
- local 部署行为不变。

**非目标：**

- 不修改 response schema。
- 不修改 BlobStoreGateway / HOFS 集成。
- 不修改 agent assembly hot-reload。
- 不修改配置文件路径解析。
- 不处理文件未到位时的首次请求（部署时序问题）。
- 不为 `ts-attachment-config` spec（仅在 `add-ts-remote-file-upload` active change 中定义）创建 delta，因为该 spec 尚未进入 baseline。设计文档说明行为扩展关系，待 `add-ts-remote-file-upload` 归档时基线应包含动态加载约束。

## 设计决策（Decisions）

### D1: ChatUploadConfigProvider 接口与 fingerprint 缓存

在 `agent-attachment-runtime/src/chat-upload-config.ts` 中新增 `ChatUploadConfigProvider` 接口和默认实现 `DefaultChatUploadConfigProvider`。

```typescript
interface ChatUploadConfigProvider {
  get(): Promise<ChatUploadFileConfig>;
}
```

实现内部持有：
- `ChatUploadConfigLoader`（复用现有 loader）
- `AgentPackageRootLocator`（复用现有 locator）
- `activeAgentId`
- 缓存：`{ fingerprint?: string; config: ChatUploadFileConfig }`

fingerprint 计算：对 `{agentPackageRoot}/config/config.json` 做 `statSync`，取 `${path}:${size}:${mtimeMs}`。文件不存在时 fingerprint 为 `undefined`。

`get()` 逻辑（返回 `ChatUploadFileConfig | undefined`）：
1. 计算当前 fingerprint。
2. fingerprint 为 `undefined`（文件不存在）→ 返回 `undefined`，不缓存。
3. 与缓存 fingerprint 比较，相同则返回缓存 config。
4. 不同则调 `loader.load(activeAgentId)` 重新加载，更新缓存，返回新 config。
5. 加载异常时返回 `undefined`（与 D7 一致：配置不可用即不暴露上传功能）。

fingerprint 检测开销：每次 `get()` 调一次 `statSync`，开销极小。不需要 TTL 或 debounce。

### D7: 按部署模式分离 ConfigProvider 实现

ConfigProvider 按 `systemConfig.gateway.deploymentMode` 选择实现：

**LocalChatUploadConfigProvider（LOCAL 模式）**：
- 启动时加载一次 `config/config.json`，之后 `get()` 返回缓存的静态值。
- 不做 fingerprint 检测（LOCAL 模式无 pub，配置不会运行时变化）。
- 文件不存在时返回 `defaultChatUploadFileConfig()`（markdown-only），使上传功能在 local 模式下始终可用。
- bootstrap response 始终包含 `chatUploadFileConfig`。

**RemoteChatUploadConfigProvider（REMOTE 模式）**：
- 每次 `get()` 通过 fingerprint（`statSync` 的 `size + mtimeMs`）检测文件变更。
- 文件不存在时返回 `undefined`，不缓存该结果。
- 文件存在时返回 effective config（经过 Cap + Warn 校验后的值）。
- bootstrap handler 当 provider 返回 `undefined` 时，response 中不包含 `chatUploadFileConfig` 字段。
- upload 路由当 provider 返回 `undefined` 时，拒绝上传请求并返回 safe error。

**前端**：
- 当 bootstrap response 中 `chatUploadFileConfig` 字段不存在时（仅 REMOTE 模式 + 文件不存在），上传按钮设为 `disabled` + Tooltip 提示语。
- 当 `chatUploadFileConfig` 字段存在时（LOCAL 模式始终，REMOTE 模式文件存在时），上传按钮正常可用。
- 前端不再在 config 缺失时静默 fallback 到 markdown-only 默认值用于上传。

**CategoryQuestionCatalog**：fingerprint 缓存失效修复对 LOCAL 和 REMOTE 模式都适用。LOCAL 模式下文件在启动时已就位，fingerprint 不会变化，缓存正常命中，statSync 开销可接受。不按部署模式分离 catalog 实现。

### D2: bootstrap 端点和 upload 路由改为运行时获取 config

`WebChannelDependencies` 新增 `chatUploadConfigProvider?: ChatUploadConfigProvider` 字段。

bootstrap handler 改为：
```typescript
async () => {
  const config = dependencies.chatUploadConfigProvider
    ? await dependencies.chatUploadConfigProvider.get()
    : dependencies.chatUploadFileConfig;
  // config 为 undefined 时（配置文件不存在），response 不包含 chatUploadFileConfig
  return projectRuntimeBootstrap({
    transportKind: dependencies.runtimeBootstrap.transportKind,
    ...(config === undefined ? {} : { chatUploadFileConfig: config }),
    ...(dependencies.runtimeBootstrap.guardrail === undefined ? {} : { guardrail: dependencies.runtimeBootstrap.guardrail })
  });
}
```

upload 路由（`uploadToTemp`、`moveToFormal`）同样从 provider 获取 config。当 provider 返回 `undefined` 时，upload 路由 MUST 返回 safe error（上传功能未配置），MUST NOT 使用默认值继续处理上传。

upload 路由（`uploadToTemp`、`moveToFormal`）同样改为从 provider 获取 config。

`WebRuntimeBootstrapConfig` response schema 不变，前端拿到的 JSON 结构不变。

### D3: CategoryQuestionCatalog 缓存修复

修改 `DefaultCategoryQuestionCatalog`，在 `loadCatalog` 中增加 fingerprint 检测：

1. 缓存条目新增 `fingerprint?: string` 字段，记录加载时 JSONL 文件的 fingerprint。
2. fingerprint 计算：对 `resourceDir` 下匹配的 `category-question-{locale}.jsonl` 文件做 `statSync`，取 `${path}:${size}:${mtimeMs}`。文件不存在时 fingerprint 为 `undefined`（表示尚未就位）。
3. `loadCatalog` 在命中缓存后，比较当前 fingerprint 与缓存 fingerprint：
   - 相同 -> 返回缓存。
   - 不同 -> 清除缓存，重新加载。
4. 文件不存在时（fingerprint 为 `undefined`），不缓存空结果，每次请求都尝试加载（开销可控，因为 `statSync` 极快且文件不存在时直接返回默认值）。

### D4: composition 注入 provider

`attachment-composition.ts` 的 `preloadAttachmentCompositionAsync` 改为创建并返回 `ChatUploadConfigProvider`：

```typescript
async function preloadAttachmentCompositionAsync(input): Promise<PreparedAttachmentComposition> {
  const provider = createChatUploadConfigProvider({
    systemConfig: input.systemConfig,
    chatUploadFileConfig: input.chatUploadFileConfig
  });
  // ... cleanup ...
  return { chatUploadConfigProvider: provider };
}
```

`PreparedAttachmentComposition` 的 `chatUploadFileConfig: ChatUploadFileConfig` 改为 `chatUploadConfigProvider: ChatUploadConfigProvider`。

`create-app.ts` 中传递 `chatUploadConfigProvider` 而非 `chatUploadFileConfig`。

`channel-composition.ts` 的 `registerTrustedIdentityWebChannel` 注入 `chatUploadConfigProvider` 到 web channel deps。

`composition-contracts.ts` 的 `WebChannelRegistrationContext` 和 `CreateComposedAppOptions` 中 `chatUploadFileConfig` 类型改为 `chatUploadConfigProvider`。

### D5: 向后兼容

- `WebChannelDependencies` 保留 `chatUploadFileConfig?: ChatUploadFileConfig` 字段作为 fallback，当 provider 不存在时使用（测试场景、local composition 直接注入 config 的场景）。
- `preloadAttachmentCompositionSync` 保持返回静态 config（sync 路径不创建 provider，因为 provider 需要 locator 和 async 初始化）。

### D6: 对 ts-attachment-config 和 ts-runtime-bootstrap-config 的 delta

`add-ts-remote-file-upload` change 的 `ts-attachment-config` spec 定义了"File upload config is loaded from agent config directory"，`ts-runtime-bootstrap-config` spec 定义了"Bootstrap API exposes file upload configuration"。本次改动将 config 加载时机从"启动时"改为"运行时按需 + fingerprint 缓存"，bootstrap 端点从返回启动快照改为每次请求动态获取。

虽然这两个 spec 尚未进入 baseline（仅在 `add-ts-remote-file-upload` active change 中），但 OpenSpec 允许对 active change 中的 spec 创建 MODIFIED delta。本次 change 为这两个 spec 创建 MODIFIED delta，在原有 requirement 基础上补充运行时动态加载约束。

## 影响范围（Impact）

### 生产文件

| 包 | 文件 | 改动 |
|----|------|------|
| `agent-attachment-runtime` | `chat-upload-config.ts` | 新增 `ChatUploadConfigProvider` 接口 + `DefaultChatUploadConfigProvider` 实现 |
| `agent-attachment-runtime` | `index.ts` | 导出 `ChatUploadConfigProvider` |
| `agent-session` | `category-question-catalog.ts` | 修复缓存：空结果不缓存 + fingerprint 失效 |
| `agent-channel-web` | `routes/requests.ts` | bootstrap handler 和 upload 路由改为 `await provider.get()` |
| `agent-app` | `attachment-composition.ts` | 创建并返回 provider |
| `agent-app` | `channel-composition.ts` | 注入 provider |
| `agent-app` | `create-app.ts` | 传递 provider |
| `agent-app` | `composition-contracts.ts` | 类型签名调整 |

### 前端文件

| 文件 | 改动 |
|------|------|
| `frontend/agent-web/src/features/composer/components/MessageInput.tsx` | config 缺失时禁用 attachment button + Tooltip |
| `frontend/agent-web/src/config/runtimeConfig.ts` | bootstrap 无 config 时保持 undefined，不 fallback |
| `frontend/agent-web/src/features/composer/attachmentRules.ts` | config undefined 时校验返回错误 |
| `frontend/agent-web/src/i18n/` | 新增上传未配置提示文案 |

### 测试文件

- `agent-attachment-runtime/tests/`：新增 provider 单元测试
- `agent-session/tests/`：category-question 缓存失效测试
- `agent-channel-web/tests/multipart-request-routes.test.ts`：调整 mock 为 provider
- `agent-app/tests/attachment-preload-composition.test.ts`：调整断言为 provider
- `frontend/agent-web/tests/MessageInput.attachments.test.tsx`：新增 config 缺失时按钮禁用测试

### OpenSpec

- 新增 spec `agent-owned-resource-dynamic-loading`：定义 fingerprint 缓存失效行为
- MODIFY `category-question-source` baseline spec：放松不可变约束

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- 新增 `openspec/specs/agent-owned-resource-dynamic-loading/spec.md`：fingerprint 缓存失效通用行为
- `openspec/specs/category-question-source/spec.md`：更新"内存 Catalog 与 Agent Scope 隔离"requirement，移除不可变约束

设计视图：
- `openspec/designs/modules/agent-attachment-runtime.md`：补充 ChatUploadConfigProvider
- `openspec/designs/modules/agent-session.md`：补充 catalog 缓存失效
- `openspec/designs/spec-to-design-map.md`：补充验证入口映射

验证入口：
- `openspec validate refine-agent-owned-resource-dynamic-loading --strict`
- `openspec validate --all --strict`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`

## 遗留项（Deferred）

- `ts-attachment-config` baseline 中动态加载约束待 `add-ts-remote-file-upload` 归档时补入。
- `hofsBucketName` 在 staged-upload-runtime 中的使用（当前未被任何代码路径消费）不在本次范围。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.2-调用能力` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/agent-owned-resource-dynamic-loading/spec.md`、`openspec/specs/agent-web-attachment-composer/spec.md`、`openspec/specs/category-question-source/spec.md`、`openspec/specs/ts-attachment-config/spec.md`、`openspec/specs/ts-runtime-bootstrap-config/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**archive CLI 在应用 delta 前中止；需要逐 spec 定位冲突的 Requirement/迁移边。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
