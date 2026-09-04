# Wiki 变更日志

Append-only 时序记录。每条以 `## [YYYY-MM-DD] type | 简述` 开头。

## [2026-09-01] ingest | 初始创建
- 新增 README.md：索引、任务→页面映射、维护操作
- 新增 domain-glossary.md：电信运维术语 + NextAgent 架构术语 + 缩写对照
- 新增 architecture-map.md：四层架构、26 包职责、dependency-cruiser 规则
- 新增 package-ownership.md：Agent/Owner Scope、DO/DTO/PO/Record、Gateway 写入模式
- 新增 contract-navigation.md：OpenSpec 目录、14 个 contracts subpath、操作指南
- 新增 data-flow-atlas.md：请求主路径、流式事件、Capability 调用、会话/Fork/记忆/IR 流
- 新增 decision-trees.md：8 棵决策树 + 跨层字段全链路清单
- 新增 anti-patterns.md：Top 10 LLM 错误 + 17 条特殊约束
- 新增 vocabulary-ids.md：27 种 Branded ID、8 种枚举、命名规范
- 新增 frontend-rules.md：前端边界、三宿主模式、技术栈
- 新增 verification-gates.md：验证命令、Push 门禁、测试目录
- 新增 quick-ref.md：关键规则浓缩卡
- 新增 config-and-entry-points.md：配置文件、入口点、数据库
- 新增 openspec-workflow.md：契约先行 7 步工作流
- 新增 test-writing-guide.md：测试分类、位置、模式

## [2026-09-01] ingest | 第一轮优化
- README.md 新增任务→页面映射表（12 种任务类型）
- 新增 quick-ref.md：关键规则浓缩卡
- 新增 config-and-entry-points.md：配置文件与入口点速查
- 新增 openspec-workflow.md：契约先行工作流
- anti-patterns.md 下半段文本墙→结构化表格 + 交叉引用
- 5 个核心页面加交叉引用

## [2026-09-01] ingest | 第二轮优化
- architecture-map.md 依赖方向用 dependency-cruiser 实际规则重写（16 包 subpath 白名单 + 13 条禁止规则）
- 新增 test-writing-guide.md：测试分类、位置、模式、常见错误
- README 任务映射补"写测试"行

## [2026-09-01] ingest | 第三轮优化
- AGENTS.md 新增 LLM Wiki 入口段落
- vocabulary-ids.md 去掉品牌标记列（代码噪音，27 行）
- decision-trees.md 新增第 8 节"新增跨层字段清单"
- anti-patterns Top 10 去重叠，前 6 条改为"错误示例+→见 package-ownership"

## [2026-09-02] ingest | 可复合性改造
- README.md 重写：新增 Ingest/Query 回写/Lint/Log 四种维护操作
- 新增 log.md：时序变更记录
- 各页面加 frontmatter（source, last-verified）
