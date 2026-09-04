# ADR: AICOConfig 手写校验

## 状态（Status）

Accepted.

## 背景与现状（Context）

AICOConfig 从不可信的宿主控制边界进入前端：immersive `sessionStorage` 和 collaborative PIU `loadAIAgent` payload。该 schema 仅限前端，由浅层 JSON 兼容对象、字符串、enum、数组、布尔值和尺寸值组成。

## 决策（Decision）

AICOConfig 校验在前端入口边界使用手写 TypeScript 函数，而不是 TypeBox/Ajv 或其他 runtime schema 库。

校验器返回净化后的 AICOConfig 或 null。未知字段被忽略，缺失字段保持默认值，非法顶层值回退到全部默认值并给出一个警告，非法数组元素被过滤并警告，enum 失败回退到字段默认值。

## 理由（Rationale）

该 schema 足够简单，可以显式检查；前端 bundle 应避免为这个孤立的 UI 配置增加 Ajv 运行时重量；且该做法与 agent-web 既有手写 PIU 校验模式一致。

## 结果（Consequences）

每个新增 AICOConfig 字段必须更新校验器和聚焦的单元测试。该校验器不是后端或公开 API schema，不得被复用于授权 identity、owner scope、agent scope、tool 权限或后端行为。
