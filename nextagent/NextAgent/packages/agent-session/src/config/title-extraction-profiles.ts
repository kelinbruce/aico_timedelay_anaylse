/**
 * Title extraction language profiles configuration
 *
 * This file defines the polite prefixes and suffixes for different languages.
 * Modify these lists to customize title extraction behavior without changing core logic.
 */

export interface LanguageProfile {
  readonly prefixes: readonly string[];
  readonly suffixes: readonly string[];
}

/**
 * Chinese language profile
 * Includes common polite prefixes and suffixes in Chinese
 */
export const chineseProfile: LanguageProfile = {
  prefixes: [
    // Polite request prefixes (sorted by length, longest first for matching)
    '我想请问',
    '我想知道',
    '可以帮我',
    '能不能',
    '我想问',
    '请帮我',
    '帮我查询',
    '帮我分析',
    '麻烦你',
    '能否',
    '帮我查',
    '请问',
    '你好',
    '您好',
    '劳驾',
    '请你',
    '麻烦',
    '帮我',
    '帮忙',
    '能帮我',
  ],
  suffixes: [
    // Polite suffixes
    '麻烦你了',
    '谢谢啦',
    '麻烦了',
    '拜托了',
    '辛苦了',
    '谢谢',
    '感谢',
    '多谢',
    '拜托',
  ],
};

/**
 * English language profile
 * Includes common polite prefixes and suffixes in English
 */
export const englishProfile: LanguageProfile = {
  prefixes: [
    // Polite request prefixes (sorted by length, longest first for matching)
    'Could you please',
    'Can you please',
    'Please help me',
    "I'd like to",
    'I want to',
    'Would you',
    'Could you',
    'Can you',
    'Please',
    'Help me',
  ],
  suffixes: [
    // Polite suffixes
    'I appreciate it',
    'thanks a lot',
    'thank you',
    'thanks',
    'please',
  ],
};

/**
 * Get all available language profiles
 * Add new profiles here to support additional languages
 */
export const languageProfiles = {
  chinese: chineseProfile,
  english: englishProfile,
} as const;

export type LanguageProfileName = keyof typeof languageProfiles;
