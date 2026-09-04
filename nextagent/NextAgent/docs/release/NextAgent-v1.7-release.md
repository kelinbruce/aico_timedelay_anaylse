# NextAgent v1.7 Release Notes

**发布日期**: 2026-06-25
**版本范围**: v1.6 → v1.7
**变更统计**: 15 commits (9 non-merge), 55 文件变更 (+2,420 / -1,043), 覆盖 5 个核心子系统

## 摘要

v1.7 是一个以 **沙箱策略硬化** 和 **大内容分页回读** 为核心的版本。主要交付：

- **沙箱策略从白名单转向黑名单** — 将可执行命令策略从严格的白名单改为灵活的黑名单，并将命令策略决策委托给沙箱层，提升安全性和可维护性。
- **大工具结果分页回读** — 外部化超大工具结果到工作区文件，支持分页回读，避免上下文溢出和性能问题。
- **沙箱输出限制提升至 100 KB** — 将 Bash/Python 沙箱输出限制从原值提升至 100 KB，适应更复杂的诊断场景。
- **Bash/Python 静默截断** — 修复 Bash/Python 输出超限时的硬错误，改为静默截断并保留诊断信息。
- **工具执行限制修复** — 修复打包 Agent ID 未被正确识别导致的工具执行限制失效问题。
- **记忆工具输入标准化** — 标准化记忆工具输入参数，提升记忆写入的可靠性。

---

## 🎯 核心亮点

### 1. 沙箱策略硬化

**OpenSpec Change**: `delegate-bash-policy-to-sandbox`

重构沙箱安全策略，从限制性白名单转向灵活的黑名单机制。

#### 策略模型转变
- 从可执行命令白名单切换到黑名单 (`refactor(sandbox): switch from executable allowlist to denylist`)
- 允许未知命令执行，仅阻止已知危险命令，提升用户体验同时保持安全性

#### 策略委托
- 将命令策略决策委托给沙箱层 (`refactor(bash): delegate command policy to sandbox`)
- 沙箱层统一负责命令安全评估，避免能力层和安全层职责混淆
- 符合架构边界原则，沙箱网关拥有安全决策权

### 2. 大工具结果分页回读

**OpenSpec Change**: `add-large-tool-result-paged-readback`

解决大工具结果导致的上下文溢出和性能问题。

#### 外部化存储
- 超大工具结果外部化到工作区文件 (`feat(large-content-readback): externalize large tool results to workspace with paged readback`)
- 避免大内容占用上下文窗口，保护对话质量

#### 分页回读
- 支持分页读取外部化工具结果，用户可按需查看部分内容
- 统一大内容策略与回读渲染 (`refactor(context-engine): keep readback rendering with large-content policy`)

#### 工程优化
- 去重外部化器替换构建逻辑 (`refactor(large-content-readback): dedupe externalizer replacement build + document raw-fs boundary`)
- 明确原始文件系统边界，防止路径穿越和安全问题

### 3. 沙箱输出限制提升

适应更复杂的诊断和脚本执行场景。

- Bash/Python 沙箱输出限制提升至 100 KB (`feat(agent-capability): increase bash/python sandbox output limit to 100 KB`)
- 支持更长的脚本输出和日志分析

### 4. 静默截断替代硬错误

提升用户体验，避免因输出超限导致任务中断。

- Bash/Python 输出超限时静默截断而非失败 (`fix(capability): silently truncate bash/python output instead of failing`)
- 保留截断标记和诊断信息，用户可感知截断发生

### 5. 工具执行限制修复

修复 Agent 级别工具执行限制未生效的问题。

- 正确识别打包 Agent ID 的工具执行限制 (`fix: honor packaged agent id for tool limit`)
- 确保不同 Agent 配置的工具限制策略正确应用

### 6. 记忆工具输入标准化

提升记忆写入的可靠性和一致性。

- 标准化记忆工具输入参数 (`fix(agent-memory): normalize memory tool inputs`)
- 确保记忆提取和写入时参数格式统一

---

## 🐛 问题修复

### 能力层
- Bash/Python 输出超限时静默截断而非失败 (`fix(capability): silently truncate bash/python output instead of failing`)
- 正确识别打包 Agent ID 的工具执行限制 (`fix: honor packaged agent id for tool limit`)

### 记忆层
- 标准化记忆工具输入参数 (`fix(agent-memory): normalize memory tool inputs`)

---

## 🔧 工程改进

### 重构
- 沙箱策略从白名单切换到黑名单 (`refactor(sandbox): switch from executable allowlist to denylist`)
- 命令策略委托给沙箱层 (`refactor(bash): delegate command policy to sandbox`)
- 大内容策略与回读渲染统一 (`refactor(context-engine): keep readback rendering with large-content policy`)
- 外部化器替换构建逻辑去重 (`refactor(large-content-readback): dedupe externalizer replacement build + document raw-fs boundary`)

### 测试与验证
- 新增大工具结果分页回读产品路径测试 (`tests/large-tool-result-readback-product-path.test.ts`, +171 行)
- 新增运行消息端口外部化测试 (`tests/run-message-port-externalize.test.ts`, +130 行)
- 新增本地运行时包测试 (`tests/local-runtime-package.test.ts`, +38 行)
- 提交生命周期测试覆盖 (`packages/agent-runtime/src/lifecycle/submit.ts`, +3 行)

---

## 📊 统计

| 指标 | 数值 |
|------|------|
| Commits | 15 (9 non-merge) |
| 文件变更 | 55 |
| 代码新增 | +2,420 |
| 代码删除 | -1,043 |
| 主要新功能 | 2 大类 |
| Bug 修复 | 3 |
| 重构 | 4 项 |
| 新增测试 | 339+ 行（3 个新测试文件） |

---

## 🔄 升级指南

### 从 v1.6 升级

1. **沙箱策略**:
   - 可执行命令策略从白名单改为黑名单，未知命令现可执行
   - 命令安全评估由沙箱层统一负责，如有自定义命令策略逻辑请验证兼容性
   - 黑名单配置需在沙箱网关层定义，确认安全策略配置

2. **大工具结果**:
   - 超大工具结果现外部化到工作区文件，确认工作区路径配置
   - 支持分页回读，检查前端 UI 是否正确展示分页控件
   - 大内容策略已统一，如有自定义内容过滤逻辑请验证

3. **沙箱输出限制**:
   - Bash/Python 输出限制提升至 100 KB，确认日志存储和传输容量
   - 输出超限时静默截断而非失败，检查是否需要调整截断标记处理

4. **工具执行限制**:
   - 打包 Agent ID 的工具限制现正确生效，验证不同 Agent 配置的限制策略
   - 如有自定义工具限制逻辑，确认与 Agent ID 识别机制兼容

5. **记忆工具**:
   - 记忆工具输入参数已标准化，检查记忆写入调用是否兼容新格式

### 兼容性

- **Breaking Changes**: 无
- **Deprecated**: 旧版小写工具名将在 v2.0 移除（延续 v1.3 声明）
- **Minimum Node.js**: LTS 版本要求不变

---

## ⚠️ 已知限制

1. **沙箱黑名单**: 黑名单策略已实现基础能力，动态威胁情报集成待后续版本完善
2. **大内容分页**: 分页回读已实现基础能力，智能摘要和关键信息提取待后续增强
3. **输出截断**: 静默截断保留诊断信息，截断位置智能选择（如按行或按结构）待优化
4. **工作区管理**: 外部化文件生命周期管理已实现基础清理，长期存储和归档策略待完善

---

**下一步**: v1.8 将聚焦多 Agent 协作编排、Workflow 并行执行、沙箱动态威胁情报、以及大内容智能摘要。
