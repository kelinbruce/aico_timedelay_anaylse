import { chineseProfile, englishProfile } from '../config/title-extraction-profiles.js';

/**
 * 截断启发式阈值
 *
 * 当在 maxChars 范围内找不到词边界时，至少要在 maxChars * TRUNCATION_FALLBACK_THRESHOLD
 * 位置之后才考虑使用词边界截断，否则直接硬截断到 maxChars。
 *
 * 理由：避免在文本开头截断导致标题过短。
 */
const TRUNCATION_FALLBACK_THRESHOLD = 0.5;
const GENERATED_TITLE_MAX_CHARS = 40;

/**
 * 中英文混合语言检测阈值
 *
 * 当文本包含 CJK 字符且 Latin 字符占比超过此阈值时，
 * 同时应用中英文前后缀规则。
 */
const LATIN_MIXED_THRESHOLD = 0.2;

interface LanguageProfile {
  readonly prefixes: readonly string[];
  readonly suffixes: readonly string[];
}

export function extractTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return '';
  }
  return normalizeTitle(extractCore(trimmed));
}

export function generateAutomaticTitle(text: string): string {
  const extracted = extractTitle(text);
  if (extracted.length > 0) {
    return extracted;
  }
  return fallbackToOriginalQuestion(text);
}

function extractCore(text: string): string {
  if (text.length < 30) {
    return text.trim();
  }
  const cleaned = removePoliteAffixes(text.trim());
  if (text.length > 100) {
    return truncateAtSentenceBoundary(cleaned, 100);
  }
  return extractFirstSentence(cleaned).trim();
}

function detectLanguage(text: string): LanguageProfile[] {
  const cjkRegex = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;
  const cjkMatches = text.match(cjkRegex) ?? [];
  const hasCjk = cjkMatches.length > 0;

  const latinRegex = /[A-Za-z]/g;
  const latinMatches = text.match(latinRegex) ?? [];
  const latinRatio = text.length > 0 ? latinMatches.length / text.length : 0;

  if (hasCjk) {
    const profiles = [chineseProfile];
    if (latinRatio > LATIN_MIXED_THRESHOLD) {
      profiles.push(englishProfile);
    }
    return profiles;
  }

  return [englishProfile];
}

function normalizeTitle(text: string): string {
  let normalized = text.trim().replace(/[\u0000-\u001F\u007F-\u009F]/gu, '');
  normalized = normalized.replace(/\s+/gu, ' ').trim();
  normalized = stripLeadingTrailingPunctuation(normalized);
  if (normalized.length < 4) {
    return '';
  }
  if (normalized.length > GENERATED_TITLE_MAX_CHARS) {
    normalized = truncateAtCharBoundary(normalized, GENERATED_TITLE_MAX_CHARS);
  }
  return normalized;
}

function fallbackToOriginalQuestion(text: string): string {
  let normalized = text.trim().replace(/[\u0000-\u001F\u007F-\u009F]/gu, '');
  normalized = normalized.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) {
    return '';
  }
  return truncateAtCharBoundary(normalized, GENERATED_TITLE_MAX_CHARS);
}

function stripLeadingTrailingPunctuation(text: string): string {
  // 中英文标点：顿号、逗号、句号、问号、感叹号、分号、冒号、省略号、
  // 破折号、括号、引号等对标题无信息增益的标点（含全角）
  const punctuationPattern =
    /^[\s.,;:!?…—()\[\]{}<>"'`""''《》【】「」『』（）\uFF01\uFF1F\u3002\uFF0C\uFF1B\uFF1A\u3001\-]+|[\s.,;:!?…—()\[\]{}<>"'`""''《》【】「」『』（）\uFF01\uFF1F\u3002\uFF0C\uFF1B\uFF1A\u3001\-]+$/gu;
  return text.replace(punctuationPattern, '').trim();
}

function removePoliteAffixes(text: string): string {
  const profiles = detectLanguage(text);
  let cleaned = text;

  // Repeatedly remove prefixes until no more matches
  let prefixChanged = true;
  while (prefixChanged) {
    prefixChanged = false;
    for (const profile of profiles) {
      const sortedPrefixes = [...profile.prefixes].sort((a, b) => b.length - a.length);
      for (const prefix of sortedPrefixes) {
        const lowerCleaned = cleaned.toLowerCase();
        const lowerPrefix = prefix.toLowerCase();
        if (lowerCleaned.startsWith(lowerPrefix)) {
          cleaned = cleaned.slice(prefix.length).trim();
          prefixChanged = true;
          break;
        }
      }
      if (prefixChanged) {
        break;
      }
    }
  }

  // Repeatedly remove suffixes until no more matches
  let suffixChanged = true;
  while (suffixChanged) {
    suffixChanged = false;
    for (const profile of profiles) {
      const sortedSuffixes = [...profile.suffixes].sort((a, b) => b.length - a.length);
      for (const suffix of sortedSuffixes) {
        const lowerCleaned = cleaned.toLowerCase();
        const lowerSuffix = suffix.toLowerCase();
        if (lowerCleaned.endsWith(lowerSuffix)) {
          cleaned = cleaned.slice(0, -suffix.length).trim();
          suffixChanged = true;
          break;
        }
      }
      if (suffixChanged) {
        break;
      }
    }
  }

  return cleaned;
}

function extractFirstSentence(text: string): string {
  const sentenceEnd = findSentenceEnd(text);
  if (sentenceEnd === -1) {
    return text.trim();
  }
  return text.slice(0, sentenceEnd + 1).trim();
}

function findSentenceEnd(text: string): number {
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (
      (ch === '.' || ch === '!' || ch === '?' || ch === '\u3002' || ch === '\uFF1F' || ch === '\uFF01') &&
      (index + 1 >= text.length || text[index + 1] !== '.')
    ) {
      return index;
    }
    if (ch === '\n') {
      // Return the character before the newline (or 0 if at start) to capture
      // the sentence before the line break without including the newline itself.
      return index - 1 >= 0 ? index - 1 : 0;
    }
    if (ch === '\uFF0C' || ch === '\u3001' || ch === ',') {
      index += 1;
      continue;
    }
    index += 1;
  }
  return -1;
}

function truncateAtSentenceBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text.trim();
  }
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');
  const lastChinesePunct = Math.max(truncated.lastIndexOf('\u3002'), truncated.lastIndexOf('\uFF0C'), truncated.lastIndexOf('\u3001'));
  const cutPoint = Math.max(lastSpace, lastChinesePunct);
  if (cutPoint > maxChars * TRUNCATION_FALLBACK_THRESHOLD) {
    return truncated.slice(0, cutPoint).trim();
  }
  return truncated.trim();
}

function truncateAtCharBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxChars * TRUNCATION_FALLBACK_THRESHOLD) {
    return truncated.slice(0, lastSpace).trim();
  }
  return truncated.trim();
}
