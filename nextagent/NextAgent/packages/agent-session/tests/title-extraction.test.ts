import { describe, it, expect } from 'vitest';
import { extractTitle, generateAutomaticTitle } from '../src/services/title-extraction.js';

describe('extractTitle', () => {
  describe('short input (< 30 chars)', () => {
    it('returns the text directly for short Chinese input', () => {
      expect(extractTitle('基站告警查询')).toBe('基站告警查询');
    });

    it('returns the text for 15-char Chinese', () => {
      expect(extractTitle('查询网元KPI指标数据')).toBe('查询网元KPI指标数据');
    });

    it('returns trimmed text', () => {
      expect(extractTitle('  网络状态  ')).toBe('网络状态');
    });

    it('returns empty for very short Chinese text (< 4 chars)', () => {
      expect(extractTitle('你好')).toBe('');
    });
  });

  describe('medium input (30-100 chars) with polite prefixes', () => {
    it('strips polite prefix from text', () => {
      const text = '请问当前基站告警情况如何，我需要查看详细的告警清单和处理建议';
      const result = extractTitle(text);
      expect(result).not.toContain('请问');
      expect(result.length).toBeGreaterThan(0);
    });

    it('strips longer prefix before shorter one', () => {
      const text = '帮我分析骨干网络延迟和丢包率的变化趋势以及核心网元异常情况分析报告';
      const result = extractTitle(text);
      expect(result).not.toContain('帮我');
      expect(result.length).toBeGreaterThan(0);
    });

    it("strips '帮我查询' prefix correctly", () => {
      const text = '帮我查询最近一周的核心网元故障记录并及时反馈处理进度情况说明';
      const result = extractTitle(text);
      expect(result).not.toContain('帮我查询');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('long input (> 100 chars)', () => {
    it('truncates to at most 100 chars and returns non-empty title', () => {
      const text =
        '请帮我分析一下当前网络中有哪些核心网元出现了异常告警，并且需要对每个告警进行详细的根因分析和影响范围评估。另外还需要提供对应的解决方案和预防措施。';
      const result = extractTitle(text);
      expect(result.length).toBeLessThanOrEqual(100);
      expect(result.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('normalization', () => {
    it('removes control characters', () => {
      expect(extractTitle('基站\u0000告警\u001F查询')).toBe('基站告警查询');
    });

    it('truncates to 40 chars maximum', () => {
      const long = '这是一个非常长的标题用于测试截断功能是否正常工作超过四十个字符限制';
      const result = extractTitle(long);
      expect(result.length).toBeLessThanOrEqual(40);
    });

    it('returns empty for < 4 chars after processing', () => {
      expect(extractTitle('ABC')).toBe('');
    });
  });

  describe('English prefix removal', () => {
    it("strips 'Could you please' prefix", () => {
      const text = 'Could you please check the network status for me';
      const result = extractTitle(text);
      expect(result).not.toContain('Could you please');
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it("strips 'Please help me' prefix", () => {
      const text = 'Please help me analyze the base station alarms';
      const result = extractTitle(text);
      expect(result).not.toContain('Please help me');
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it("strips 'I'd like to' prefix", () => {
      const text = "I'd like to check the network performance metrics";
      const result = extractTitle(text);
      expect(result).not.toContain("I'd like to");
      expect(result.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('polite suffix removal', () => {
    it("strips Chinese suffix '谢谢'", () => {
      const text = '帮我查一下当前基站的详细告警情况和处理建议，需要尽快处理谢谢';
      const result = extractTitle(text);
      expect(result).not.toContain('谢谢');
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it("strips Chinese suffix '麻烦了'", () => {
      const text = '请帮我详细分析一下当前网络延迟问题的根因和可能的解决方案麻烦了';
      const result = extractTitle(text);
      expect(result).not.toContain('麻烦了');
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it("strips English suffix 'please'", () => {
      const text = 'Check the network status please';
      const result = extractTitle(text);
      expect(result).not.toContain('please');
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it("strips English suffix 'thank you'", () => {
      const text = 'Analyze the base station alarms thank you';
      const result = extractTitle(text);
      expect(result).not.toContain('thank you');
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it('strips both prefix and suffix', () => {
      const text = '请帮我查一下当前核心网元的详细网络状态和所有告警情况，需要完整报告谢谢';
      const result = extractTitle(text);
      expect(result).not.toContain('请帮我');
      expect(result).not.toContain('谢谢');
      expect(result.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('punctuation removal', () => {
    it('removes leading and trailing periods', () => {
      const text = '...基站状态检查...';
      const result = extractTitle(text);
      expect(result).not.toMatch(/^\.\.\./);
      expect(result).not.toMatch(/\.\.\.$/);
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it('removes leading and trailing question marks', () => {
      const text = '？基站告警查询？';
      const result = extractTitle(text);
      expect(result).not.toMatch(/^？/);
      expect(result).not.toMatch(/？$/);
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it('removes leading and trailing exclamation marks', () => {
      const text = '！网络状态检查！';
      const result = extractTitle(text);
      expect(result).not.toMatch(/^！/);
      expect(result).not.toMatch(/！$/);
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it('removes mixed punctuation', () => {
      const text = '【基站告警分析】';
      const result = extractTitle(text);
      expect(result).not.toMatch(/^【/);
      expect(result).not.toMatch(/】$/);
      expect(result.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('mixed language detection', () => {
    it('applies both Chinese and English rules for mixed content', () => {
      const text = '请帮我check the current network status and alarm conditions谢谢';
      const result = extractTitle(text);
      expect(result).not.toContain('请帮我');
      expect(result).not.toContain('谢谢');
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it('detects CJK characters in mixed text', () => {
      const text = 'Could you请帮我分析一下当前核心网元的基站告警情况和网络延迟问题';
      const result = extractTitle(text);
      expect(result).not.toContain('Could you');
      expect(result).not.toContain('请帮我');
      expect(result.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('edge cases', () => {
    it('returns empty for empty string', () => {
      expect(extractTitle('')).toBe('');
    });

    it('returns empty for whitespace-only string', () => {
      expect(extractTitle('   ')).toBe('');
    });

    it('returns empty when all content is stripped by prefix', () => {
      expect(extractTitle('你好')).toBe('');
    });

    it('handles text with only punctuation', () => {
      expect(extractTitle('...')).toBe('');
      expect(extractTitle('？？？')).toBe('');
    });

    it('preserves internal punctuation', () => {
      const text = '基站告警，网络延迟';
      const result = extractTitle(text);
      expect(result).toContain('，');
    });
  });
});

describe('generateAutomaticTitle', () => {
  it('falls back to the original question when rule extraction returns empty', () => {
    expect(generateAutomaticTitle('你好')).toBe('你好');
  });

  it('falls back to non-empty punctuation input instead of dropping the title', () => {
    expect(generateAutomaticTitle('？？？')).toBe('？？？');
  });

  it('truncates original-question fallback to the generated title maximum', () => {
    const result = generateAutomaticTitle('abc'.repeat(30));
    expect(result).toHaveLength(40);
    expect(result).toBe('abcabcabcabcabcabcabcabcabcabcabcabcabca');
  });

  it('normalizes whitespace and control characters before fallback', () => {
    expect(generateAutomaticTitle('  你\u0000好   网络  ')).toBe('你好 网络');
  });
});
