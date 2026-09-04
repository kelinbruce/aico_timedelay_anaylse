## 1. API 清点与共享规格基础

- [x] 1.1 建立 Web channel public endpoint inventory，覆盖 `agent-channel-web` REST/SSE/WS、`agent-channel-web-auth-local` login/logout/challenge 和 `/health` 路由，并标注每个端点的请求 schema、响应 schema、错误 schema 覆盖状态
  验证：新增或更新 Web channel API schema coverage test，断言当前 public endpoint inventory 与 route registry 一致
  来源：`web-channel-api-contract` / `Web channel API documentation MUST stay aligned with executable schema and route projection`；design 决策 2、4
- [x] 1.2 在 `packages/agent-channel-web/src/schemas` 增加共享 path params、safe error、empty/no-content、common pagination 和 public id schema，供 route registry 和 tests 复用
  验证：`vitest run packages/agent-channel-web/tests/*schema*.test.ts`
  来源：`web-channel-api-contract` / `Web channel public API MUST have complete request specifications`；design 决策 1、3
- [x] 1.3 为 local auth login/logout/challenge 增加 auth-local 自有 request/response/error schema，不让 `agent-channel-web` 依赖 auth-local 实现
  验证：`vitest run packages/agent-channel-web-auth-local/tests/protected-prefix.test.ts`，并新增 login/logout response shape assertions
  来源：`web-channel-api-contract` / `Web channel public API MUST have complete success response specifications`；design 决策 1、3

## 2. Route 请求、响应与错误规格补齐

- [x] 2.1 为 Session routes 挂载 path/query/body/response schema：session list/create/title/delete、conversation、conversation preview、message fork、request fork
  验证：`vitest run packages/agent-channel-web/tests/session-list-search-route.test.ts packages/agent-channel-web/tests/session-delete-route.test.ts packages/agent-channel-web/tests/conversation-preview-route.test.ts`，并补充 params/response schema negative tests
  来源：`web-channel-api-contract` / `Web channel public API MUST have complete request specifications`、`Web channel public API MUST have complete success response specifications`
- [x] 2.2 为 Request Command routes 挂载 path/body/response schema：session submit、convenience submit、cancel、retry、edit、pending input answer、suggested questions
  验证：`vitest run packages/agent-channel-web/tests/routing-constraints-schema.test.ts packages/agent-channel-web/tests/request-model-options-schema.test.ts packages/agent-channel-web/tests/suggested-questions-routes.test.ts`，并补充 accepted DTO / pending answer response assertions
  来源：`web-channel-api-contract` / `Web channel public API MUST have complete request specifications`、`Web channel public API MUST have complete success response specifications`
- [x] 2.3 为 multipart submit/edit 增加独立 negative verification，实际提交 unsupported field、client owner/agent/id fields、非空 JSON attachments 等非法输入并断言 fail closed
  验证：新增或更新 `packages/agent-channel-web/tests/*multipart*.test.ts`
  来源：`web-channel-api-contract` / `Multipart request schema coverage`；design 决策 2
- [x] 2.4 为 SSE 和 WebSocket stream 补齐请求/错误/frame 规格，保持 `lastSeenSequence`、`requestId`、`runId` 解析等价，并记录 `StreamEnvelope` frame shape
  验证：`vitest run packages/agent-channel-web/tests/terminal-projection.test.ts packages/agent-channel-web/tests/pending-input-projection.test.ts packages/agent-channel-web/tests/tool-structured-delta-projection.test.ts`，并补充 unsupported WS query safe error assertion
  来源：`web-channel-api-contract` / `Stream route request schema coverage`、`Stream response specification coverage`
- [x] 2.5 为 Annotation/Favorite routes 挂载 request/response/error schema，并修正 `ANNOTATIONS_UNAVAILABLE` route-local 错误为 safe `code + message`
  验证：`vitest run packages/agent-channel-web/tests/annotation-routes.test.ts`，并新增 unavailable response shape assertion
  来源：`web-channel-api-contract` / `Web channel public API MUST expose safe error code specifications`；design 决策 3
- [x] 2.6 为 Background Task routes 挂载 request/response/error schema，并修正 `BACKGROUND_TASKS_UNAVAILABLE`、`BACKGROUND_TASK_OUTPUT_UNAVAILABLE` 为 safe `code + message`
  验证：新增或更新 background task route tests，断言 list/output/kill 成功 DTO 和 unavailable/not-found error DTO
  来源：`web-channel-api-contract` / `Web channel public API MUST have complete success response specifications`、`Route-local errors use the safe error shape`
- [x] 2.7 为 Share routes 挂载 request/response/error schema，明确 create share DTO、shared conversation DTO、`SHARE_FORBIDDEN`/`SHARE_NOT_FOUND`/`SHARE_EXPIRED` HTTP 映射
  验证：`vitest run packages/agent-channel-web/tests/share-routes.test.ts`
  来源：`web-channel-api-contract` / `Share and stream protocol errors are documented`；design 决策 3
- [x] 2.8 为 Skill/Question routes 挂载 response/error schema，修正 question association/frequent question 文档与 schema 字段不一致，确保 `text` 和 `source` 枚举以 executable schema 为准
  验证：`vitest run packages/agent-channel-web/tests/frequent-question-routes.test.ts`，并补充 category/question association response shape assertions
  来源：`web-channel-api-contract` / `Field examples match schema`；design 决策 4

## 3. 文档与一致性验证

- [x] 3.1 重写 `docs/agent-web-api-list.md` 的接口条目结构，使每个端点包含 Path 参数、Query、Headers、Body/Multipart、Success response、Error responses 和示例
  验证：文档一致性测试通过；code review 检查点：每个 endpoint inventory 条目在文档中有唯一章节
  来源：`web-channel-api-contract` / `Web channel API documentation MUST stay aligned with executable schema and route projection`；proposal scope
- [x] 3.2 更新 `docs/developer/10-api-reference.md`，保留精炼参考和指向 `docs/agent-web-api-list.md` 的链接，删除或修正与权威清单冲突的字段细节
  验证：文档一致性测试通过；code review 检查点：该文档不重复定义完整 Web DTO 字段表
  来源：design 决策 4；Documentation Ownership
- [x] 3.3 增加文档/schema alignment test，至少校验公开端点清单、关键响应字段、关键 enum、safe error shape 和已知漂移字段
  验证：`vitest run packages/agent-channel-web/tests/web-api-documentation-alignment.test.ts`
  来源：`web-channel-api-contract` / `Documentation alignment validation detects drift`

## 4. 验证和收尾

- [x] 4.1 运行 Web channel 相关 focused tests，确认 route/schema/error/doc alignment 覆盖通过
  验证：`vitest run packages/agent-channel-web/tests packages/agent-channel-web-auth-local/tests`
  来源：design / Verification Map
- [x] 4.2 运行架构边界检查，确认 Web channel 没有新增对 runtime/session/gateway implementation、auth-local 或 frontend source 的非法依赖
  验证：`npm run lint:architecture`
  来源：design 决策 1、5；`web-channel-api-contract` / `Documentation does not redefine internal ownership`
- [x] 4.3 运行 OpenSpec 校验，确认 active change 和全量规格均有效
  验证：`openspec validate complete-web-channel-api-specification --strict && openspec validate --all --strict`
  来源：proposal / Baseline Promotion Plan；design / Verification Map
- [x] 4.4 清理实现产生的重复 schema、临时测试夹具、未使用 imports 和与当前 executable schema 不一致的示例
  验证：`git diff --check`；code review 检查点：不存在重复 DTO owner、内部 Record/row 暴露为 Web response、route-local string-only error body
  来源：AGENTS.md 实现质量门禁；design 风险与取舍

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 将 `web-channel-api-contract` 的稳定行为同步到 `openspec/specs/web-channel-api-contract/spec.md`。
- 按需更新 `openspec/overview.md`，增加 Web channel public API contract 作为对外接口规格入口。
- 更新 `openspec/designs/architecture/web-channel-api-surface.md`，提炼 endpoint inventory、schema/projection owner、port 隔离、SSE/WS 等价边界和 safe error policy。
- 更新 `openspec/designs/modules/agent-channel-web.md`，提炼 route schema、DTO projection、safe error projection、docs alignment 验证关注点。
- 更新 `openspec/designs/modules/agent-channel-web-auth-local.md`，提炼 login/logout/challenge public response 与 cookie auth 边界。
- 更新 `openspec/designs/spec-to-design-map.md`，增加 `web-channel-api-contract` 到长期设计和验证入口的导航。
- 检查长期文档没有重复定义 runtime lifecycle、session ownership、gateway record ownership、API schema 或接口语义。
