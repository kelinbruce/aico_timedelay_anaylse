## ADDED Requirements

### Requirement: Markdown SHALL 只执行完整且独立的三反引号 Mermaid 代码块

Agent Web SHALL 只从这样的行识别 Mermaid：不区分大小写、由恰好三个反引号后跟 `mermaid` 构成的独立开头行（除去两侧空白），以及由恰好三个反引号构成的独立结尾行。波浪线代码块和四个及以上反引号的代码块 SHALL 保持普通 Markdown/代码内容。不完整的 Mermaid 代码块 SHALL 保持普通文本代码，且在流式输出期间 SHALL NOT 执行。

#### Scenario: 完整的 Mermaid 代码块被识别
- **WHEN** Markdown 包含一个完整、独立、以任意大小写标注 `mermaid` 的三反引号代码块
- **THEN** Agent Web SHALL 把该代码块路由到 Mermaid 渲染

#### Scenario: 其他代码块标记不是 Mermaid 执行入口
- **WHEN** Markdown 使用标注 `mermaid` 的波浪线代码块或四个及以上反引号的代码块
- **THEN** Agent Web SHALL NOT 把该代码块路由到 Mermaid 渲染

#### Scenario: 不完整的 Mermaid 代码块保持代码形态
- **WHEN** 一个流式输出的 Mermaid 代码块没有结束代码块
- **THEN** Agent Web SHALL 把它渲染为普通文本代码
- **AND** SHALL NOT 对不完整的源调用 Mermaid

### Requirement: Mermaid 渲染 SHALL 是惰性且对过期结果安全的

Agent Web SHALL 把 Mermaid 渲染推迟到图示接近 viewport 时。渲染 SHALL 在浏览器主线程上进行并带加载指示。若在较早的异步渲染仍在进行时源发生变化，较旧渲染的完成或失败 SHALL NOT 覆盖较新的源状态。

#### Scenario: 屏外图示被延迟渲染
- **GIVEN** 一个 Mermaid 代码块位于近 viewport 观察区域之外
- **WHEN** 该 Markdown turn 被渲染
- **THEN** Agent Web SHALL 推迟调用 Mermaid，直到该代码块接近 viewport

#### Scenario: 较旧的渲染结果被忽略
- **GIVEN** 一个 Mermaid 渲染仍在进行且源发生变化
- **WHEN** 较旧的渲染稍后成功或失败
- **THEN** 其结果 SHALL NOT 替换较新源的状态

### Requirement: Mermaid 失败 SHALL 是通用提示并清除过期 SVG

渲染期间，Agent Web SHALL 显示加载指示。若 Mermaid 渲染失败，它 SHALL 清除该代码块先前的任何 SVG，并在 UI 中显示当前的通用失败消息。本能力并不主张该硬编码消息已本地化。失败的图示 SHALL NOT 留下先前的图示可见，仿佛它匹配当前源。

#### Scenario: 先前成功后当前渲染失败
- **GIVEN** 一个 Mermaid 代码块先前渲染成功
- **WHEN** 其当前源的渲染失败
- **THEN** Agent Web SHALL 清除先前的 SVG
- **AND** SHALL 显示通用的 Mermaid 失败状态

### Requirement: Mermaid 尺寸变化 SHALL 通知 chat viewport 拥有者

在一个 Mermaid 图示渲染完成后，以及其渲染尺寸随后变化时，Agent Web SHALL 通知拥有它的 chat viewport，使既有的 follow-output 或阅读位置行为可以作出反应。渲染期间，文档 overflow 抑制 SHALL 在最后一个重叠渲染完成后恢复。

#### Scenario: 图示渲染通知其父级
- **WHEN** Mermaid 渲染完成或图示尺寸变化
- **THEN** Agent Web SHALL 通知父级 chat 布局

#### Scenario: 重叠渲染只恢复一次 overflow
- **GIVEN** 多个 Mermaid 渲染重叠
- **WHEN** 所有活动渲染 promise 收敛
- **THEN** Agent Web SHALL 恢复先前的文档 overflow 状态
