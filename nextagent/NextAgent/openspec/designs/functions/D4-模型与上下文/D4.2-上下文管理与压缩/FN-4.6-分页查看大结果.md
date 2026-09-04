# FN-4.6 分页查看大结果

> 能力域 D4 模型与上下文 · 子域 [D4.2 上下文管理与压缩](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-4.5](../../../features/D4-模型与上下文/D4.2-上下文管理与压缩/F-4.5-分页查看大结果.md) |
| spec | `large-content-readback` |
| 接口 | 读取工具 + 执行工作区 |

## 描述

外部化的大工具结果通过读取工具分页读回，避免一次性加载大内容。

## 前置条件

- 工具结果已外部化到执行工作区。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 文件路径 | 是 | 外部化文件路径 |
| 分页参数 | 否 | 偏移和大小 |

## 输出

分页内容。

## 处理过程

1. 系统定位外部化文件。
2. 按分页参数读取内容；省略或过大的 `limit` 超出单次文本预算时返回安全的 `PAGING_REQUIRED` 错误（含当前字节预算、请求 offset/limit、所选切片字节数和可重试的 `suggestedLimit`），不静默截断成看似完整的页；`limit=1` 且单行本身超预算时可返回有界头部并标记 `truncated=true`。
3. 归属由执行工作区强制。

## 结果

- 正常：返回分页内容。
- 文件不存在：安全失败。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 单文件最大读写大小 | 10 MiB | 建议评审值 | 建议补充 |
| `tool-results` 回读单次预算 | `65536` 字节或配置的 `workspaceFiles.maxTextBytes` 中较小者；超出返回 `PAGING_REQUIRED`（含 `suggestedLimit`） | `large-content-readback / Tool result readback enforces dedicated budget` |
