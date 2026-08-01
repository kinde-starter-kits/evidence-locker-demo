import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Root ESLint flat config for the whole monorepo. Runs as `eslint .` from the root.
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'vendor/**',
      // Generated Convex bindings are committed but not linted — they carry their own style.
      'apps/web/convex/_generated/**',
      'apps/web/next-env.d.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      // Underscore-prefixed args/vars are intentional placeholders (matches tsc).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  }
);
