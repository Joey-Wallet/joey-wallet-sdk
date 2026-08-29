import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      /**
       * The published surface is consumed by dapps in TypeScript editors, so an
       * `any` that escapes into a `.d.ts` becomes their problem, not ours.
       */
      '@typescript-eslint/no-explicit-any': 'error',
      'no-undef': 'off',
    },
  },
  {
    /**
     * `gemwallet-compat` re-declares GemWallet's own exported type names, and
     * several of them are envelopes with no members of their own. A migrating
     * dapp that annotates its code with `GetAddressResponse` must keep
     * compiling after it changes the import, so those names have to exist as
     * declarations with those exact shapes. Collapsing them to type aliases to
     * satisfy a style rule would mean rewriting a compatibility surface whose
     * entire job is to match another library one-for-one.
     */
    files: ['packages/gemwallet-compat/src/types.ts'],
    rules: { '@typescript-eslint/no-empty-object-type': 'off' },
  },
  {
    files: ['**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
]
