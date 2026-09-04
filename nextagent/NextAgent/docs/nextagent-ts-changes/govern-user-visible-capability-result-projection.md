# govern-user-visible-capability-result-projection

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)

所属分组：UCD-P1

状态：archived（MR #905 已合入 `main`）
类型：security and user-visible vertical change
主要 owner：`agent-channel-common` safe projection
协作 owner：`agent-app` configuration composition、`agent-channel-web` history projection、`frontend/agent-web` projection consumption
实现分支（已合入）：`codex/govern-user-visible-capability-result-projection`
依赖：message-first process history 已进入主干；无 Gateway 或 `agent-contracts` 新能力依赖

当前状态：

- live stream 与 run-event history 已通过后端共享 projector 从关联 Message 生成 Capability 安全结果。
- conversation history 已不再作为普通 Capability 过程详情来源，浏览器只消费 run-event history 的后端安全投影。
- Capability 身份优先于通用结果形状的基础路径已建立，Issue #367 的内部 Skill/普通工作区 Read 碰撞已有安全回归边界。
- 本 change 实施前的策略初版为四级，成功结果完全隐藏与用户理解执行过程的目标冲突，且现有测试未穷举已支持工具类别、三策略和 Skill 激活工具来源。

目标：

- 为全部 Capability 结果建立 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 三级呈现策略，成功结果至少保留状态，并始终先应用不可被配置放宽的平台安全上限。
- 在启动期系统配置中支持默认级别和按精确 `capabilityId` 覆盖；默认为 `SUMMARY`。内置基线明确将 `Rag` 设为 `SUMMARY`，将 `Skill`、`Agent`、`ApiCall` 设为 `STATUS_ONLY`；内部、非 model-visible 的 `ApiCall` 正常结果仍按既有编排契约作为终态答案呈现，不生成普通工具结果卡片。
- live、SSE/WS、run-event history 与三种 Agent Web 宿主复用同一后端安全投影；conversation history 只承载普通会话消息。
- canonical Message 继续保存模型/工具协议事实，timeline Event 继续只保存时序与关联；浏览器不再从 raw Message content 重建结果。
- 平台摘要以语言中立的 `safeSummaryCode` 与有界、白名单化的 `safeSummaryArgs` 表达，Agent Web 使用现有 i18n 资源按当前界面语言渲染；同一 live/history 事实切换语言时只重渲染，不重新请求或改写历史。
- 同一工具直接调用、经 Skill 或 ToolSearch 激活时，必须按最终 Tool `capabilityId` 使用同一策略和安全 projector。
- 将 Issue #367、Skill/file 形状碰撞、全部已支持结果类别×三策略、Skill 激活扩展工具、unknown/custom、非法关联和 500 步混合工具快速历史浏览纳入强制验收。

OpenSpec：

- [`proposal.md`](../../openspec/changes/archive/2026-08-03-govern-user-visible-capability-result-projection/proposal.md)
- [`design.md`](../../openspec/changes/archive/2026-08-03-govern-user-visible-capability-result-projection/design.md)
- [`ts-run-status-visibility delta`](../../openspec/changes/archive/2026-08-03-govern-user-visible-capability-result-projection/specs/ts-run-status-visibility/spec.md)
- [`tasks.md`](../../openspec/changes/archive/2026-08-03-govern-user-visible-capability-result-projection/tasks.md)

规格输入：

- canonical Capability Result Message 保留模型/工具协议事实，timeline Event 只保留时序、状态和 Message 关联。
- 平台安全上限先于集成配置，unknown、内部 Skill 正文和 schema failure 至多为 status-only。
- AskUserQuestion 已提交且被接受的答案是经过专用 bounded projector 处理的公开对话事实，不属于普通 Capability Result 呈现策略；`STATUS_ONLY`、`SUMMARY`、`DETAIL` 三档配置不得隐藏或改变该答案。
- conversation API 不再向普通 Web 客户端返回非 AskUserQuestion Capability Result 原始 `content`；过程详情从 run-event history 恢复。
- 只读分享保留用户问题和最终 Assistant Message，不包含普通 Capability Result Message、结果正文或结果 metadata。
- 500 步、多轮快速浏览的逐结果请求数为 0，run history 自动加载最多 4 并发、16 个自动目标且同 run 去重。

契约输入：

- 复用 `StreamEnvelope`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED`、现有 `safeResult`/`safeSummary` 字段和 `RuntimeSessionPort.resolveProcessMessages`；平台内置 `SUMMARY` 在同一 envelope 中增加闭合集合内的 `safeSummaryCode` 与按 code 白名单化的 `safeSummaryArgs`，`safeSummary` 仅作为不扩大披露范围的兼容回退。
- 新增 app-private `CapabilityResultPresentationPolicy` 窄投影，不新增 `agent-contracts` enum/DTO/port。
- `includeCapabilityResults=true` 的 item shape 保持兼容，但非 AskUserQuestion Capability Result 的 public `content` 固定为空；该 breaking 行为已在 proposal 标记。
- Gateway port、Record、SQLite table/transaction 和 timeline Event 类型集合不变；本 change 不要求 Gateway 适配或数据迁移。

内置默认策略：

| Capability | 默认级别 | 用户可见语义 |
| --- | --- | --- |
| `Rag` | `SUMMARY` | 显示检索已完成及平台生成的安全摘要，不暴露原始检索正文。 |
| `Skill` | `STATUS_ONLY` | 只显示 Skill 生命周期状态，不展示 Skill 正文、源路径或内部结果。 |
| `Agent` | `STATUS_ONLY` | 只显示委派生命周期状态，不展示子 Agent 内部结果详情。 |
| `ApiCall` | `STATUS_ONLY` | 仅作为异常/兼容路径的防御上限；规范路径直接形成终态答案。 |

其余内置 Capability 继续以 OpenSpec 中的完整基线为准；集成配置只能在平台安全上限内覆盖期望级别。

实现约束：

- 平台安全上限按 Capability 身份与受支持 schema 判定，必须先于通用结果形状识别；集成配置可在三档中选择期望级别，但最终结果不得突破平台安全上限。
- Skill `allowed-tools` / `denied-tools` 只是治理约束，不定义新 Tool 或结果投影；调用来源不得进入策略选择。
- ordinary Web UI 的 `DETAIL` 仍是有界、脱敏、字段白名单化的结果，不等于 raw input/output 或任意 JSON。
- `safeSummaryCode` / `safeSummaryArgs` 只由共享后端 projector 产生，不接收或透传上游伪造值；前端只负责使用现有 `zh-CN` / `en-US` i18n 资源格式化，未知或非法 descriptor 才回退到兼容 `safeSummary`。
- CLIP 的 `resultProjectionKind=CLIP_STREAM_V1` 只能由执行时可信 descriptor 分类产生，仅用于选择共享安全 projector 和恢复 live/history 时序投影；该跨 core/runtime/channel 持久化控制标量由 `agent-common` 单一 owning。它不是用户可见内容，不进入摘要参数、结果标题、分享内容或模型上下文。未知分类必须拒绝，没有可信分类的自定义结果即使形状类似 CLIP 也降级为 `STATUS_ONLY`。
- `agent-app` 只向 channel 注入冻结的窄策略；channel/frontend 不读取源配置。
- run-event history 页面随页面响应携带安全投影，不新增逐结果详情 API；复用既有 4 并发、16 自动目标和同 run 去重调度。

集成配置示例：

```yaml
nextAgent:
  system:
    capability-result-presentation:
      default-level: SUMMARY
      rules:
        - capability-id: Bash
          level: STATUS_ONLY
        - capability-id: Read
          level: DETAIL
        - capability-id: VendorNetworkProbe
          level: DETAIL
```

合法级别只有 `STATUS_ONLY`、`SUMMARY`、`DETAIL`。集成方规则以大小写敏感的最终 Tool `capabilityId` 精确匹配：同一个 `Read` 无论由模型直接调用、Skill `allowed-tools` 激活或 ToolSearch 激活，都只配置 `Read`，不按 Skill 名称或调用来源重复配置。规则只替换同名内置基线项或添加扩展 Tool 项，不会删除其他内置默认项。

配置表达的是产品期望级别，不是安全授权。`VendorNetworkProbe` 即使请求 `DETAIL`，在平台没有为该身份实现受控 schema、字段白名单、脱敏和容量限制的安全 projector 时，最终仍降级为 `STATUS_ONLY`；产品配置不能直接开放 raw input/output 或任意 JSON。
- 不修改 Message 写入、模型上下文、timeline vocabulary、Gateway port/Record/table 或 runtime lifecycle。

非目标：

- 不设计每种工具的专属视觉卡片，不修改 ProcessPanel 折叠动效、long-answer、thinking/answer 自由文本治理。
- 不新增运行期管理员配置 UI/API、按用户策略、热更新或普通 Web raw diagnostics。
- 不把 B5 变成允许任意 safeResult kind 无约束接入的共享框架；新增 kind 仍须由其用户可见 vertical change 定义 schema、上限和降级。

验收出口：

- Read 工作区文件可以按策略显示安全预览，内部 Skill 资源即使结果形状相似也不显示正文/源路径。
- 未配置时默认基线稳定为 `Rag=SUMMARY`、`Skill/Agent/ApiCall=STATUS_ONLY`，集成覆盖不能突破各类别的平台安全上限。
- 已支持的内置结果类别在 contract 层全部覆盖三种策略，扩展和未知结果按平台 projector 能力安全降级。
- 平台内置摘要的 `safeSummaryCode` / `safeSummaryArgs` 通过字段白名单和容量边界校验；同一 live/history envelope 可由前端在中文、英文之间切换渲染，且不产生额外网络请求。
- AskUserQuestion accepted answer 在三档配置下保持同一个 bounded 公开事实；普通 Capability Result 不进入只读分享，用户问题与最终 Assistant Message 保持完整。
- 可信 CLIP classifier 能恢复等价的 live/history 安全投影，但浏览器、分享和模型上下文均不可见该 classifier；伪造 CLIP 形状不能获得摘要或详情。
- 同一内置 Tool 直接调用和经 Skill 激活的投影一致；无安全 projector 的 Skill 激活扩展 Tool 上限为 `STATUS_ONLY`。
- live/history、SSE/WS 和 local/immersive/collaborative 投影相同，普通 conversation 请求不把 Capability Result Message 作为过程详情来源。
- 500 个混合工具过程步骤、多轮会话、预览跳转和快速滚动不产生逐结果请求，已加载结果不因进出视口重复获取。
- backend/frontend 定向测试、build、contract、architecture、e2e 和 OpenSpec strict validation 达到 change 门禁，并确认 `agent-contracts` 与 Gateway 无 delta。

并行边界：

- 可与 session list run-awareness、todo result localization、ProcessPanel interaction change 并行。
- 与任何新增 safeResult kind 的 change 并行时，本 change 拥有共享 policy/projector 与 conversation contract；kind change 只拥有专属 schema/projector/formatter，需在合并前 rebase 并通过统一投影 tests。
