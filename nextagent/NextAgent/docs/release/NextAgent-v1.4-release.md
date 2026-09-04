# NextAgent v1.4 Release Notes

**发布日期**: 2026-06-23
**版本范围**: v1.3 → v1.4
**变更统计**: 191 commits, 涉及 476 文件变更, 覆盖 12+ 核心子系统

## 摘要

v1.4 是一个重大功能版本，围绕 **工具发现与延迟披露**、**附件生命周期管理**、**长期记忆网关**、**RAG 知识检索**、**Agent 子运行治理**、**上下文微压缩** 六大方向展开，同时引入双语电信输出规范、人机交互挂起流程和风险策略统一化。本版本在工具规模化（1000 级 Skill 发现）、安全边界硬化（沙箱/治理/不安全引用拒绝）和打包可靠性方面均有显著提升。

---

## 🎯 核心亮点

### 1. ToolSearch 工具 — 延迟工具发现与披露

**OpenSpec Change**: `add-ts-tool-search-tool`

大规模 Skill 场景下的工具发现与按需披露机制，避免将所有工具描述一次性注入上下文。

- **搜索门控披露**: 工具不再默认全部暴露，模型通过 ToolSearch 主动发现可用能力 (`feat(tool-search): gate tool disclosure by search`)
- **Skill 披露搜索模式**: 支持按 Skill 维度检索，暴露已发现 Skill 为延迟上下文 (`feat(tool-search): add skill disclosure search mode`)
- **CLIP 延迟加载**: 工具描述器按需懒加载，减少启动期上下文开销 (`feat(tool-search): add CLIP lazy loading disclosure`)
- **内置工具保持即时**: 内置工具不参与延迟，确保 Skill 校验不受影响 (`feat(tool-search): keep builtin tools eager for skill validation`)
- **延迟披露与 Provider 搜索分离**: 架构上将 deferred disclosure 和 provider search 解耦 (`feat(tool-search): separate deferred disclosure from provider search`)
- **大规模验证**: 100 Skill E2E 场景、1000 Skill 规模 fixture、多轮上下文压力测试

### 2. 附件生命周期管理 (Attachment Lifecycle)

**OpenSpec Change**: `add-ts-attachment-lifecycle`

端到端的附件处理能力，覆盖摄入、上下文流转和清理。

- **附件摄入与上下文流转**: 支持附件从上传到模型上下文的全链路 (`feat(attachment): add intake, context flow, and cleanup`)
- **简化摄入流程**: 重构 intake flow，增强 E2E 证明 (`refactor(attachment-lifecycle): simplify intake flow and strengthen e2e proof`)
- **清理证据参数顺序修正**: 修复 cleanup evidence 参数传递顺序 (`fix(attachment-runtime): correct cleanup evidence argument order`)

### 3. 上下文微压缩 (Context Micro-Compact)

**OpenSpec Change**: `add-ts-context-micro-compact`

上下文装配阶段的预钩子压缩机制，优化大规模对话的 prompt 效率。

- **预钩子压缩**: 在 context assembly 前执行微压缩 (`feat: add micro-compact pre-hook for context assembly`)
- **状态持久化**: 微压缩状态跨请求持久化，render-stage 替换正确应用 (`fix: persist micro-compact state and fix render-stage replacement`)
- **大小写不敏感白名单**: 工具名匹配采用大小写不敏感策略 (`fix: case-insensitive tool name matching in micro-compact whitelist`)

### 4. 长期记忆网关 (Long-Term Memory)

长期记忆核心网关契约实现与配置集成。

- **网关契约实现**: 长期记忆 gateway contracts 落地 (`feat(memory-core): implement long-term memory gateway contracts`)
- **原子批量写入**: 记忆写入采用原子 batch，提取 app composition helpers (`fix(memory): enforce atomic batch writes and extract app composition helpers`)
- **配置快照装配**: 应用级记忆配置快照接入 (`feat(memory-configuration): wire app memory config snapshot`)
- **提取提示词边界收紧**: 防止记忆提取溢出或误捕获 (`feat(memory): tighten extraction prompt boundaries`)
- **过滤器验证**: 长期记忆查询过滤器校验 (`fix(memory-core): validate long-term memory filters`)
- **网关契约缺口修复**: 补齐 gateway contract gaps (`fix(memory-core): close gateway contract gaps`)
- **命名空间语义对齐**: 与 nextAgent 命名空间语义统一 (`fix(memory): align long-term memory semantics with nextAgent namespace`)

### 5. RAG 知识检索工具

**OpenSpec Change**: `add-ts-rag-tool-spec`

本地知识检索能力，含治理层和 gateway 契约。

- **检索 Gateway 契约**: 定义并实现 RAG 检索 gateway contract (`feat(rag): add retrieval gateway contract and tool`)
- **本地知识治理**: 接入本地知识治理管线 (`feat(rag): wire local knowledge governance`)
- **不安全引用拒绝**: 拒绝 drive-relative 和不安全的 provider 引用 (`fix(rag): reject drive-relative provider references`, `fix(rag): reject unsafe provider references`)
- **工具诊断路由**: 工具诊断通过工具定义路由，非本地直出 (`fix(rag): route tool diagnostics through tool definitions`)
- **治理范围收窄**: OpenSpec 设计文档明确本地 RAG 治理边界 (`docs(openspec): narrow local rag governance scope`)

### 6. Agent 工具与子运行治理

**OpenSpec Change**: `add-ts-agent-tool`

Agent 间委托执行的治理框架。

- **受治理的子运行**: Agent tool 支持 governed subruns (`feat(agent-runtime): add governed Agent tool subruns`)
- **子 Agent 失败诊断**: 子 Agent 执行失败时返回可理解诊断 (`fix(agent-tool): handle subagent failure diagnostics`)
- **执行恢复对齐**: 子 Agent 执行恢复语义对齐 (`fix(agent-tool): align subagent execution recovery`)
- **子 Agent 执行契约**: capability 层拥有 subagent execution contract (`refactor(capability): own subagent execution contract`)
- **架构约束**: capability contract subpath 访问限制测试 (`test(architecture): restrict capability contract subpaths`)

---

## 🚀 新功能

### 7. 双语电信输出规范 (Bilingual Telecom Output)

**OpenSpec Change**: `bilingual-telecom-output`

面向电信网络运维场景的输出规范。

- **双语输出规则**: context-engine 实现双语电信输出规则 (`feat(context-engine): implement bilingual telecom output rules`)
- **系统段落排序**: 系统提示词段落按电信规范排序 (`feat(context-engine): add bilingual telecom output rules and system section order`)

### 8. 人机交互挂起流程 (Human Pending Input)

支持 Agent 在执行过程中向人类请求输入并等待响应。

- **挂起输入流程**: 完整的人机 pending input 生命周期 (`feat(pending-input): add human pending input flows`)
- **AskUserQuestion 触发策略**: 精细化的问题触发策略 (`feat(ask-user-question): refine trigger policy`)
- **问题流程与控制优化**: 挂起期间的问题流程和交互控制 (`fix(pending-input): refine question flow and controls`)

### 9. 风险策略统一化

将内置工具风险等级统一到 medium，简化策略配置。

- **内置工具风险统一**: 所有内置工具风险统一到 medium (`refactor(risk-policy): unify builtin tool risk at medium`)
- **审批挂起默认值恢复**: 恢复审批挂起的默认行为 (`revert(risk-policy): restore approval suspension default`)
- **沙箱就绪状态对齐**: 沙箱 readiness 与 validation toggle 对齐 (`fix(sandbox): align readiness with validation toggle`)
- **本地 Shell 模式**: 当沙箱验证禁用时启用 trusted local shell mode (`fix(sandbox): enable trusted local shell mode when validation is disabled`)
- **沙箱不可用与执行拒绝区分**: 明确区分 rejected requests 和 unavailable execution (`fix(sandbox): distinguish rejected requests from unavailable execution`)
- **沙箱不可用延迟**: risk policy 将 sandbox unavailable 延迟到 sandbox execution 阶段 (`fix(risk-policy): defer sandbox unavailable to sandbox execution`)

---

## 🐛 问题修复

### Skill & Capability
- 技能 Scope 匹配放宽 (`fix(agent-capability): relax skill scope matching`)
- 技能来源变更失败拆分与安全诊断 (`fix(skill): split source change failures and add safe diagnostics`)
- 本地技能加载事实竞态稳定化 (`fix(agent-capability): stabilize local skill loading fact diagnostics`)
- 技能清单忽略空 metadata 值 (`fix(skill-manifest): ignore empty metadata values`)
- 技能资源 reader context 保留 (`fix(capability): preserve Skill resource reader context`)
- 系统本地发现扫描缓存 (`perf(skill): cache system local discovery scans`)
- 技能日志字段简化 (`refactor(skill): simplify skill log fields`)
- 技能调用延迟加载规则澄清 (`fix(skill): clarify lazy-load invocation rules`)
- SkillHub 品牌 Agent scope 授权保留 (`fix(skillhub): preserve branded agent scope in authorization`)

### CLIP & 工具调用
- CLIP 工具选择硬化 (`fix(capability): harden CLIP tool selection`)
- 预设工具调用面保留 (`fix(tool-search): preserve preset tool calling surface`)
- 工具发现上下文 rebase 后保留 (`fix(tool-search): preserve discovered tool context after rebase`)
- Bash 可重试失败返回模型 (`fix(capability): return retryable bash failures to model`)
- 内置工具描述符和 Python id 对齐 (`fix(builtin-tools): align tool descriptors and Python id`)

### 打包 & 构建
- Release pack 期间重建 agent-web (`fix(packaging): rebuild agent-web during release pack`)
- 本地运行时打包前重建 workspace (`fix(packaging): rebuild workspace before local runtime pack`)
- 运行时包目录可移植复制 (`fix(packaging): copy runtime package directories portably`)
- Release config sample 强制 env refs (`fix(packaging): enforce env refs in release config sample`)

### 测试基础设施
- SQLite 隔离修复 (`fix(test): fix-test-sqlite-isolation`)
- 拆分日常和发布验证套件 (`fix(test): split daily and release validation suites`)
- Release 套件使用 release vitest config (`fix(test): run e2e release suite with release vitest config`)
- Windows 工具路径解析 (`test(agent-platform-gateway-local): resolve windows utility paths`)
- 沙箱风险断言对齐 (`test(agent-kernel): align sandbox risk assertions`)
- 长期集成等待稳定化 (`test: stabilize long-running integration waits`)
- Mock gateway 补充 updateMetadata stub (`fix: add updateMetadata stub to test mock gateways`)
- 审批门控 Bash 组合测试恢复 (`test(agent-kernel): restore approval-gated Bash composition tests`)

---

## 🔧 工程改进

### Git Hooks
- 新增 pre-push 测试钩子，push 前自动运行验证 (`chore(githooks): add pre-push test hook`)

### OpenSpec 归档
- 归档已完成的 OpenSpec changes:
  - `add-ts-bash-tool`
  - `add-ts-risk-policy-medium-unify`
  - `add-ts-agent-tool`（设计归档）
  - `add-ts-rag-tool-spec`
  - `add-ts-context-micro-compact`
  - `add-ts-attachment-lifecycle`
  - `add-ts-tool-search-tool`
  - `bilingual-telecom-output`

### 调试与诊断
- NextAgent CLIP mock 启动 skill (`chore(debug): add NextAgent CLIP mock startup skill`)
- OpenSpec 归档设计同步工作流 (`docs(skills): add openspec archive design sync workflow`)

---

## 📊 统计

| 指标 | 数值 |
|------|------|
| Commits | 191 |
| 文件变更 | 476 |
| 主要新功能 | 9 大类 |
| Bug 修复 | 30+ |
| OpenSpec Changes 归档 | 8+ |
| 新增测试场景 | 50+（含 100/1000 Skill 规模化测试） |

---

## 🔄 升级指南

### 从 v1.3 升级

1. **工具披露变更**:
   - 工具默认不再全部暴露，模型需通过 ToolSearch 发现额外能力
   - 内置工具 (Read, Write, Edit, Grep, Bash) 仍保持即时可用
   - 如自定义 Skill 数量较大，建议验证 ToolSearch 发现路径

2. **附件功能**:
   - 新增附件生命周期管理，如需使用请配置 `agent-attachment-runtime`
   - 清理证据参数顺序已修正，如有自定义清理逻辑请检查

3. **长期记忆**:
   - 记忆网关契约已实现，需确认 gateway 实现兼容
   - 配置快照接入 app composition，检查 `memory-configuration` 设置

4. **RAG 检索**:
   - 新增 RAG 工具及本地治理，provider 引用安全校验已启用
   - drive-relative 路径将被拒绝，确保 provider 配置使用绝对路径

5. **Agent 工具**:
   - Agent 间子运行已纳入治理，检查 subagent execution contract
   - 子 Agent 失败诊断格式变更，确保上层处理逻辑兼容

6. **风险策略**:
   - 内置工具风险统一到 medium，如有自定义策略配置请审查
   - 沙箱验证禁用时自动启用 trusted local shell mode

7. **上下文压缩**:
   - 新增 micro-compact pre-hook，状态跨请求持久化
   - 工具名白名单匹配改为大小写不敏感

### 兼容性

- **Breaking Changes**: 工具披露从全量改为搜索门控（ToolSearch），已有 Skill 需验证发现路径
- **Deprecated**: 旧版小写工具名将在 v2.0 移除（延续 v1.3 声明）
- **Minimum Node.js**: LTS 版本要求不变

---

## ⚠️ 已知限制

1. **ToolSearch**: 当前 CLIP 延迟加载仅支持 Skill 维度，Tool-only 延迟发现待后续版本
2. **RAG**: 本地治理仅覆盖 builtin provider，远程 provider 治理待扩展
3. **长期记忆**: 自学习机制尚处于基础阶段，aging 和记忆优先级排序待完善
4. **人机交互**: pending input 流程仅支持单轮挂起，嵌套挂起待设计
5. **双语输出**: 电信输出规范覆盖系统段落，用户侧自定义段落排序待支持

---

**下一步**: v1.5 将聚焦长期记忆自学习深化、生产环境可观测性全链路集成、以及多 Agent 协作编排。
