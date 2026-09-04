import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['**/*.{ts,tsx}'];

/*
 * Local implementation of react/jsx-no-useless-fragment. eslint-plugin-react
 * does not yet support ESLint 10, so the rule is defined here instead of
 * adding an incompatible dependency. Semantics match the upstream rule:
 * report fragments (implicit or Fragment/React.Fragment without a key) that
 * contain fewer than two meaningful children. Whitespace-only text and empty
 * JSX expressions do not count as children.
 */
const jsxNoUselessFragment = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      uselessFragment: "Fragments should contain more than one child - otherwise, there's no need for a Fragment at all.",
    },
  },
  create(context) {
    const isFragmentName = (name) => {
      if (name.type === 'JSXIdentifier') {
        return name.name === 'Fragment';
      }
      if (name.type === 'JSXMemberExpression') {
        return name.object.type === 'JSXIdentifier' && name.object.name === 'React' && name.property.name === 'Fragment';
      }
      return false;
    };
    const meaningfulChildCount = (children) =>
      children.filter((child) => {
        if (child.type === 'JSXText') {
          return child.value.trim().length > 0;
        }
        if (child.type === 'JSXExpressionContainer') {
          return child.expression !== null && child.expression !== undefined;
        }
        return true;
      }).length;
    return {
      JSXFragment(node) {
        if (meaningfulChildCount(node.children) < 2) {
          context.report({ node, messageId: 'uselessFragment' });
        }
      },
      JSXElement(node) {
        if (!isFragmentName(node.openingElement.name)) {
          return;
        }
        const attributes = node.openingElement.attributes;
        if (attributes.some((attribute) => attribute.type === 'JSXAttribute' || attribute.type === 'JSXSpreadAttribute')) {
          return;
        }
        if (meaningfulChildCount(node.children) < 2) {
          context.report({ node: node.openingElement.name, messageId: 'uselessFragment' });
        }
      },
    };
  },
};
const typedTypescriptFiles = ['packages/*/src/**/*.ts', 'src/**/*.ts', 'frontend/agent-web/src/**/*.{ts,tsx}'];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/test-output/**',
      '**/web-dist/**',
      '.agents/**',
      '.codex/**',
      'docs/**',
      'openspec/**',
      'skills/**',
      'workspaces/**',
      'tests/fixtures/**',
      'tests/TESTClaw/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...eslint.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
  {
    files: typescriptFiles,
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'prefer-const': 'off',
      // clean-code standardization rules (see task): #6 no-multi-spaces, #5 array-type, #8 interface, #3 method-signature-style
      // Note: #2 curly is re-enabled after the prettier entry below.
      // Note: property-style method signatures make parameters contravariant;
      // implementations and mocks must use precise contract parameter types.
      'no-multi-spaces': ['error', { ignoreEOLComments: true }],
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      'consistent-return': 'error',
      '@typescript-eslint/method-signature-style': ['error', 'property'],
    },
  },
  {
    files: typedTypescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-floating-promises': [
        'warn',
        {
          ignoreIIFE: true,
          ignoreVoid: true,
        },
      ],
      '@typescript-eslint/no-misused-promises': [
        'warn',
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
    },
  },
  {
    files: ['**/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['frontend/agent-web/scripts/collect-live-envelope-performance.cjs', 'frontend/agent-web/tests/e2e/**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { nextagent: { rules: { 'jsx-no-useless-fragment': jsxNoUselessFragment } } },
    rules: { 'nextagent/jsx-no-useless-fragment': 'error' },
  },
  prettier,
  {
    files: typescriptFiles,
    rules: {
      // eslint-config-prettier disables curly; Prettier preserves brace presence
      // instead of deciding it, so re-enable curly after the prettier entry.
      curly: ['error', 'all'],
      // eslint-config-prettier also disables quotes, and Prettier only normalizes
      // quotes on files it formats. Enforce single quotes here so prettier-ignored
      // files (for example .d.ts) stay covered. avoidEscape and template allowance
      // keep this rule consistent with Prettier's singleQuote option.
      quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    },
  },
);
