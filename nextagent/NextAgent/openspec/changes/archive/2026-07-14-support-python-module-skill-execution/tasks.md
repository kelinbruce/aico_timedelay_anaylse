## 1. 受控 projection import root

- [x] 1.1 保持 `WorkspaceFilePort.sandboxFilesystem()` 为当前 run 全部授权 Skill projection roots 的唯一事实来源，并让 local sandbox 仅在 Python module mode 判定恰好一个 committed `.nextagent/skills/<projection-key>/<skill-name>/` root；不改变 sandbox filesystem 的公开形状。
  验证：在 `packages/agent-capability/tests/skill-resource-projection.test.ts` 增加同 run 单 root、跨 run 不可见与多 root 均保留为授权 facts 的测试，并由 sandbox negative test 断言零/多 root 拒绝。
  来源：`skill-resource-access` requirement “Authorized Skill Projection Supplies A Bounded Python Module Root”；design D2。

- [x] 1.2 确认 module import root 只经既有 trusted `SandboxExecutionRequest.filesystem` 到达 local adapter，不新增 model tool schema、Web API、`SandboxGatewayPort`、`SandboxExecutionRequest` 或 `SandboxExecutionResult` public field。
  验证：运行 `npm run build`、`npm run test:contract`，并在 code review 检查 public contract diff 为空。
  来源：design D3；proposal 非新增公开 contract 范围。

## 2. Python module mode 执行

- [x] 2.1 在 `restricted-local-sandbox.ts` 实现 Python argv 分类：保留现有 script-path translation；仅接受严格的 `-m <dotted-module>` module mode；使 `-c`、stdin、缺少 module、非 dotted module 与其他 option 在 process start 前安全失败。
  验证：在 `packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts` 增加 module argv 不变、script-path 回归以及每种禁止形态的 failure assertion。
  来源：`sandbox-runtime` requirement “Python Sandbox Invocation Distinguishes Script And Skill Module Modes”；design D1。

- [x] 2.2 在 local sandbox 为 module mode 从唯一的授权 projection root 构造本次子进程的唯一 `PYTHONPATH` entry，并清除/覆盖不可信值；零 root 或多 root 时不启动进程且返回 safe failure。
  验证：在 `restricted-local-sandbox.test.ts` 用临时 projection root 实际运行 `python -m scripts.nl2api.api_recall_main`；断言无 root、多 root、模型/请求环境 `PYTHONPATH` 覆盖均失败或无效，且不泄漏 physical path。
  来源：`sandbox-runtime` requirement “Python Module Mode Uses One Trusted Skill Import Root”；design D2、D4。

- [x] 2.3 保持 Bash 的唯一 tokenization 与 Python sandbox routing，补充 `python`、`python3` module command 原样 forwarding 测试；不得在 Bash 中解析 module、选择 Skill root 或构造环境。
  验证：运行 `npx vitest run packages/agent-capability/tests/bash-capability.test.ts`，并断言 `runPython` 收到 `[-m, scripts.nl2sql.sql_recall_main, 查询问题]`。
  来源：`bash-tool` requirement “Bash Forwards The Governed Python Module Token Sequence”；design D1、D3。

## 3. 集成验证

- [x] 3.1 运行模块模式、Skill projection 与 Bash 的目标测试集，并保留 script-path、timeout、cancellation 与 safe output 的回归结果。
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts packages/agent-capability/tests/bash-capability.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts`。
  来源：design D4；质量属性设计中的可靠性、可测试性与审计/可追溯性结论。

- [x] 3.2 运行变更和架构门禁，确认无新增 private import、公开 contract、未使用 helper 或宿主路径泄漏。
  验证：`npm run lint:architecture`、`npm run test:contract`、`openspec validate support-python-module-skill-execution --strict`、`git diff --check`；code review 检查 observability/result/safe error 不包含 physical projection root 或 `PYTHONPATH`。
  来源：proposal 影响范围；design D2、D3 与质量属性设计。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，归档前根据 proposal/design 的 Baseline Promotion Plan 处理：

- 同步 `openspec/specs/sandbox-runtime/spec.md`、`openspec/specs/bash-tool/spec.md` 和 `openspec/specs/skill-resource-access/spec.md`。
- 更新 `openspec/designs/modules/agent-capability.md` 与 `openspec/designs/modules/agent-platform-gateway-local.md`。
- 如导航变化，更新 `openspec/designs/spec-to-design-map.md`；不更新 `openspec/overview.md`、architecture 或 ADR。
- 检查长期文档没有重复定义 Python argv 语义、projection authorization 或 sandbox adapter ownership。
