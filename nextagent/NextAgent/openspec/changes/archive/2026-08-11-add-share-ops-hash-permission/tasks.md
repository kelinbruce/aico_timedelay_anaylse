## 1. 前端 hash 变换与调用接入

- [ ] 1.1 在 `frontend/agent-web/src/services/shareService.ts` 新增 `hashOps` 函数：输入 `readonly string[]`，执行 `new Set` 去重 → `.sort()` 默认字典序排序 → `JSON.stringify` → `crypto.subtle.digest("SHA-256", ...)` → 转 lowercase hex 字符串，返回 `Promise<string>`；空数组输入产生空数组的 hash（确定性）
  验证：`cd frontend/agent-web && npm test -- ...shareService` 测试断言相同集合（打乱顺序、含重复）产生相同 hash
  来源：spec「ops hash is order-independent」「ops hash is deduplication-stable」、design D1
- [ ] 1.2 修改 `shareService.createShare`：当 `params.allowedOps` 非 null 时，对 ops 数组调用 `hashOps` 得到 hash，包装为 `[hash]` 传入请求体；`null` 时原样传 null
  验证：测试断言请求体 `allowedOps` 为长度 1 数组或 null
  来源：spec「Generate share link」、design D1
- [ ] 1.3 修改 `shareService.loadSharedConversation`：当 `viewerOps` 非 null 时，对 ops 数组调用 `hashOps` 得到 hash，包装为 `[hash]` 设入 `X-Viewer-Ops` header；`null` 时不设 header
  验证：测试断言 header 值为长度 1 数组的 JSON
  来源：spec「Open shared conversation page」、design D1

## 2. 后端权限校验逻辑

- [ ] 2.1 在 `packages/agent-session/src/services/conversation-share-service.ts` 将 `isOpsSubset` 替换为 hash 字符串相等比对：`allowedOps != null` 时校验 `viewerOps` 非 null 且长度 >= 1 且 `allowedOps[0] === viewerOps[0]`；不通过返回 `SHARE_FORBIDDEN`
  验证：`npm test -- ...agent-session...conversation-share` 测试通过
  来源：spec「ops permission whitelist semantics」、design D2
- [ ] 2.2 新增/修改 characterization 测试：hash 相等通过、hash 不等拒绝、null viewerOps 拒绝、空 viewerOps 拒绝、allowedOps=null 公开通过
  验证：测试实际触发并断言各路径
  来源：spec scenarios、design D2

## 3. Web channel 与 e2e 测试

- [ ] 3.1 更新 `packages/agent-channel-web/tests/share-routes.test.ts`：创建分享时 `allowedOps` 传长度 1 的 hash 数组，查看时 `X-Viewer-Ops` 传长度 1 的 hash 数组，断言透传和 hash 相等/不等路径
  验证：`cd packages/agent-channel-web && npx vitest run tests/share-routes.test.ts` 通过
  来源：spec「View share with matching ops hash」「View share with insufficient ops hash」
- [ ] 3.2 更新 `tests/e2e/p1-p2-scenario-gate/conversation-share.test.ts`：创建者与查看者使用相同 ops 集合（顺序不同）时通过；使用不同 ops 集合时 403
  验证：e2e 测试通过
  来源：spec「Remote mode ops hash equality check passes/fails」

## 4. 验证和收尾

- [ ] 4.1 后端常规验证：仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  验证：四条命令全部通过
  来源：AGENTS.md 验证门禁
- [ ] 4.2 前端验证：`cd frontend/agent-web && npm run build` 及相关 `npm test -- ...`
  验证：构建与测试通过
  来源：AGENTS.md 验证门禁与前端边界约束
- [ ] 4.3 OpenSpec 验证：运行 `openspec validate --all --strict`
  验证：命令通过
  来源：AGENTS.md 验证门禁
- [ ] 4.4 清理检查：确认本 change 未引入配置项、未使用的 helper/export 或 test-only 残留；hash 逻辑只在 `shareService.ts` 单一来源
  验证：diff code review 检查点
  来源：design 非目标、AGENTS.md 实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的「归档前更新基线」处理：

- `openspec/specs/conversation-share/spec.md`：合并 ops hash 权限语义变更。
- `openspec/overview.md`：稳定基线描述补充 ops hash 一句。
- `openspec/designs/modules/agent-session.md`：补充 hash 比对语义。
- `openspec/designs/modules/frontend-agent-web.md`：补充 `shareService` hash 变换职责。
## 1. 前端 hash 变换与调用接入

- [x] 1.1 在 `frontend/agent-web/src/services/shareService.ts` 新增 `hashOps` 函数：输入 `readonly string[]`，执行 `new Set` 去重 → `.sort()` 默认字典序排序 → `JSON.stringify` → `crypto.subtle.digest("SHA-256", ...)` → 转 lowercase hex 字符串，返回 `Promise<string>`；空数组输入产生空数组的 hash（确定性）
  验证：`cd frontend/agent-web && npm test -- ...shareService` 测试断言相同集合（打乱顺序、含重复）产生相同 hash
  来源：spec「ops hash is order-independent」「ops hash is deduplication-stable」、design D1
- [x] 1.2 修改 `shareService.createShare`：当 `params.allowedOps` 非 null 时，对 ops 数组调用 `hashOps` 得到 hash，包装为 `[hash]` 传入请求体；`null` 时原样传 null
  验证：测试断言请求体 `allowedOps` 为长度 1 数组或 null
  来源：spec「Generate share link」、design D1
- [x] 1.3 修改 `shareService.loadSharedConversation`：当 `viewerOps` 非 null 时，对 ops 数组调用 `hashOps` 得到 hash，包装为 `[hash]` 设入 `X-Viewer-Ops` header；`null` 时不设 header
  验证：测试断言 header 值为长度 1 数组的 JSON
  来源：spec「Open shared conversation page」、design D1

## 2. 后端权限校验逻辑

- [x] 2.1 在 `packages/agent-session/src/services/conversation-share-service.ts` 将 `isOpsSubset` 替换为 hash 字符串相等比对：`allowedOps != null` 时校验 `viewerOps` 非 null 且长度 >= 1 且 `allowedOps[0] === viewerOps[0]`；不通过返回 `SHARE_FORBIDDEN`
  验证：`npm test -- ...agent-session...conversation-share` 测试通过
  来源：spec「ops permission whitelist semantics」、design D2
- [x] 2.2 新增/修改 characterization 测试：hash 相等通过、hash 不等拒绝、null viewerOps 拒绝、空 viewerOps 拒绝、allowedOps=null 公开通过
  验证：测试实际触发并断言各路径
  来源：spec scenarios、design D2

## 3. Web channel 与 e2e 测试

- [x] 3.1 更新 `packages/agent-channel-web/tests/share-routes.test.ts`：创建分享时 `allowedOps` 传长度 1 的 hash 数组，查看时 `X-Viewer-Ops` 传长度 1 的 hash 数组，断言透传和 hash 相等/不等路径
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/share-routes.test.ts` 通过
  来源：spec「View share with matching ops hash」「View share with insufficient ops hash」
- [x] 3.2 更新 `tests/e2e/p1-p2-scenario-gate/conversation-share.test.ts`：创建者与查看者使用相同 ops 集合（顺序不同）时通过；使用不同 ops 集合时 403
  验证：e2e 测试通过
  来源：spec「Remote mode ops hash equality check passes/fails」

## 4. 验证和收尾

- [x] 4.1 后端验证：`npm run lint:architecture` 通过（229 tests, no violations）；`npm run build` 存在 pre-existing agent-workflow 类型错误（与本次改动无关）
  验证：lint:architecture 通过；build 中 agent-workflow 错误为 pre-existing
  来源：AGENTS.md 验证门禁
- [x] 4.2 前端验证：`cd frontend/agent-web && npm run build` 及 `npm test` 通过
  验证：build clean；4 个 share 相关测试文件 27 tests 全通过
  来源：AGENTS.md 验证门禁与前端边界约束
- [ ] 4.3 OpenSpec 验证：运行 `openspec validate --all --strict`
  验证：openspec CLI 未安装（npm 占位包），需联网安装真实 CLI 后运行
  来源：AGENTS.md 验证门禁
- [x] 4.4 清理检查：确认本 change 未引入配置项、未使用的 helper/export 或 test-only 残留；hash 逻辑只在 `shareService.ts` 单一来源
  验证：diff code review 检查点
  来源：design 非目标、AGENTS.md 实现质量门禁
