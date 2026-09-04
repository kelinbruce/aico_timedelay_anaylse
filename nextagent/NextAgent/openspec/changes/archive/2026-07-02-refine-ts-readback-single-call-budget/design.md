## 背景和现状（Context）

`tool-results/*` 是 large-content readback 的专用产品路径。当前实现里，`workspaceFiles.readText()` 对所有文件统一使用 `policy.maxTextBytes` 作为单次文本预算；产品默认 `workspaceFiles.maxTextBytes = 256000`。这使 `tool-results/*` 虽然有 `offset` / `limit` 分页接口，但未显式分页的默认读取仍可能生成一个极大的 `Read` 结果，并进入当前请求协议消息集合。

对于预算门来说，当前请求下的 `CAPABILITY_RESULT(Read)` 属于 required `current_request` 片段，不能被普通 prior-history omission 或 compression 先行消化。因此本问题的最小修复点不在 context-engine，而在 readback 入口本身：`tool-results/*` 的单次回页必须更早受控。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 让 `tool-results/*` 的默认/显式 `read` 范围在单次调用上有更小且固定的文本预算。
- 超出该预算时，维持既有 `PAGING_REQUIRED` 协议，强制模型分页。
- 保持普通 workspace 文件读取、full-read snapshot、edit/write 前置语义不变。

**非目标：**

- 不改变 `workspaceFiles.maxTextBytes` 的产品默认值 `256000`。
- 不改变 `read.limit=2000` 的 schema。
- 不在 context-engine 内新增针对当前请求 `Read` 结果的特殊预算降级分支。

## 设计决策（Decisions）

1. `tool-results/*` 专用单次文本预算固定为 `16384` bytes。
   这是最小可实施路径：它显著低于产品默认 `256000`，能阻止单次 readback 直接打穿上下文预算；同时仍允许一个有用的初始页。

2. 实现位置放在 `workspaceFiles.readText()`。
   该函数已经拥有 `file_path`、`offset` / `limit`、owner scope、`PAGING_REQUIRED` 和 `limit=1` 无死锁截断语义，是 single-call read budget 的唯一 owner。

3. 预算计算规则：
   - 普通文件：继续使用 `policy.maxTextBytes`
   - `tool-results/*`：使用 `min(policy.maxTextBytes, 16384)`

4. `limit=1` 特例保持不变。
   若单行本身超过预算，仍返回 bounded head + `truncated=true`，避免永久 `PAGING_REQUIRED` 死锁。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不扩大读取 authority；仍走既有 workspace resolver、owner scope 和 `FILE_UNAVAILABLE` 失败路径。 | `npm test -- read-capability.test.ts` |
| 容量 | 阻止 `tool-results/*` 单次 readback 产出接近 256KB 的结果，降低当前请求打穿上下文预算的概率。 | `npm test -- read-capability.test.ts` |
| 可维护性 | 单一 owner：只在 `workspaceFiles.readText()` 收口，不在 context-engine 重复建第二条 readback 限流路径。 | code review |
| 可测试性 | 通过 tool-results 默认读回触发 `PAGING_REQUIRED` 的回归测试覆盖主路径。 | `npm test -- read-capability.test.ts` |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `tool-results/*` 默认读回超 16KB 时必须 `PAGING_REQUIRED` | 1.1 | `npm test -- read-capability.test.ts` |
| 普通文件读取预算语义不变 | 1.2 | 既有 `read-capability.test.ts` 成功用例 |
| active change 规格结构合法 | 2.1 | `openspec validate refine-ts-readback-single-call-budget --strict` |
