# 提案：优化 Skill Body 路径泄漏检测

## 背景与问题（Why）

Skill 作者可能编写诸如 `XX/*/tmp/*` 的相对 glob 模式，来描述诊断期间应忽略的文件。当前 Skill body 泄漏检查把任何 `/tmp/` 子串都当作宿主绝对路径，并使 Skill 以 `Skill body failed safe leakage validation.` 失败。

这过于宽泛：相对 glob 示例只是普通的编写指引，不是宿主路径泄漏。框架应当继续拦截真正的宿主路径，同时允许相对路径和 glob 模式。

## 变更范围（What Changes）

细化 Skill body 宿主路径泄漏检测，使其只匹配宿主绝对路径形态，包括 Windows 盘符限定路径，以及从空白或引号等边界开始的 Unix 风格路径。

相对路径中间包含 `/tmp/` 的相对 glob 模式将被允许。使用明确占位符的凭据和授权示例（如 `${TOKEN}`、`ENV_TOKEN`、`your-token` 或 `os.environ["API_KEY"]`）也将被允许。

## 非目标（Non-Goals）

- 不放宽对高置信度具体值的凭据、授权 header、token、secret 或密码泄漏检测。
- 不在 tool 结果中暴露原始 Skill body 文本。
- 不改变 Skill 加载、ToolSearch 或资源投影行为。

## 影响范围（Impact）

记录安全相对忽略 glob 的 Skill 可以成功加载。包含真正宿主路径（如 `/tmp/private`、`/home/operator/.ssh/id_rsa` 或 `C:\Users\operator\.ssh\id_rsa`）的 Skill body 仍会安全泄漏校验失败。
