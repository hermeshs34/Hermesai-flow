import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'supabase/functions/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // any es necesario en código que interactúa con Supabase (tipos inferidos dinámicamente),
      // NodeConfigPanel (configs de formularios dinámicos) y handlers de eventos genéricos
      '@typescript-eslint/no-explicit-any': 'warn',
      // prefer-const se aplica automáticamente
      'prefer-const': 'error',
      // react-hooks exhaustive-deps como warning, no error (muchos casos legítimos)
      'react-hooks/exhaustive-deps': 'warn',
      // Ignorar variables con prefijo _ (parámetros stub o intencionalmente no usados)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  }
);
