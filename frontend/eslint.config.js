import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  { files: ['scripts/**/*.mjs', '*.config.{js,ts}'], languageOptions: { globals: globals.node } },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Labels are associated through <Field> (htmlFor via context), which the rule can't see.
      'jsx-a11y/label-has-associated-control': 'off',
      'no-restricted-syntax': [
        'error',
        {
          // Design system: semantic tokens only (bg-background, text-muted-foreground, …).
          selector:
            'Literal[value=/\\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d/]',
          message: 'Use a design token class (see DESIGN_SYSTEM.md), not a palette color.',
        },
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'No raw hex colors in components; add a token in src/styles/app.css.',
        },
      ],
    },
  },
);
