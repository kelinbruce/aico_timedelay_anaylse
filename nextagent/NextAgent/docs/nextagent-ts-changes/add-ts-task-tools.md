# add-ts-task-tools

## 变更概述

Task tools 工具族（TaskCreate、TaskGet、TaskList、TaskOutput、TaskStop、TaskUpdate）的统一 OpenSpec umbrella design/spec/schema。

## 规格输入

- OpenSpec: `openspec/changes/add-ts-task-tools/design.md`
- Spec: `openspec/changes/add-ts-task-tools/specs/task-tools/spec.md`
- Tasks: `openspec/changes/add-ts-task-tools/tasks.md`

## 契约输入

- Task tools 是 thin entry，转发到 runtime-owned task service
- 不拥有 task lifecycle 状态机
- owner scope 和 agent scope 从 trusted runtime context 强制

## 状态

- 状态：active
- 类型：capability
- 主要 owner：Owner 9 Tool Capability

## 目标

新增 6 个 Task tool entry（TaskCreate、TaskGet、TaskList、TaskOutput、TaskStop、TaskUpdate），定义统一的目标态 input/output schema、DFX 和验证映射。

## 规格变更

- 新增 `openspec/changes/add-ts-task-tools/design.md`
- 新增 `openspec/changes/add-ts-task-tools/specs/task-tools/spec.md`

## 非目标

- 不在 `agent-capability` 内实现 task runtime 或持久化状态机
- 不定义定时任务或平台 cron
- 不让工具参数覆盖 owner scope、agent scope 或 task ownership

## 验收要点

- 6 个工具的目标态 input/output schema 有明确 contract 覆盖
- owner scope 和 agent scope 从 trusted context 强制
- cross-owner task 访问被拒绝
- timeout/cancellation 传播到 task service
