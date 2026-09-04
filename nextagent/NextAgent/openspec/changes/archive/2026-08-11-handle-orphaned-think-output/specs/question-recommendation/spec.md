## Function

- **所属 Function**：`FN-1.20 查看推荐问题`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Recommendation Output Cleaning

Port MUST 在解析前清洗模型原始输出，并按以下顺序处理异常格式：

1. 对完整的 `<think>...</think>` 标签对，系统 MUST 删除标签及其内部内容。
2. 对没有对应 `</think>` 的 `<think>`，系统 MUST 删除该开启标签及其后的全部内容。
3. 完整标签对和未闭合开启标签清洗后，如果剩余内容包含一个或多个孤立 `</think>`，系统 MUST 以最后一个孤立闭合标签为边界，删除该标签及其之前的全部内容，只保留标签之后的内容。匹配 MUST 不区分标签大小写。
4. 系统 MUST 删除 Markdown 代码围栏标记行，包括带语言标记的围栏行。
5. 系统 MUST 过滤以“以下是”“下面是”“推荐”或“建议”开头的叙述性段落。
6. 系统 MUST 删除候选问题段首的 Markdown 标题标记。

系统 MUST 过滤清洗后为空的字符串段。清洗后不存在有效内容时，Port MUST 返回 `{ questions: [] }`。系统 MUST NOT 把孤立 `</think>` 之前无法与最终答案可靠区分的内容投影为推荐问题。

**需求类别**：功能性需求

#### Scenario: 完整 think 推理块后包含问题
- **WHEN** 模型输出为 `<think>推理过程</think>\n\n问题1\n\n问题2\n\n问题3`
- **THEN** Port MUST 返回问题1、问题2和问题3，并且结果 MUST NOT 包含推理内容

#### Scenario: 未闭合 think 开启标签
- **WHEN** 模型输出为 `<think>被截断的推理过程`，且不存在闭合标签
- **THEN** Port MUST 返回 `{ questions: [] }`

#### Scenario: 开启标签缺失且推理位于孤立闭合标签之前
- **WHEN** 模型输出为 `裸露推理过程\n</think>\n问题1\n问题2\n问题3`
- **THEN** Port MUST 返回问题1、问题2和问题3，并且结果 MUST NOT 包含裸露推理过程

#### Scenario: 存在多个孤立闭合标签
- **WHEN** 模型输出包含多个没有对应开启标签的 `</think>`，且最后一个孤立闭合标签之后包含三个问题
- **THEN** Port MUST 只解析最后一个孤立闭合标签之后的三个问题

#### Scenario: 孤立闭合标签之后没有有效问题
- **WHEN** 模型输出仅包含裸露推理过程和孤立 `</think>`，标签之后为空白
- **THEN** Port MUST 返回 `{ questions: [] }`

#### Scenario: 孤立闭合标签大小写混合
- **WHEN** 模型输出包含 `</THINK>`，其前方是裸露推理过程且后方包含三个问题
- **THEN** Port MUST 返回标签之后的三个问题，并且结果 MUST NOT 包含裸露推理过程

#### Scenario: Markdown 和叙述性文本清洗
- **WHEN** 模型输出的问题被 Markdown 代码围栏、标题标记或叙述性段落包围
- **THEN** Port MUST 删除这些格式内容并返回清洗后的问题文本

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在生成推荐问题后先清洗思考标签异常；孤立闭合标签之前的内容不作为推荐问题，之后再执行既有格式清洗和问题解析。
- **依据 Requirements**：`Recommendation Output Cleaning`

### 结果

- **变更类型**：修改
- **目标内容**：存在缺失开启标签的思考输出时，系统只返回最后一个孤立闭合标签之后的有效推荐问题；其后没有有效问题时返回空列表。
- **依据 Requirements**：`Recommendation Output Cleaning`
