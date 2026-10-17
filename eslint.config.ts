import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    name: 'app/ignores',
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'server-dist/**', 'dist-self-hosted/**'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  pluginVue.configs['flat/recommended'],
  {
    name: 'app/typescript',
    files: ['**/*.{ts,mts,vue}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'vue/multi-word-component-names': 'off',
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      'vue/component-api-style': ['error', ['script-setup']],
    },
  },
  {
    name: 'app/config-files',
    files: ['*.config.ts', 'scripts/**/*.ts', 'server/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
