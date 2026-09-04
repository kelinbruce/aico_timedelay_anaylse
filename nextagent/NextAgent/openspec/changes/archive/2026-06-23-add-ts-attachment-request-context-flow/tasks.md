## 1. Runtime Acceptance / Durable Attachment Set

- [x] 1.1 在 `agent-runtime` 中实现 acceptance 前的 owner-scoped + agent-scoped attachment authority revalidation：submit、retry latest、edit latest 都必须按当前 `tenantId`、`subjectId`、可信 `agentId` 和 `attachmentIds` 读取权威 `RequestAttachment`，拒绝 cross-owner、cross-agent、not-found、`validationStatus!=ACCEPTED` 或 `availabilityStatus!=AVAILABLE` 的附件。
  验证：runtime contract tests 覆盖 cross-owner、cross-agent、not-found、invalid status、unavailable attachment。
- [x] 1.2 在 acceptance 成功路径上，由 runtime/session owner 将 request final attachment set 持久化到 immutable root user message 或等价唯一权威 message fact；该 durable set 只允许保存 `attachmentIds`。
  验证：integration tests 覆盖 submit success 后 root message 持久化 final attachment set，且不复写 fileName、mediaType、sizeBytes、`BlobRef`。
- [x] 1.3 实现 retry latest 只从被 retry request 的 immutable root message 读取最终附件集合；不得从上传入口临时状态、command cache 或 cleanup diagnostics 重建 attachment set。
  验证：retry flow tests 覆盖 persisted set 为唯一 authority。
- [x] 1.4 实现 edit latest 为新 request 写入新的最终附件集合，而不是“旧集合 + 本次新增附件”的隐式 merge；若 edit latest 为 deferred，必须明确 deferred 状态不能被算作已完成触发路径。
  验证：edit latest integration tests 覆盖 edited request 的 final attachment set 与旧 request 分离，或 deferred assertion 阻止误报完成。

## 2. Context Engine 分类与受控消费

- [x] 2.1 在 `agent-context-engine` 中实现同步 attachment re-read：context build 只能通过 owner-scoped + agent-scoped 权威 `RequestAttachment` 和受控投影边界消费附件，不信任 command、message metadata、模型输出或 capability 参数中的附件描述。
  验证：security tests 覆盖 forged metadata / forged storage reference / cross-agent attachment 被拒绝或忽略。
- [x] 2.2 实现固定分类顺序：对每个附件按 `latest-request-critical`、`latest-request-optional`、`historical`、`excluded` 规则分类，不得把判断留到实现阶段自由决定。
  验证：classification tests 覆盖 current direct binding、historical only、same-attachment controlled replacement、excluded visibility/authority cases。
- [x] 2.3 将 `latest-request-critical` 判定实现为可测试的请求事实规则：当前 request 直接绑定、owner/agent/availability/controlled projection 前置成立，且当前 assembly 不存在同一 `attachmentId` 的等价受控 Markdown 投影、excerpt 或 approved ref；不得引入自由语义分类器或 LLM 判断。
  验证：classification tests 覆盖 critical default、equivalent replacement prevents critical、missing projection fails critical。
- [x] 2.4 实现 `latest-request-critical` 附件优先于 history budget 的 minimum safe current-request context guard；critical attachment 缺失、不可读、跨 owner、跨 agent 或缺少受控投影时必须阻断 model invoke。
  验证：contract/integration tests 覆盖 critical attachment unavailable -> insufficient-context / safe failure。
- [x] 2.5 实现 `latest-request-optional` 和 `historical` 附件在预算压力、读取失败或缺少投影时的显式降级，生成 machine-readable degradation evidence，而不是静默丢弃。
  验证：integration tests 覆盖 optional/historical degrade to already-retained controlled replacement / metadata-only / omission。
- [x] 2.6 首版本地 release 只消费 Markdown 受控投影；非 Markdown 附件缺少受控投影时不得触发 summary/ref 生成。
  验证：tests 覆盖 non-Markdown critical failure、optional/historical explicit degradation、no new summary/ref generation。

## 3. Runtime Failure / Notice Projection

- [x] 3.1 实现 acceptance 阶段 durable attachment set write 失败时的拒绝路径：request MUST NOT 进入 queued / executing。
  验证：integration tests 覆盖 durable write failure blocks acceptance。
- [x] 3.2 实现 context build 失败时的 runtime safe failure projection，禁止把 attachment-informed request 当作纯文本请求继续执行。
  验证：failure-path tests 覆盖 latest-request-critical attachment failure does not invoke model。
- [x] 3.3 实现降级影响答案完整性时的 runtime-owned presentation-safe notice projection，并消费 attachment degradation evidence。
  验证：integration tests 覆盖 non-critical attachment degradation emits notice with safe reason only。

## 4. 非回归与边界验证

- [x] 4.1 添加 negative verification：request final attachment set 的唯一 authority 只能是 immutable root message 或等价唯一权威 message fact；系统不得从 transient command、upload temp state、later diagnostics 或 message metadata copy 推断最终附件集合。
  验证：architecture/source-level assertions 和 contract tests。
- [x] 4.2 添加 negative verification：attachment descriptor、controlled projection、degradation evidence、safe failure 和 notice 不得暴露 `BlobRef`、本地路径、provider SDK handle 或 raw attachment payload。
  验证：security/redaction tests。
- [x] 4.3 添加 integration tests，覆盖 cleanup 后 attachment 收敛为 `UNAVAILABLE` 时，retry/context flow 都读取同一权威事实并显式失败或降级。
  验证：cross-change integration tests。
- [x] 4.4 添加 negative verification：Context Engine 不得只在 render 阶段收集 descriptor 来满足本 change；必须在同步 context build 中产出 per-attachment decision，并把 `latest-request-critical` 纳入 minimum safe current-request context。
  验证：context-engine contract/integration tests。

## 5. 验证与收尾

- [x] 5.1 运行 `openspec validate add-ts-attachment-request-context-flow --strict`。
  验证：命令通过。
- [x] 5.2 运行 request-context-flow 相关 contract、integration、security 和 architecture 验证；实现阶段记录具体命令和关键断言。
  验证：测试命令输出与失败路径断言。
- [x] 5.3 记录验证结果，确认没有通过未声明的实现细节、跨边界假设、自由语义分类器或未写入 summary/ref 能力补足规格。
  验证：review note / task evidence。
