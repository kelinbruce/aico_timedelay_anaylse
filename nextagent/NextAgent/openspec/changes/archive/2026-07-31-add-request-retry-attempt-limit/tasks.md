## 1. Runtime 上限校验

- [x] 1.1 在 `agent-runtime` retry acceptance 路径（`packages/agent-runtime/src/lifecycle/submit.ts` 的 `retryLatest`）新增上限校验：固定常量 5 次 retry，当 source `RequestRun.attempt` 达到 `1 + 5` 时，以 `AgentError`（code `REQUEST_RETRY_LIMIT_EXCEEDED`、category `CONFLICT`、`retryable=false`、`safeDetails.reasonCode` 同名）拒绝；校验位置在幂等重放解析与 source 合法性校验之后、创建新 run 之前
  验证：`npm test -- ...agent-runtime` 中 retry 上限相关测试通过
  来源：spec「Retry attempt 次数上限」、design D1/D2/D3
- [x] 1.2 新增 retry 上限 characterization/contract 测试：构造同一 request 连续 retry 至 attempt 6（第 5 次 retry 被接受），随后第 6 次 retry 以 `REQUEST_RETRY_LIMIT_EXCEEDED` 被拒绝
  验证：测试实际触发并断言稳定错误码、category、`retryable=false`
  来源：spec scenario「第 5 次 retry 被接受」「超过 5 次 retry 被拒绝」
- [x] 1.3 负例测试：超限拒绝无任何 side effect——不创建新 `RequestRun`、最高 attempt 不变、无 visibility 变更、无 retry timeline event、scheduler 未接收新 work item
  验证：测试断言上述状态在超限拒绝后保持不变
  来源：spec scenario「超过 5 次 retry 被拒绝」「acceptance 拒绝不占次数」
- [x] 1.4 失败 attempt 计数测试：retry attempt 以 `FAILED` 终态结束后计入次数，最高 attempt 达 6 时后续 retry 被超限拒绝
  验证：测试先使 retry attempt terminal FAILED，再断言下一次 retry 的拒绝行为
  来源：spec scenario「失败的 retry attempt 占次数」
- [x] 1.5 幂等重放优先级测试：attempt 达上限后，以相同 `idempotencyKey` 和相同 semantic 重放已 accepted 的 retry，返回首次结果且不创建新 attempt、不报超限错误
  验证：测试断言重放返回原 `runId`/`attempt` 且无新 run
  来源：spec scenario「幂等重放不受上限影响」、design D2

## 2. Web channel 安全错误透传

- [x] 2.1 验证 `POST /api/v1/sessions/:sessionId/retry` 超限响应透传 safe error（稳定 code、`retryable=false`），且不包含 tenant、subject、storage、SQL、stack trace 等敏感细节；若现有 channel 错误映射已覆盖则只补测试，不改代码
  验证：`npm run test:contract` 或 channel 错误映射测试实际断言响应体字段
  来源：spec scenario「超限安全错误的 Web 投影」、design D3

## 3. agent-web 禁用投影

- [x] 3.1 `frontend/agent-web` 在 retry 收到 `REQUEST_RETRY_LIMIT_EXCEEDED` 错误后，将当前 latest turn 的 TurnBlock 重试按钮（`btn-retry-ai`）和 Composer 重试按钮（`btn-retry-latest`）置为禁用，并以 message.warning 气泡展示提示（i18n：zh-CN「当前系统仅支持最多5次的重试」及 en-US 对应文案）；禁用不阻止用户提交新 request 或 edit-resubmit
  验证：`cd frontend/agent-web && npm test -- ...` 相关 store/组件测试通过
  来源：spec scenario「超限后 retry 入口的禁用投影」、design D4
- [x] 3.2 禁用态交互细节：禁用的重试按钮复用既有 `favoriteDisabled`/`shareDisabled` 禁用范式——`cursor: not-allowed`、降低透明度、`aria-disabled`，悬浮时 Tooltip 展示 i18n 原因文案（zh-CN「当前系统仅支持最多5次的重试」及 en-US 对应文案）
  验证：`cd frontend/agent-web && npm test -- ...` 组件测试断言禁用样式/aria 与 Tooltip 文案
  来源：spec scenario「超限后 retry 入口的禁用投影」、design D4
- [x] 3.3 `/retry` slash 命令路径：触发后收到超限错误时展示与按钮路径一致的 message.warning 气泡提示，不新增平行提示语义
  验证：`cd frontend/agent-web && npm test -- ...` 相关测试通过
  来源：spec scenario「超限后 retry 入口的禁用投影」、design D4
- [x] 3.4 实时路径禁用：前端从 retry acceptance 响应或 live `REQUEST_ACCEPTED` 事件获知当前 attempt 达 6 时，禁用重试按钮（与 3.1 同一 view state 来源）
  验证：`cd frontend/agent-web && npm test -- ...` 相关测试通过
  来源：spec scenario「超限后 retry 入口的禁用投影」、design D4
- [x] 3.5 前端负例测试：未收到超限错误且 attempt 未知（如刷新后重建历史）时，retry 按钮保持可用；超限错误后按钮禁用且点击不再发出 retry 请求
  验证：`cd frontend/agent-web && npm test -- ...` 断言两种状态
  来源：design D4 取舍、AGENTS.md 负例验证要求

## 4. 验证和收尾

- [x] 4.1 后端常规验证：仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  验证：四条命令全部通过
  来源：AGENTS.md 验证门禁
- [x] 4.2 前端验证：`cd frontend/agent-web && npm run build` 及相关 `npm test -- ...`；确认 local、immersive、collaborative 三宿主复用同一 retry 禁用逻辑，无平行业务语义
  验证：构建与测试通过；code review 检查三宿主入口未各自实现禁用逻辑
  来源：AGENTS.md 验证门禁与前端边界约束
- [x] 4.3 OpenSpec 验证：运行 `openspec validate --all --strict`
  验证：命令通过
  来源：AGENTS.md 验证门禁
- [x] 4.4 清理检查：确认本 change 未引入配置项、未使用的 helper/export 或 test-only 残留；上限只有 runtime 单一常量来源
  验证：diff code review 检查点
  来源：design 非目标、AGENTS.md 实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的「归档前更新基线」处理：

- `openspec/specs/request-retry/spec.md`：合并「Retry attempt 次数上限」requirement。
- `openspec/overview.md`：稳定基线描述补充 retry 上限一句。
- `openspec/designs/architecture/request-run.md`：补充上限常量、计数锚点、超限拒绝语义。
