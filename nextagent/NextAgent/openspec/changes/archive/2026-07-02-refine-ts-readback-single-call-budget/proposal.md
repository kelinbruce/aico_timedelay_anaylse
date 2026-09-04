## 背景与问题（Why）

当前 `read` 工具对 `tool-results/<refId>.txt` 的读回虽然支持 `offset` / `limit` 分页，但单次文本预算仍直接复用 Agent workspace file policy 的 `maxTextBytes`。产品默认该值为 `256000`，导致模型在未显式分页时，仍可能一次把接近 256KB 的读回页放回当前请求的 `CAPABILITY_RESULT(Read)`。这会把 `current_request` 的 minimum-safe baseline 直接抬高到超过可用输入预算，触发 `CONTEXT_INSUFFICIENT_BUDGET / MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET`。

本 change 的必要性是把 `tool-results/*` 读回页的单次文本预算收敛到明显小于模型上下文窗口的安全值，使大 readback 必须通过显式分页进入模型，而不是在一个 tool turn 内直接打穿上下文预算。

## 变更范围（What Changes）

- 为 `tool-results/*` 读回路径引入更严格的单次文本预算：默认和显式范围读取都必须受该预算约束，超限时返回 `PAGING_REQUIRED`。
- 普通 workspace 文件 `read` 路径维持既有 `workspaceFiles.maxTextBytes` 预算与行为，不在本 change 收紧。
- 保持 `limit=1` 且单行本身超预算时的无死锁语义：返回 bounded head + `truncated=true`，不无限要求重试。

## Capability 影响（Capabilities）

### 修改的 Capability

- `large-content-readback`：收敛 `tool-results/*` 读回页的单次文本预算与分页行为。
- `ts-minimal-agent-kernel`：补充最小 `read` 工具在 `tool-results/*` 路径上的 bounded readback 语义。

## 影响范围（Impact）

- 代码：`packages/agent-capability/src/builtins/workspace-files/workspace-file-port.ts`
- 测试：`packages/agent-capability/tests/read-capability.test.ts`
- 规格：active change 下 `large-content-readback` 与 `ts-minimal-agent-kernel` delta

## 非目标（Non-Goals）

- 不修改 `current_request` minimum-safe baseline 的预算保护原则。
- 不修改普通 workspace 文件读取的默认最大文本预算。
- 不新增 `read` 参数、额外 Tool、配置项或 Web API。
- 不改变 `tool-results/*` 的 owner scope、path authority 或 `FILE_UNAVAILABLE` 失败语义。

## 验证入口（Verification）

- `npm test -- read-capability.test.ts`
- `openspec validate refine-ts-readback-single-call-budget --strict`
