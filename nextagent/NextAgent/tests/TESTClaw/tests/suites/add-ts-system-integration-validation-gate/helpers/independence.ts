const forbiddenPatterns: readonly { readonly pattern: RegExp; readonly safeReason: string }[] = [
  { pattern: /(?:^|["'])\.\.\/.*(?:packages|frontend)\/.*\/src\//m, safeReason: 'source private import' },
  { pattern: /@nextagent\/[^"'`]+\/testing\b/, safeReason: 'testing subpath import' },
  { pattern: /(?:source-|vitest-|playwright-)?results\.json/i, safeReason: 'source test report dependency' },
  { pattern: /\bpage\.route\s*\(/, safeReason: 'mock route replaces target boundary' },
  { pattern: /\b(?:test|it|describe)\.skip\s*\(/, safeReason: 'activated case is skipped' },
  { pattern: /\b(?:test|it)\.todo\s*\(/, safeReason: 'activated case is todo' },
];

export function validateIndependentTestSource(source: string): void {
  for (const forbidden of forbiddenPatterns) {
    if (forbidden.pattern.test(source)) {
      throw new Error(forbidden.safeReason);
    }
  }
}
