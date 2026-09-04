# FN-5.8 发现技能

> 能力域 D5 Capability 能力体系 · 子域 [D5.3 Skill 与检索](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-5.6](../../../features/D5-Capability能力体系/D5.3-Skill与检索/F-5.6-Skill系统.md) |
| spec | `builtin-skill-source`、`local-skill-source` |
| 接口 | 系统内部，技能来源 |

## 描述

系统从内置、系统和智能体来源发现技能，智能体自有技能优先于系统级。

## 前置条件

- 技能已注册。

## 输入

技能来源（内置/系统/智能体）。

## 输出

技能描述符。

## 处理过程

1. 系统从各来源扫描技能清单文件。
2. 按归属和优先级处理冲突。
3. 智能体自有技能优先于系统级。

## 结果

- 正常：技能发现完成。
- 无技能：返回空。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 目录扫描深度 | 1 级 | 已定义 | `local-skill-source` |
| 单智能体最大技能数量 | 200 | 建议评审值 | 建议补充 |
| `SKILL.md` 编码校验 | discovery 与 invocation 共用同一 BOM 感知 decode 助手；UTF-8（含 BOM，剥离）接受，UTF-16/GBK/二进制以 `SKILL_MD_UNSUPPORTED_ENCODING` 拒绝且不进入 catalog，frontmatter 一致性 token 两路径一致 | 稳定 | `skill-manifest-contract`：`Skill Manifest Reader Validates Text Encoding Through Shared Decode`、`Skill Manifest Diagnostic Includes Unsupported Encoding Reason Code` |
