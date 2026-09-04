## 设计范围

| 需求 | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| 1. 一致性令牌携带完整文档哈希 | consistencyToken 新增 documentHash | `skill-manifest-contract` | 需求 1 |
| 2. 调用时正文篡改校验 fail-closed | loadCanonicalBodyView 追加可信基准比对 | `local-skill-source` | 需求 2 |

## 需求 1：一致性校验令牌携带完整文档哈希

### 目标

`skill-manifest-contract` 的 `consistencyToken` 在既有 `frontmatterHash`（frontmatter 块 sha256）之外新增 `documentHash`（frontmatter + body 完整文档 sha256），使调用时正文加载路径能够检测 body-only 篡改。

### 当前实现

`consistencyToken`（[skill-manifest.ts](../../../packages/agent-capability/src/skills/skill-manifest.ts)）只计算 `frontmatterHash`。`loadCanonicalBodyView` 返回值经 `...consistencyToken(...)` 展开，因此令牌新增字段会自动流入调用时加载视图（`SkillDocumentLoadView`）。

### 修改方案

1. `consistencyToken` 返回值新增 `documentHash: createHash('sha256').update(source, 'utf8').digest('hex')`——`source` 是完整文档文本（frontmatter + body）。
2. 类型同步：`SkillDocumentConsistency` 增加 required `documentHash`；`SkillDocumentLoadView` 增加 required `documentHash`；`SkillCanonicalBodyView` 增加 optional `documentHash`（无法为完整文档担保的 source 留空，如 remote source）。
3. 不把 `documentHash` 加入 frontmatter `reservedSourceMetadataKeys`：该哈希由加载路径实时计算，不来自 frontmatter 声明，无伪造面。

## 需求 2：调用时正文篡改校验 fail-closed

### 目标

`LocalSkillDiscovery.loadCanonicalBodyView` 在既有 `frontmatterHash`、`skillVersion` 两道校验之后追加第三道：agent 目录加载文件的 `documentHash` 与可信 Skill Hub cache 副本的完整文档哈希比对，不一致时 fail-closed。

### 当前实现

`loadCanonicalBodyView`（[skill-discovery.ts](../../../packages/agent-capability/src/local/skill-discovery.ts)）通过 `loadCanonicalBodyViewFromFile` 读取 agent 目录 `SKILL.md`，校验 `frontmatterHash` 与 `skillVersion` 后返回 body。body-only 篡改两道校验均通过，正文被原样注入。

### 可信基准

- 待校验（执行加载源）：`<agentPackageRoot>/skills/<skill>/SKILL.md`
- 基准（可信副本）：`<appShareDir>/cache/skillhub/<skill>/SKILL.md`，由 Skill Hub 同步链路写入
- `appShareDir` 来自部署环境注入的 `_APP_SHARE_DIR` 环境变量

`readTrustedDocumentHash` 读取基准文件并经共享 `decodeText` 解码后计算 sha256。基准不可得时（环境变量缺失、文件不存在、读取或解码失败）返回 `undefined`，校验跳过——fail-open 只作用于"无基准"场景，避免误拦 runtime-generated 等未经 Skill Hub 同步的 Skill。

### 修改方案

1. 在 `skillVersion` 校验之后追加比对：`trustedHash !== undefined && loaded.documentHash !== trustedHash` 时记录 `LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH` 安全日志并返回 `undefined`。
2. 返回值带上 `documentHash`，供下游（如 `matchesDescriptor` 未来扩展）消费。
3. fail-closed 链路复用既有机制：`loadCanonicalBodyView` 返回 `undefined` → `skill-tool.js` 的 `loaded.value === undefined` 分支 → `SKILL_SOURCE_CHANGED`（AUTHORIZATION）→ status 非 `SUCCEEDED`，篡改正文不注入。

### 为什么不改 matchesDescriptor

原方案拟在 `builtins/skill-tool.ts` 的 `matchesDescriptor` 追加 `body.documentHash === descriptor.consistency?.documentHash` 比对。实测 local descriptor 运行时不携带 `consistency` 字段（`mapSkillFrontmatterToDescriptor` 不并入，local `scanRoot` 也不注入哈希），照搬会使 `"<hash>" === undefined` 恒为 false，所有正版 local Skill 调用全部失败。fail-closed 已由 `loadCanonicalBodyView` 返回 `undefined` 实现，`matchesDescriptor` 维持三段比对不动。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| body-only 篡改被 fail-closed 拦截 | 只校验 frontmatterHash/skillVersion | 新增 documentHash 比对 |
| 无基准 Skill 不被误拦 | 无基准时无法比对 | 基准不可得返回 undefined 跳过 |
| 同源一致篡改可检出 | 哈希比对依赖 cache 副本独立可信 | 不解决，需上游 packageHash 信任链 |
| 可信基准来自仓库原生配置 | `_APP_SHARE_DIR` 是部署环境变量，`LocalSkillDiscoveryOptions` 无此输入 | 已知技术债，见风险与取舍 |

### DFX 影响

| 质量属性 | 实现机制 | 验证关注点 |
|---|---|---|
| 安全 | body-only 篡改从原样注入变为 fail-closed | 篡改后调用返回 SKILL_SOURCE_CHANGED |
| 可靠性 | 基准读取失败跳过校验而非误拦 | 无 cache 副本时正版 Skill 正常加载 |
| 可审计性 | `LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH` 低基数日志 | 日志不泄露 raw 路径或正文 |
| 兼容性 | 无环境变量/无副本时行为与既有完全一致 | runtime-generated Skill 回归通过 |
| 性能 | 调用时多读一个 cache 文件并计算 sha256 | 文件量级为 KB，可忽略 |

## 验证策略（Verification Strategy）

- 单元测试（`packages/agent-capability/tests/local-skill-source.test.ts`）：agent 目录 body 篡改 + cache 副本为正版 → 加载返回 `undefined` 且日志含 `LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH`；正版与副本一致 → 正常加载；cache 副本删除 → 跳过校验正常加载。
- 既有回归：`local-skill-source`、`skill-manifest`、`skill-manifest-encoding`、`builtin-skill-source`、`skill-tool` 测试全量通过，确认 `matchesDescriptor` 未受影响。
- 生产验证：服务器 60.14.50.241 实测，agent 目录 body 篡改后调用被拦下。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/skill-manifest-contract/spec.md`：归档时新增"一致性校验令牌携带完整文档哈希" requirement。
- `openspec/specs/local-skill-source/spec.md`：归档时新增"调用时正文篡改校验 fail-closed" requirement。
- `openspec/designs/spec-to-design-map.md`：归档时如涉及映射变化同步更新。
- 其他 baseline 文档：无变更。

## 风险与取舍（Risks / Trade-offs）

- **`_APP_SHARE_DIR` 环境变量不是仓库原生配置**：本仓库配置模型中可信输入应由 app composition 经 `LocalSkillDiscoveryOptions` 传入。当前实现为与生产部署实测行为保持一致直接读环境变量；本地自建运行环境无该变量时校验静默跳过。后续可单独 change 把可信基准目录改为 options 传入。
- **同源一致篡改不可检出**：agent 目录与 cache 副本被一致地同时篡改时哈希比对通过。彻底解决需要 Skill Hub 同步链路上游 packageHash 信任链，本 change 不做。
- **fail-open 边界**：基准不可得时跳过校验是有意的兼容性取舍（不误拦 runtime-generated Skill），代价是无基准 Skill 不受此防护。
- **`documentHash` 计算成本**：每次调用时正文加载多一次完整文档 sha256（已有 frontmatterHash 计算路径，量级相同，可忽略）。

## 迁移与回滚（Migration / Rollback）

- 无配置迁移：环境变量与 cache 目录布局已存在于部署环境。
- 回滚：移除第三道校验即恢复原行为；`documentHash` 字段为纯追加，回滚不影响既有消费方。

## 待确认问题（Open Questions）

无。
