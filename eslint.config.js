import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', '**/build/', '**/coverage/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['apps/client/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/server/**/*.{ts,mjs}', 'packages/**/*.ts', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
)
