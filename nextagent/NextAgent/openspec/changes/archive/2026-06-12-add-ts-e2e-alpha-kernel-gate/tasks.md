## 1. Gate 基础设施

- [x] 1.1 为 `tests/e2e/` 增加 Alpha 级真实 local product process fixture：不包含 local auth、WebSocket transport、P0 工具注册和 P0 context assembly 增强。使用隔离配置、临时 SQLite/文件目录和受控测试身份，并确保测试结束后确定性清理。
  验证：fixture integration test 实际启动/停止 Alpha product process，并断言临时数据目录被清理。
  来源：spec "Alpha E2E 使用真实产品边界"；design D1

- [x] 1.2 增加 `npm run test:e2e:alpha`、Playwright project、case inventory 和 machine-readable report。
  验证：命令可执行；故意跳过一个必需 case 时 gate 实际失败。
  来源：spec "Alpha E2E 覆盖最小问答内核行为"；design D1

- [x] 1.3 将公共测试 helper 限定为 Alpha 级 process lifecycle、临时目录、真实 HTTP/SSE client、case inventory 和本 gate report 写入；不得引入通用 E2E DSL、独立 case 编排框架、产品 API、底层 capability/context/model 语义或可被产品路径依赖的测试机制。
  验证：code review 检查 helper 只被 Alpha E2E tests 使用，且没有新增产品 API、产品入口依赖或跨 gate 通用编排框架。
  来源：design D6

## 2. Alpha 用例

- [x] 2.1 实现 e2e-alpha-01：最小问答主流程 — session create → submit → SSE stream → terminal → history 一致。覆盖携带/不携带 sessionId 提交问题两种路径。
  验证：`npm run test:e2e:alpha -- --grep e2e-alpha-01`
  来源：spec "最小问答主流程 E2E"

- [x] 2.2 实现 e2e-alpha-02：SSE canonical sequence — 验证 stream event types 按正确顺序出现、terminal event 后无新事件、同一 request 的 stream 与 history 终态一致。
  验证：`npm run test:e2e:alpha -- --grep e2e-alpha-02`
  来源：spec "SSE canonical sequence E2E"

- [x] 2.3 实现 e2e-alpha-03：同 session 并发冲突拒绝 — 第一个 submit 产生 active run 时第二个 submit 返回 safe conflict/rejection，且两个 submit 不交叉写入彼此事实。同时验证不同 session 并发 submit 互不干扰。
  验证：`npm run test:e2e:alpha -- --grep e2e-alpha-03`
  来源：spec "同 session 并发冲突拒绝 E2E"

- [x] 2.4 实现 e2e-alpha-04：SafeError 安全边界 — 验证非法输入（schema validation 失败）和 provider failure 场景的 SafeError 输出不包含 raw prompt、raw provider error、stack trace 或本地路径。
  验证：`npm run test:e2e:alpha -- --grep e2e-alpha-04`
  来源：spec "SafeError 安全边界 E2E"

- [x] 2.5 实现 e2e-alpha-05：Idempotent session create — 相同 owner+agent scope 重复调用 `POST /api/v1/sessions`，第二次返回首次创建结果且不产生第二个 session。
  验证：`npm run test:e2e:alpha -- --grep e2e-alpha-05`
  来源：spec "Idempotent session create E2E"

- [x] 2.6 实现 e2e-alpha-06：Owner scope 隔离 — 使用不同 trusted identity 访问不属于当前 owner 的 session 和 conversation，验证返回 safe not-found 且不泄露 session 是否存在于其他 owner 下。
  验证：`npm run test:e2e:alpha -- --grep e2e-alpha-06`
  来源：spec "Owner scope 隔离 E2E"

## 3. Negative Gate 和收尾

- [x] 3.1 增加 forbidden mock negative verification：实际放入一个替代目标 HTTP/SSE transport 的失败 fixture 并断言 gate 拒绝其作为证据。
  验证：Alpha gate negative fixture test。
  来源：spec "Mock 不能满足 Alpha E2E gate"；design D2

- [x] 3.2 增加 P0 能力泄漏 negative verification：在 Alpha E2E fixture 中注入 local auth route、WebSocket upgrade 或 P0 工具注册，断言 gate 拒绝该用例。
  验证：Alpha gate P0 leakage negative fixture test。
  来源：spec "P0 能力污染 Alpha 用例被拒绝"；design D3

- [x] 3.3 增加 report 安全内容断言：实际注入本 gate report/evidence 会接收的 credential/path/prompt 标记，断言输出不包含标记。
  验证：report test 实际覆盖。
  来源：spec "Alpha E2E 证据安全且可追溯"；design D5

- [x] 3.4 运行本 change 和仓库门禁。
  验证：`npm run test:e2e:alpha`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-e2e-alpha-kernel-gate --strict`
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

<!--
实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/ts-e2e-alpha-kernel-gate/spec.md`。
- 按需更新 `openspec/overview.md`：记录 Alpha 串行底座需要独立 E2E gate 作为核心路径回归保护。
- 按需更新 `openspec/designs/architecture/e2e-quality-gates.md`：增加 Alpha E2E gate 分类、真实边界、用例唯一归属和 evidence 规则。
- 按需更新 `openspec/designs/modules/agent-app.md`：增加 Alpha E2E 验证入口导航。
- 按需更新 `openspec/designs/spec-to-design-map.md`：增加本 capability 与验证入口导航。
-->
