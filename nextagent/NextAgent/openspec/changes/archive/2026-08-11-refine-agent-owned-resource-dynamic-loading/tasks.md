## 1. ChatUploadConfigProvider 实现

- [x] 1.1 在 `agent-attachment-runtime/src/chat-upload-config.ts` 中新增 `LocalChatUploadConfigProvider` 和 `RemoteChatUploadConfigProvider` 实现，并导出 `createLocalChatUploadConfigProvider` 与 `createRemoteChatUploadConfigProvider` 工厂函数。`RemoteChatUploadConfigProvider` 通过 fingerprint（`statSync` 的 `size + mtimeMs`）检测 `config/config.json` 变更；文件不存在时返回 `undefined`；文件存在时返回 effective config。`LocalChatUploadConfigProvider` 在首次 `get()` 时加载并永久缓存；文件不存在时返回 `defaultChatUploadFileConfig()`，使 local 模式下上传功能始终可用。保留 `createChatUploadConfigProvider` 作为 `createRemoteChatUploadConfigProvider` 的别名以维持向后兼容。
  验证：单元测试覆盖 local 文件不存在->默认值、local 文件存在->缓存、remote 文件不存在->undefined、remote 文件存在->重载、文件未变更->缓存；`npm run build`
  来源：design D1, D7；spec `agent-owned-resource-dynamic-loading` Requirement `Agent-owned local resources are loaded at request time with fingerprint cache invalidation`

- [x] 1.2 在 `agent-attachment-runtime/src/index.ts` 中导出 `ChatUploadConfigProvider` 接口和 `createChatUploadConfigProvider` 工厂函数。
  验证：`npm run build`；`rg "ChatUploadConfigProvider" packages/agent-attachment-runtime/src/index.ts` 确认导出
  来源：design D1

## 2. CategoryQuestionCatalog 缓存修复

- [x] 2.1 修改 `agent-session/src/services/category-question-catalog.ts` 的 `DefaultCategoryQuestionCatalog`：缓存条目新增 `fingerprint` 字段；`loadCatalog` 在命中缓存后比较当前 fingerprint 与缓存 fingerprint，不同则清除缓存重新加载。
  验证：单元测试覆盖文件变更后缓存失效、文件不变时命中缓存；`npm run build`
  来源：design D3；spec `agent-owned-resource-dynamic-loading` Requirement `CategoryQuestionCatalog cache invalidates on file change`

- [x] 2.2 修复空结果永久缓存：当 JSONL 文件不存在时（fingerprint 为 `undefined`），`loadCatalog` MUST NOT 将空 catalog 缓存，下次请求 MUST 再次尝试加载。
  验证：单元测试覆盖文件不存在->空结果不缓存->文件创建后->加载成功；`npm run build`
  来源：design D3；spec `category-question-source` MODIFIED Requirement `内存 Catalog 与 Agent Scope 隔离` Scenario `空结果不被永久缓存`

- [x] 2.3 fingerprint 计算：对 `resourceDir` 下匹配的 `category-question-{locale}.jsonl` 文件做 `statSync`，取 `${path}:${size}:${mtimeMs}`。多个 locale 候选文件时取首个存在的文件做 fingerprint。
  验证：单元测试覆盖 zh-CN locale fingerprint 计算 + fallback locale fingerprint；`npm run build`
  来源：design D3；spec `agent-owned-resource-dynamic-loading` Requirement `Fingerprint detection uses stat metadata only`

## 3. Web Channel 适配

- [x] 3.1 在 `agent-channel-web/src/routes/requests.ts` 的 `WebChannelDependencies` 新增 `chatUploadConfigProvider?: ChatUploadConfigProvider` 字段。bootstrap handler 改为 async，当 provider 存在时调 `await provider.get()` 获取 config，否则 fallback 到 `chatUploadFileConfig`（向后兼容）。
  验证：单元测试覆盖 provider 存在时动态获取 + provider 不存在时 fallback；`npm run build`
  来源：design D2；spec `agent-owned-resource-dynamic-loading` Requirement `ChatUploadConfigProvider exposes dynamic config at request time`

- [x] 3.2 upload 路由（`uploadToTemp`、`moveToFormal`、`deleteTemp`）改为从 provider 获取 config。当 provider 返回 `undefined`（配置文件不存在）时，upload 路由 MUST 返回 safe error（上传功能未配置），MUST NOT 使用默认值继续处理上传。
  验证：单元测试覆盖 provider 返回 undefined 时 upload 被拒绝 + provider 返回 config 时正常上传；`npm run build`
  来源：design D2, D7

## 4. App Composition 适配

- [x] 4.1 修改 `agent-app/src/composition/attachment-composition.ts`：`preloadAttachmentCompositionAsync` 按 `systemConfig.deployment.mode` 创建 `LocalChatUploadConfigProvider`（LOCAL）或 `RemoteChatUploadConfigProvider`（REMOTE），并返回 `ChatUploadConfigProvider`。`PreparedAttachmentComposition` 的 `chatUploadFileConfig` 字段改为 `chatUploadConfigProvider`。`preloadAttachmentCompositionSync` 保持返回静态 config（sync 路径不创建 provider）。
  验证：单元测试覆盖 async 路径返回 provider + sync 路径返回静态 config + LOCAL/REMOTE 模式选择；`npm run build`
  来源：design D4, D7

- [x] 4.2 修改 `agent-app/src/composition/composition-contracts.ts`：`WebChannelRegistrationContext` 和 `CreateComposedAppOptions` 中 `chatUploadFileConfig` 类型改为 `chatUploadConfigProvider?: ChatUploadConfigProvider`。
  验证：`npm run build`；`npm run lint:architecture`
  来源：design D4

- [x] 4.3 修改 `agent-app/src/composition/channel-composition.ts`：`registerTrustedIdentityWebChannel` 注入 `chatUploadConfigProvider` 到 web channel deps。
  验证：`npm run build`
  来源：design D4

- [x] 4.4 修改 `agent-app/src/composition/create-app.ts`：2 处传递 `chatUploadFileConfig` 改为传递 `chatUploadConfigProvider`。
  验证：`npm run build`
  来源：design D4

## 5. 前端适配

- [x] 5.1 修改 `frontend/agent-web/src/features/composer/components/MessageInput.tsx`：当 `runtimeConfig.chatUploadFileConfig` 为 `undefined` 时，attachment button（`PaperClipOutlined`）设为 `disabled`，并显示 Tooltip 提示语（i18n："文件上传功能未配置"）。
  验证：前端组件测试覆盖 config 缺失时按钮禁用 + tooltip 展示；config 存在时按钮可用
  来源：design D7；spec `agent-web-attachment-composer` MODIFIED Requirement Scenario `Missing upload config disables attachment button`

- [x] 5.2 修改 `frontend/agent-web/src/config/runtimeConfig.ts`：当 bootstrap response 不包含 `chatUploadFileConfig` 时，`runtimeConfig.chatUploadFileConfig` 保持 `undefined`，MUST NOT 静默 fallback 到默认值。
  验证：前端测试覆盖 bootstrap 无 config 时 runtimeConfig.chatUploadFileConfig 为 undefined
  来源：design D7；spec `ts-runtime-bootstrap-config` MODIFIED Requirement Scenario `Frontend disables attachment button when config absent`

- [x] 5.3 更新 `frontend/agent-web/src/features/composer/attachmentRules.ts`：`validateAttachmentFile` / `validateAttachmentSelection` 在 config 为 `undefined` 时返回错误（文件上传未配置），MUST NOT fallback 到 markdown-only 默认值进行校验。
  验证：前端测试覆盖 config undefined 时校验返回错误
  来源：design D7

- [x] 5.4 新增 i18n 提示文案（中英文）：上传按钮禁用时的 tooltip 文案。
  验证：i18n 文案存在且被组件使用
  来源：design D7

## 6. 测试适配

- [x] 5.1 更新 `agent-channel-web/tests/multipart-request-routes.test.ts`：将 mock 从静态 `chatUploadFileConfig` 改为 `chatUploadConfigProvider`（或保留 fallback 路径）。
  验证：`npm test -- packages/agent-channel-web/tests/multipart-request-routes.test.ts`
  来源：design D5

- [x] 5.2 更新 `agent-app/tests/attachment-preload-composition.test.ts`：调整断言从 `chatUploadFileConfig` 改为 `chatUploadConfigProvider`。
  验证：`npm test -- packages/agent-app/tests/attachment-preload-composition.test.ts`
  来源：design D4

- [x] 5.3 新增 `agent-attachment-runtime/tests/chat-upload-config-provider.test.ts`：覆盖 fingerprint 缓存失效、文件不存在 fallback、加载异常 fallback、文件变更重载。
  验证：`npm test -- packages/agent-attachment-runtime/tests/chat-upload-config-provider.test.ts`
  来源：design D1

- [x] 5.4 新增或更新 `agent-session/tests/` 中 category-question-catalog 缓存失效测试：覆盖空结果不缓存、文件变更后重载、fingerprint 检测。
  验证：`npm test -- packages/agent-session/tests/`
  来源：design D3

## 7. 验证门禁

- [x] 7.1 `openspec validate refine-agent-owned-resource-dynamic-loading --strict` 通过，包含 `ts-attachment-config` 和 `ts-runtime-bootstrap-config` 的 MODIFIED delta。
  验证：命令执行成功
  来源：AGENTS.md 验证门禁

- [x] 7.2 `openspec validate --all --strict` 通过。
  验证：命令执行成功
  来源：AGENTS.md 验证门禁

- [x] 7.3 `npm run build` 通过。
  验证：命令执行成功
  来源：AGENTS.md 验证门禁

- [x] 7.4 `npm test` 通过。
  验证：命令执行成功
  来源：AGENTS.md 验证门禁

- [x] 7.5 `npm run test:contract` 通过。
  验证：命令执行成功
  来源：AGENTS.md 验证门禁

- [x] 7.6 `npm run lint:architecture` 通过。
  验证：命令执行成功
  来源：AGENTS.md 验证门禁
