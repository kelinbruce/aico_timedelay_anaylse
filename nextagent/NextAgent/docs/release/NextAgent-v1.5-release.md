# NextAgent v1.5 Release Notes

**发布日期**: 2026-06-23
**版本范围**: v1.4.1 → v1.5
**变更统计**: 30 commits, 151 文件变更 (+8278 / -335), 覆盖 6 个核心子系统

## 摘要

v1.5 是一个以 **生产可观测性** 和 **长期记忆工具集成** 为核心的版本。主要交付：

- **OpenTelemetry 可观测性全链路集成** — 实现 Trace、Metrics sinks，运行时轨迹投影，工具安全摘要脱敏，以及审计日志镜像，为生产环境提供完整的运行时诊断链路。
- **长期记忆工具集成** — 将长期记忆从网关契约层贯通到运行时工具层，Agent 可在对话中主动检索和写入长期记忆。
- **附件生命周期收尾** — 对齐 multipart 限制与 Markdown 校验，修复清理证据参数顺序，归档 OpenSpec change。
- **能力层硬化** — Bash 非零退出降级处理、不可用 Skill 资源区分、Read/Skill 提示词引导收紧、内置工具描述模板统一。

---

## 🎯 核心亮点

### 1. OpenTelemetry 可观测性全链路集成

**OpenSpec Change**: `add-otel-observability-change`

本版本最重大的变更，从零到一构建了生产级可观测性管线。

#### Trace & Metrics Sinks
- 实现 OpenTelemetry trace 和 metrics sinks (`feat(observability): implement otel trace and metrics sinks`)
- 统一 metrics registry，归档设计文档 (`docs(observability): unify metrics registry change design`)
- 降低本地 metric 日志噪声，避免高基数污染 (`fix(observability): reduce local metric log noise`)

#### 运行时轨迹投影 (Runtime Trajectory Projection)
- 新增运行时轨迹投影能力 (`feat(observability): add runtime trajectory projection`)
- 收紧投影边界，防止非预期数据泄漏 (`fix(observability): tighten projection boundaries`)
- 新增 OpenSpec change 文档 (`docs(openspec): add agent execution trajectory observability change`)

#### 工具安全摘要 (Tool Safe Summaries)
- 投影层新增工具安全摘要 (`feat(observability): project tool safe summaries`)
- 统一工具安全摘要格式 (`feat(observability): unify tool safe summaries`)
- 安全摘要部分脱敏处理 (`fix(observability): partially mask safe summaries`)
- 标准化运行时工具参数日志 (`feat(agent-core): standardize runtime tool argument logging`)

#### 审计日志
- 审计事件镜像到审计日志流 (`feat(observability): mirror audit events to audit log`)

### 2. 长期记忆工具集成 (Long-Term Memory Tool Integration)

将长期记忆从网关契约贯通到 Agent 运行时工具层。

- 实现长期记忆工具集成 (`feat(memory): implement long-term memory tool integration`)
- Agent 可在对话过程中主动检索和写入长期记忆
- 新增记忆运行时集成测试覆盖 (`tests/agent-kernel/memory-runtime-integration.test.ts`, +385 行)

### 3. 附件生命周期收尾 (Attachment Lifecycle Finalization)

**OpenSpec Change**: `add-ts-attachment-lifecycle` (已归档)

- 对齐 multipart 限制与 Markdown 校验 (`fix(attachments): align multipart limits and markdown validation`)
- 修复清理证据参数顺序 (`fix(attachment-runtime): correct cleanup evidence argument order`)
- 归档 attachment lifecycle OpenSpec changes (`archive(openspec): archive attachment changes and refresh design docs`)
- 补充附件生命周期变更文档 (`docs(openspec): add attachment lifecycle changes`)

### 4. 能力层硬化 (Capability Hardening)

- **Bash 非零退出降级**: 将 Bash 非零退出码从硬错误降级为可恢复诊断 (`fix(agent-capability): degrade bash non-zero exits`)
- **不可用 Skill 资源区分**: 明确区分不可用 Skill 资源与其他错误类型 (`fix(agent-capability): distinguish unavailable skill resources`)
- **Read/Skill 提示词引导收紧**: 收紧 Read 工具和 Skill 的提示词引导规则 (`fix(agent-capability): tighten read and skill prompt guidance`)
- **内置工具描述模板统一**: 统一内置工具描述模板格式 (`feat(capability): refine builtin tool descriptions with unified template`)

---

## 🐛 问题修复

### 可观测性
- 安全摘要部分脱敏，防止敏感信息泄漏 (`fix(observability): partially mask safe summaries`)
- 投影边界收紧，防止非预期数据进入观测流 (`fix(observability): tighten projection boundaries`)
- 降低本地 metric 日志噪声 (`fix(observability): reduce local metric log noise`)

### 附件
- 清理证据参数顺序修正 (`fix(attachment-runtime): correct cleanup evidence argument order`)
- Multipart 限制与 Markdown 校验对齐 (`fix(attachments): align multipart limits and markdown validation`)

### 能力层
- Bash 非零退出降级处理 (`fix(agent-capability): degrade bash non-zero exits`)
- 不可用 Skill 资源区分 (`fix(agent-capability): distinguish unavailable skill resources`)
- Read/Skill 提示词引导收紧 (`fix(agent-capability): tighten read and skill prompt guidance`)

---

## 📚 文档与规范

### OpenSpec
- 新增 agent 执行轨迹可观测性 change (`docs(openspec): add agent execution trajectory observability change`)
- 新增附件生命周期变更文档 (`docs(openspec): add attachment lifecycle changes`)
- 归档 attachment changes 并刷新设计文档 (`archive(openspec): archive attachment changes and refresh design docs`)
- 归档 sandbox refinement changes (`archive(openspec): archive sandbox refinement changes`)
- 移除 otel observability adapter change (`docs(openspec): remove otel observability adapter change`)
- 统一 metrics registry change 设计文档 (`docs(observability): unify metrics registry change design`)
- 细化 otel change 范围 (`docs(observability): refine otel change scope`)

### 依赖管理
- 新增开源组件清单 (`docs(deps): add open source component inventory`)
- 重命名中文清单文档 (`docs(deps): rename chinese inventory document`)

### 发布说明
- 新增 v1.4 发布说明 (`docs(release): add NextAgent v1.4 release notes`)

---

## 🔧 工程改进

### 技能
- 新增 gitcode-create-issue 技能 (`feat(skills): add gitcode-create-issue skill`)

### 前端依赖清理
- 清理 agent-web 前端依赖 (`chore(frontend): clean up agent-web dependencies`)

### 可观测性清理
- 清理未使用依赖并添加 otel change (`chore(observability): clean unused deps and add otel change`)

### 测试与验证
- 将 `lint:architecture` 从 `npm test` 分离为独立命令 (`chore(test): separate lint:architecture from npm test`)
- 新增 Web 边界测试 (`tests/agent-kernel/web-boundaries.test.ts`, +28 行)
- 新增 OTEL 可观测性边界测试 (`tests/architecture/otel-observability-boundary.test.ts`, +65 行)
- 新增记忆运行时集成测试 (`tests/agent-kernel/memory-runtime-integration.test.ts`, +385 行)

---

## 📊 统计

| 指标 | 数值 |
|------|------|
| Commits | 30 |
| 文件变更 | 151 |
| 代码新增 | +8,278 |
| 代码删除 | -335 |
| 主要新功能 | 4 大类 |
| Bug 修复 | 8 |
| OpenSpec Changes 归档 | 2 |
| 新增测试 | 458+ 行（3 个新测试文件） |

---

## 🔄 升级指南

### 从 v1.4.1 升级

1. **可观测性集成**:
   - 新增 OpenTelemetry trace 和 metrics sinks，需确认 OTEL collector 配置
   - 工具安全摘要已启用脱敏，日志格式有变化
   - 审计事件已镜像到审计日志流，如有自定义审计集成请验证

2. **长期记忆**:
   - 记忆工具已集成到运行时，Agent 可主动检索和写入长期记忆
   - 确认 gateway 层记忆契约实现兼容

3. **附件**:
   - Multipart 限制和 Markdown 校验已对齐，检查上传限制配置
   - 清理证据参数顺序已修正，如有自定义清理逻辑请检查

4. **能力层**:
   - Bash 非零退出码不再视为硬错误，改为可恢复降级
   - 内置工具描述模板已统一，如有自定义描述解析请验证
   - Read/Skill 提示词引导规则收紧，检查 Skill 行为是否符合预期

### 兼容性

- **Breaking Changes**: 无
- **Deprecated**: 旧版小写工具名将在 v2.0 移除（延续 v1.3 声明）
- **Minimum Node.js**: LTS 版本要求不变

---

## ⚠️ 已知限制

1. **可观测性**: OTEL trace/metrics sinks 已实现基础集成，高级聚合和告警规则待后续版本完善
2. **长期记忆**: 工具集成已完成，自学习 aging 和记忆优先级排序机制仍待深化
3. **附件**: Markdown 校验覆盖基础格式，复杂嵌套结构校验待增强
4. **审计日志**: 审计事件镜像为同步写入，异步批量投递待后续优化

---

**下一步**: v1.6 将聚焦多 Agent 协作编排、可观测性高级聚合、以及长期记忆自学习深化。
