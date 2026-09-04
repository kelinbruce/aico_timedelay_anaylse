# Design

## 背景与目标

commit `18130774e` 为 `api_header_params` 和 `api_request_params` 等扩展键添加了安全字符串数组支持。commit `511494b77` 在 release 修复时回退了该支持，将 `isSafeExtensionValue` 中数组分支重新改为 `return false`。

本 change 恢复数组支持。

## 当前实现

### skill-manifest.ts（被回退后的状态）

```ts
if (Array.isArray(value)) {
  return false;  // 数组被拒绝
}
```

### agent-contracts/capability/index.ts（被回退后的状态）

```ts
type SkillExtensionValue = string | number | boolean | null | { readonly [key: string]: SkillExtensionValue };
// schema 中没有 Type.Array 分支
```

## 修改方案

### 1. 恢复 skill-manifest.ts 的数组支持

```ts
if (Array.isArray(value)) {
  // Allow arrays of safe strings for whitelisted extension keys
  // (e.g. api_request_params, api_header_params)
  return value.every(
    (item) =>
      typeof item === "string" &&
      item.length <= maxExtensionStringValueLength &&
      !unsafeValuePattern.test(item),
  );
}
```

### 2. 恢复 agent-contracts 的类型和 schema

类型定义增加 `readonly string[]`：

```ts
type SkillExtensionValue = string | number | boolean | null | readonly string[] | { readonly [key: string]: SkillExtensionValue };
```

Schema 增加 `Type.Array(Type.String({ maxLength: 512 }), { maxItems: 64 })` 分支。

## 安全约束

- 数组元素必须是 string 类型，不接受嵌套数组或对象。
- 每个 string 元素长度不超过 512，不匹配 `unsafeValuePattern`。
- 数组最大长度 64（schema 约束）。
- extension key 的 `unsafeKeyPattern` 检查不变。
