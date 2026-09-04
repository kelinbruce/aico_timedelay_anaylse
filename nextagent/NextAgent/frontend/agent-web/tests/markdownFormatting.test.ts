import { describe, expect, it } from 'vitest';

import { normalizeMarkdownBlockSpacing } from '../src/features/chat/utils/markdownFormatting.ts';

describe('normalizeMarkdownBlockSpacing', () => {
  it('splits ordered list items that were concatenated into one markdown line', () => {
    const normalized = normalizeMarkdownBlockSpacing(
      '1. **Skill 未打包** - 需要通过 `package_skill.py` 打包成 `.skill` 文件才能被系统识别2. **路径问题** - 当前 skill 在 workspaces目录下',
    );

    expect(normalized).toContain('系统识别\n\n2. **路径问题**');
  });

  it('keeps dotted identifiers inside their original list item', () => {
    const source = '    - 三级无序项目 A.1.a 三级项目的续行说明';

    expect(normalizeMarkdownBlockSpacing(source)).toBe(source);
  });

  it('still splits a real ordered list marker after sentence punctuation', () => {
    expect(normalizeMarkdownBlockSpacing('问题说明。1. 第一项')).toBe('问题说明。\n\n1. 第一项');
  });

  it('normalizes Chinese ordered-list markers so markdown renders them as a list', () => {
    const normalized = normalizeMarkdownBlockSpacing('1、第一点2、第二点');

    expect(normalized).toBe('1. 第一点\n\n2. 第二点');
  });

  it('repairs headings when model output omits the space after hashes', () => {
    const normalized = normalizeMarkdownBlockSpacing('##解决方案需要执行 skill打包流程：');

    expect(normalized).toBe('## 解决方案需要执行 skill打包流程：');
  });

  it('expands compact backend tool-list markdown before section headings', () => {
    const normalized = normalizeMarkdownBlockSpacing(
      '特定用户的接入轨迹（漫游路径）||`query_user_metric`|查询实体对象指标的聚合统计值||`query_user_metrics_trend`|查询用户KPI指标时间序列趋势|---###📌典型应用场景-用户网络不好、上不了网、频繁掉线-查询用户基本信息/移动路径/指标趋势',
    );

    expect(normalized).toContain('特定用户的接入轨迹（漫游路径）\n\n| 工具 | 描述 |');
    expect(normalized).toContain('| `query_user_metric` | 查询实体对象指标的聚合统计值 |');
    expect(normalized).toContain('| `query_user_metrics_trend` | 查询用户KPI指标时间序列趋势 |');
    expect(normalized).toContain('\n\n---\n\n### 📌典型应用场景\n\n- 用户网络不好、上不了网、频繁掉线');
    expect(normalized).toContain('\n\n- 查询用户基本信息/移动路径/指标趋势');
  });

  it('keeps malformed fenced code blocks from swallowing following prose', () => {
    const normalized = normalizeMarkdownBlockSpacing(
      [
        '```bash# 进入 skill-creator目录cd scripts/',
        '',
        '#打包 skillpython package_skill.py ../skills/user_troubleshooting```',
        '',
        '或者你可以告诉我：**需要我帮你打包吗？**',
      ].join('\n'),
    );

    expect(normalized).toContain('```bash\n# 进入 skill-creator目录cd scripts/');
    expect(normalized).toContain('#打包 skillpython package_skill.py ../skills/user_troubleshooting\n```');
    expect(normalized).toContain('\n\n或者你可以告诉我');
  });

  it('collapses whitespace inside ** bold markers so the user-reported ** xx** format renders as bold', () => {
    expect(normalizeMarkdownBlockSpacing('** xx**')).toBe('**xx**');
    expect(normalizeMarkdownBlockSpacing('** xx **')).toBe('**xx**');
    expect(normalizeMarkdownBlockSpacing('**xx **')).toBe('**xx**');
    expect(normalizeMarkdownBlockSpacing('** 中文**')).toBe('**中文**');
    expect(normalizeMarkdownBlockSpacing('这是 ** xx** 加粗')).toBe('这是 **xx** 加粗');
    expect(normalizeMarkdownBlockSpacing('项目。 ** 中文 ** 测试')).toBe('项目。 **中文** 测试');
  });

  it('preserves whitespace between two separate bold markers', () => {
    expect(normalizeMarkdownBlockSpacing('**foo** and ** bar**')).toBe('**foo** and **bar**');
    expect(normalizeMarkdownBlockSpacing('**xx**yy**zz**')).toBe('**xx**yy**zz**');
  });

  it('keeps internal whitespace inside a bold marker intact', () => {
    expect(normalizeMarkdownBlockSpacing('text **foo bar** end')).toBe('text **foo bar** end');
    expect(normalizeMarkdownBlockSpacing('text **bold 中文 text** end')).toBe('text **bold 中文 text** end');
  });

  it('does not touch well-formed bold markers', () => {
    expect(normalizeMarkdownBlockSpacing('**xx**')).toBe('**xx**');
    expect(normalizeMarkdownBlockSpacing('text **bold** end')).toBe('text **bold** end');
    expect(normalizeMarkdownBlockSpacing('**foo bar baz**')).toBe('**foo bar baz**');
  });

  it('does not split underscore identifiers like SMF_001、AMF_002 across list items', () => {
    const source = '1. 网元 / 设备名称（例如：SMF_001、AMF_002）\n2. 指标名称（例如：PFCP 会话更新）';

    expect(normalizeMarkdownBlockSpacing(source)).toBe(source);
  });

  it('does not split alphanumeric identifiers glued to digits inside a list item', () => {
    const source = '1. 设备 V2.0 协议版本';

    expect(normalizeMarkdownBlockSpacing(source)).toBe(source);
  });
});
