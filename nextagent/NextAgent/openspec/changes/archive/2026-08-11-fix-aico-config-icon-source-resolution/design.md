## 设计范围

- **FN-10.6 前端定制**：icon 字段来源类型从 "base64 only" 扩展为四种格式。涉及 delta spec `aico-config-contract`。设计章节见下。

## FN-10.6 前端定制

### 目标与规范依据

本 change 将 AICOConfig icon 字段的合法来源从 "base64-encoded strings" 扩展为四种格式：裸 base64、`data:` URI、绝对 `http(s)://` URL、相对路径。

本 Function 的目标 Requirements（canonical spec：`aico-config-contract`）：

- `MODIFIED`：`AICOConfig configuration type and field definitions`——icon 字段来源类型从 "MUST be base64-encoded strings" 扩展为四种格式。
- `MODIFIED`：`AICOConfig validation uses hand-written functions`——icon 字段校验只要求非空字符串，格式判断在渲染时由 `resolveIconSrc` 处理。

### 当前实现

`resolveIconSrc`（`frontend/agent-web/src/aico-config/iconUtils.ts`）在渲染时处理 icon 来源：

```ts
if (icon.startsWith('data:') || icon.startsWith('http')) {
  return icon;
}
return `data:image/png;base64,${icon}`;
```

只识别 `data:` URI 和 `http` 前缀，其他值一律按裸 base64 拼成 `data:image/png;base64,{value}`。宿主集成时传入的相对路径（如 `/icnassistantpluginwebsite/images/accuracy.svg`）会被当成 base64 拼成无效 data URI，图标加载必然失败并 fallback 到默认 logo。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| icon 字段接受相对路径（以 `/`、`./`、`../` 开头） | `resolveIconSrc` 不识别相对路径前缀，一律按 base64 处理 | 相对路径被拼成无效 `data:image/png;base64,/path/...` |
| icon 字段格式判断在渲染时处理 | 校验层已只要求非空字符串，格式判断在 `resolveIconSrc` | 校验层无 GAP；渲染层缺少相对路径分支 |

### 修改方案

在 `resolveIconSrc` 的 `data:` / `http` 前缀判断中，新增 `/`、`./`、`../` 前缀判断，命中时原样返回由浏览器解析：

```ts
if (
  icon.startsWith('data:') ||
  icon.startsWith('http') ||
  icon.startsWith('/') ||
  icon.startsWith('./') ||
  icon.startsWith('../')
) {
  return icon;
}
return `data:image/png;base64,${icon}`;
```

- **owner**：`frontend/agent-web`（`agent-web` module）
- **不修改的边界**：校验层逻辑不变（icon 只要求非空字符串）；`useIconWithFallback` 的 error fallback 机制不变；其他 AICOConfig 字段不受影响。
- **失败路径**：相对路径资源不存在时，浏览器 `<img>` 触发 `onerror`，`useIconWithFallback` 的 `onError` 回调 fallback 到默认 logo 并 `console.warn`。
- **验证关注点**：`resolveIconSrc` 对四种格式各返回正确值；裸 base64 仍正确拼接；空值仍返回 fallback。

### 质量属性影响

无新增黑盒质量目标。icon 来源格式扩展是功能性需求，不影响安全、性能/容量、可靠性/恢复、可维护性、可测试性或审计/可追溯性的黑盒契约。相对路径由浏览器在宿主页面 origin 内解析，不引入新的安全边界。

## 长期基线刷新计划

- **stable spec**：`openspec/specs/aico-config-contract/spec.md`——合并 icon 字段来源类型和校验规则的修改。
- **Function**：`openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.6-前端定制.md`——规格表补充 icon 来源格式规格项。
- **Feature**：无（用户价值、黑盒边界、Function 组成或用户可依赖质量保证无变化）。
- **overview**：无（不影响稳定基线描述）。
- **architecture**：无（不涉及跨模块架构变更）。
- **modules**：无（`agent-web` module 的 icon 处理职责不变，仅扩展实现）。
- **ADR**：无（决策复杂度不足以单独立 ADR）。
- **spec-to-design-map**：无（`aico-config-contract` 导航已存在）。
