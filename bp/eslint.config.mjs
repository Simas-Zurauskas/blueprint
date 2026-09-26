// typescript-eslint recommendedTypeChecked + the eng-rulebook-lean base fragment (tooling §3.2), inlined for the same
// reason tsconfig.json copies its floor: this repo is cloned without the rulebook skill beside it.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'test/private/**', 'eslint.config.mjs', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, minimumDescriptionLength: 10 },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
    },
  },
  // The CLI entry point is the one module that writes to stdout/stderr (correctness §8.1's boot override).
  { files: ['src/cli.ts', 'src/bin.ts'], rules: { 'no-console': 'off' } },
  { files: ['test/**/*.ts'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
);
