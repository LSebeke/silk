import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...ts.configs.strict,
  ...svelte.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    // Core is pure: no Foundry globals (spec §2).
    files: ['src/core/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['game', 'foundry', 'Hooks', 'CONFIG', 'ui', 'canvas'].map((name) => ({
          name,
          message: 'src/core must not touch Foundry globals; inject them via the adapter.',
        })),
      ],
    },
  },
);
