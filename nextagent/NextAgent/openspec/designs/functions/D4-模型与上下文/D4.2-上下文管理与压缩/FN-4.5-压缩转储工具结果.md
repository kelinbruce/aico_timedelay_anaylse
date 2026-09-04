# FN-4.5 压缩转储工具结果

> 能力域 D4 模型与上下文 · 子域 [D4.2 上下文管理与压缩](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-4.4](../../../features/D4-模型与上下文/D4.2-上下文管理与压缩/F-4.4-压缩长对话.md) |
| spec | `context-engine`、`large-content-references` |
| 接口 | 系统内部，上下文引擎 |

## 描述

系统压缩旧工具结果，转储大内容为引用，避免工具结果撑爆上下文。

## 前置条件

- 工具结果超过内联阈值。
- history selector 已产生当前 request records 和按 canonical 顺序排列的完整 prior-turn candidates；当前问题之前的全部 canonical 已完成轮次中的 `Rag` capability results 也进入历史工具结果压缩边界。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 工具结果 | 是 | 需处理的工具结果 |

## 输出

压缩后的结果或外部化引用。

## 处理过程

1. 系统识别大工具结果和旧工具结果。
2. 旧工具结果进行微压缩：在每轮转换时，系统替换当前问题之前全部 canonical 已完成轮次中的 `Rag` capability result payloads 为有界确定性占位，保护当前轮 RAG 结果完整；RAG 专用规则不受通用工具数量阈值和最近保留窗口影响，也不参与其计数。其他工具继续使用既有白名单、触发阈值和最近保留规则。
3. 大内容转储为外部化引用，替换为预览。
4. 历史中保留替换形式；重复组装保持相同 model-visible 投影，只对新增 compacted ids 持久化 metadata。
5. render 在重新加载 canonical records 后，依据有效 micro-compaction state 与本次 selected history 可确定识别的全部历史 RAG ids 合并重放占位；metadata 写入失败时仍确定性重放，不使请求失败。

## 结果

- 正常：压缩转储成功；后续问题看到有界的历史 RAG 占位和完整的当前问题 RAG 结果，canonical 历史、消息顺序及工具调用配对保持不变。
- 异常：非法或无法识别的 capability-result payload 被安全跳过；metadata 读取失败按空 state 重新评估；metadata 版本冲突合并最新状态并有界重试。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 单个工具结果内联最大大小 | 64 KiB | 建议评审值 | 建议补充 |
| 历史 RAG 微压缩 | 新问题组装上下文时，当前问题之前全部 canonical 已完成轮次的 `Rag` capability results 无条件替换为有界确定性占位；当前问题 RAG 结果始终排除；RAG 专用规则不受通用 `>10 / keepRecent=5` 阈值影响且不参与其计数；micro-compaction state owner-scoped 幂等，summary compression 后清理 | 稳定 | `context-engine`：`History candidate selection remains separate from final context selection`、`Micro-compaction only replaces safe whitelisted older tool results`、`Micro-compaction state is owner-scoped, idempotent, and cleared after summary compression` |
