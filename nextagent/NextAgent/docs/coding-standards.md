# NextAgent 编程规范

本规范只约束实现细节；行为、架构边界与验收标准分别以 OpenSpec 和 `AGENTS.md` 为准。

## 必须遵守

- 使用 strict TypeScript 与 ESM；不以 `any`、非空断言或无类型断言绕过类型检查。边界数据先经 schema 校验，再进入领域代码。
- 函数和类型名表达领域含义；布尔值以 `is`、`has`、`can` 开头。一个函数只完成一个可描述的职责，避免隐式副作用。
- 以不可变输入和显式返回值为默认。仅在对象明确归属当前实现且不跨边界共享时修改它。
- 异步 I/O 一律 `await`；慢操作传播 `AbortSignal`。不得吞掉错误、遗留未处理 Promise，或把取消转换为成功。
- 错误按边界转换为安全、稳定的领域或 transport 错误；不向调用方暴露 provider 原始错误、内部路径、凭据或附件内容。
- 日志使用结构化字段，记录可行动的事实和关联标识；除 OpenSpec 定义的本地 Tool runtime diagnostic `toolInput` / `toolOutput` 例外外，不得记录 prompt、模型输出、stream 内容、密钥、token 或高基数/敏感原文。normal 与 debug Tool runtime diagnostic 都提供原始输入和已有的有效输出，不得增加关闭该行为的配置分支；两字段仅对 credential 与认证类 token 做窄匹配脱敏，prompt、路径、命令和业务内容保真。不得因字段名含 `credential` 或 `token` 就误伤引用、状态、计数、长度或 tokenizer 诊断字段。两字段仍必须遵守集中日志 writer 的容量边界，且不得扩散到其他可观测或公共边界。
- 信任边界之外的输入均不可信。身份与 scope 只从可信边界取得；不得接受客户端、模型或 capability 参数对它们的覆盖。
- 只通过 package public exports 协作。DTO、领域对象、Record 与数据库 row 在各自边界内转换，不跨层泄漏。
- 新增或修改可观察行为时，先写能描述该行为的测试；测试断言 contract 或结果，不锁死私有实现。修复缺陷先复现，再修复。
- 保持改动小且完整：删除本次引入的未使用代码，不加入未被规格要求的抽象、开关、兼容分支或静默 fallback。

## 关键编码规则

下列规则为本仓库 TS 编码高频检视项，新增或修改代码时应即时对照。

### G.TYP.04 字符串使用单引号

风险等级：suggestion。字符串字面量使用单引号；含 HTML 的字符串可避免转义双引号。模块导入路径非字符串值，不受约束。

合规：

```ts
const msg = '<span id="test" name="test">';
```

不合规：

```ts
const msg = "<span id=\"test\" name=\"test\">";
```

### G.TYP.05 可选成员与参数不通过 undefined 定义

风险等级：suggestion（TypeScript）。定义可选成员或参数时使用 `?` 而非 `: T | undefined`；声明类型别名时不包含 `undefined`，在使用处（如返回值类型）再联合 `undefined`。本仓库开启 `exactOptionalPropertyTypes: true`，`prop?: T` 与 `prop: T | undefined` 是不同类型，需按下方例外区分。

场景1：定义可选成员或参数

合规：

```ts
interface CoffeeOrder {
  sugarCubes: number;
  milk?: Whole | LowFat | HalfHalf;
}

function pourCoffee(volume?: Milliliter) {}
```

不合规：

```ts
interface CoffeeOrder {
  sugarCubes: number;
  milk: Whole | LowFat | HalfHalf | undefined;
}

function pourCoffee(volume: Milliliter | undefined) {}
```

场景2：类型别名声明不含 undefined

合规：

```ts
type CoffeeResponse = Latte | Americano;

class CoffeeService {
  getLatte(): CoffeeResponse | undefined {}
}
```

不合规：

```ts
type CoffeeResponse = Latte | Americano | undefined;

class CoffeeService {
  getLatte(): CoffeeResponse {}
}
```

例外（`exactOptionalPropertyTypes: true` 下的强制保留）：当成员会被显式赋 `undefined`（如 holder/clear 模式：持有 Promise/AbortController/句柄后置空释放、spread-merge 用 `undefined` 覆盖旧值、依赖 `in`/`Object.keys` 判断键是否存在）时，必须保留 `: T | undefined` 形式。`prop?: T` 会禁止显式赋 `undefined`（TS2375），机械替换会破坏构建或运行时语义。参数转换为 `?:` 是安全的（仍允许显式传 `undefined`），但可选参数不得排在必选参数之前。

### G.FUN.01-TS 显式声明函数及类方法的返回值类型

风险等级：suggestion（TypeScript）。函数及类方法应显式声明返回值类型，避免依赖类型推断。公开/导出函数与类方法尤其必须显式标注，防止实现变化时返回类型静默漂移、破坏调用方。

合规：

```ts
function computeTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

class ItemRepository {
  findById(id: string): Promise<Item | undefined> {
    return this.store.get(id);
  }
}
```

不合规：

```ts
function computeTotal(items: Item[]) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

class ItemRepository {
  findById(id: string) {
    return this.store.get(id);
  }
}
```

### G.FMT.08 用空格突出关键字与重要信息

风险等级：suggestion。

- `if`/`for`/`while`/`switch` 等关键字与 `(` 间加空格；函数名与参数列表 `(` 间不加空格。
- `else`/`catch` 与其前的 `}` 间加空格；`{` 前加空格（对象作为函数首参/数组首元素、模板 `${}` 除外）。
- 二元与三元运算符两侧加空格；逗号后加空格。
- 逗号、分号前不加空格；数组 `[]` 内不加空格；不使用连续空格（复杂数据结构对齐除外）。

合规：

```ts
function good(): number {
  if (condition) {
    return x + y;
  }
  return z;
}
```

不合规：

```ts
function bad() {
  if(condition) {return x+y;}
  return z;
}
```

### G.FMT.11 使用尾逗号

风险等级：suggestion。多行对象/数组字面量最后一个元素后加尾逗号；增删元素时无需修改上一行，减少 diff 噪声。

合规：

```ts
const hero = {
  firstName: 'Dana',
  lastName: 'Scully',
};

const heroes = [
  'Batman',
  'Superman',
];
```

不合规：

```ts
const heroes = [
  'Batman',
  'Superman'
];
```

### G.MET.07 使用一致的 return 子句

风险等级：suggestion。函数所有路径应以一致方式返回值；避免部分路径显式 return 值、其他路径隐式返回 `undefined`，以防大型函数中的书写错误。

合规：

```ts
function resolve(value: boolean): boolean {
  if (value) {
    return true;
  }
  return false;
}
```

不合规：

```ts
function resolve(value: boolean) {
  if (value) {
    return true;
  }
  // 隐式返回 undefined
}
```

### G.OTH.03 删除无用代码而非注释掉

风险等级：minor。注释掉的代码无法维护、恢复时易引入不可检测的缺陷；死代码/不可达代码应直接删除，不要以注释形式保留。

合规：直接删除不再使用的代码。

不合规：

```ts
// mModel.reloadIcons();
// if (!mModel.isAllAppsLoaded()) {
//   function make(tag) { return element; }
// }
```

## 提交前自检

- 名称、类型和控制流是否无需额外注释即可说明意图？
- 非法输入、失败、取消和越权路径是否有明确、安全的结果？
- 新行为是否有可重复的验证，并覆盖最重要的负例？
