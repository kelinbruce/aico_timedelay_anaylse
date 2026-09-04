## Why

用户对最新回答执行 Retry 后，Agent Web 可能继续保留上一次 attempt 的执行详情，并把新 attempt 的过程或最终答案追加到旧过程之后；在某些顺序下，旧 attempt 的最终答案还会抑制新 attempt 的最终答案。用户因此无法判断当前看到的是第一次执行还是重试结果，也可能在模型已经成功返回后看不到最终答案。

与此同时，Edit 即使没有改变问题及其他有效输入，当前仍会创建新的 request 并替换完整原轮次。该行为与“重新生成同一问题答案”的 Retry 在界面上容易混淆，却产生不同的 request lineage、执行配置、附件和重试配额语义。

需要让用户发起的操作与页面投影保持一致：Retry 只展示同一 request 的当前 attempt；Edit 只在有效输入发生变化时替换完整 request。修复必须保持已经分享的会话快照、fork child 的独立执行和正常 Edit 行为不变。

## 目标与非目标

**目标：**

- Retry 被接受后，当前会话中的该轮次原子切换到新 `runId`，旧 attempt 的 Think、工具过程和答案不再作为当前结果参与合并或抑制新结果。
- Retry 接受前失败时保留原 attempt；接受后新 attempt 尚未产生内容时显示无旧过程的执行中状态。
- live、会话切换返回和 authoritative history reload 对同一当前 attempt 得出一致结果。
- 已存在的分享快照继续展示创建分享时冻结的 attempt；Retry 后新建分享展示新 attempt。
- fork child 的 Retry 只切换 child-owned attempt，不修改 parent session 或已有分享。
- Edit 仅在规范化后的有效输入与原请求有效输入存在差异时提交；完全未变化时不创建 request、不隐藏原轮次，并提示用户内容未修改。
- 正常 Edit 继续创建新 request 并替换完整原轮次，不复用 Retry attempt 投影。

**非目标：**

- 不修改 Runtime 的 Retry/Edit 生命周期、attempt lineage、最新请求判定、可见性写入或 terminal commit。
- 不修改分享快照、fork、message、timeline、Gateway、数据库、Web API、stream event 或 `agent-contracts`。
- 不支持重试历史非 latest request，不恢复被替换 attempt 为普通会话的默认可见结果。
- 不把未变化 Edit 静默转换为 Retry；需要重新生成时继续使用 Retry 操作。
- 不改变 Edit 的现有 text-only 附件边界，也不新增执行配置选择入口。

## What Changes

- 修改 Agent Web 的轮次合并规则：canonical assistant answer、Think 和工具过程只在同一当前 `runId` 内合并与去重，不再由其他 attempt 的历史答案抑制当前 attempt。
- 修改 Retry 接受后的本地投影切换：以 HTTP/权威 stream 确认的 retry `runId` 作为当前 attempt，清除该轮次旧 attempt 的当前展示和历史加载目标，但保留其缓存及后端可追溯事实。
- 修改 Edit 确认行为：比较规范化后的可见问题和有效定向输入；全部未变化时阻止提交并显示安全提示，任一有效输入变化时沿用现有 Edit replacement。
- 增加 Retry、Edit、分享快照、fork child、live/history 和会话切换的行为回归验证。

本 change 不包含破坏性公共契约变更。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-2.3` `重试请求`，对应 `request-retry`：补充 Agent Web 当前 attempt 原子投影、跨 attempt 隔离、分享快照和 fork child 非回归行为。系统质量属性为一致性、可追溯性、可靠性和可测试性。
- `FN-2.1` `提交请求` 的 Edit replacement 边界，对应 canonical spec `request-edit-resubmit`：补充 Agent Web 未变化 Edit 的 no-op 行为，不改变 Runtime Edit command、公共输入输出或持久化契约。系统质量属性为一致性和可测试性。

### 新增或移除的 Function

无。

## 影响范围

- 最终用户：Retry 后只看到当前重试过程和答案；未修改内容直接确认 Edit 时收到明确提示，原轮次保持不变。
- Agent 开发者与平台集成方：无需修改 Runtime、Gateway、分享、fork、stream 或配置接入。
- 运维人员：旧 attempt 和被 Edit 替换的事实仍按既有授权路径可追溯，不改变审计边界。
- 主要实现和验证范围为 Agent Web 的 request control、conversation projection、轮次合并及其前端测试。
- `fix-agent-web-fork-inherited-action-eligibility` 的实现已进入当前 `main`，但其 OpenSpec 尚未归档；本 change 保留该 change 对同一 Edit Requirement 的最终目标态，并要求前者先归档、本 change 后归档。
- 与 active change `harden-agent-web-request-acceptance-control` 无功能依赖，但共享 request control 写入区域；并行开发时必须在后合入 change 中重新基于最新 `main` 验证 pending identity、single-flight 和 terminal settlement。
