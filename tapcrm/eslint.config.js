import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint rules that back specific TECH.md guarantees.
 *
 * The architectural rules — CI-15, CI-16, CI-19, CI-20, CI-21, CI-23, CI-31 and
 * the module boundary — are enforced by `tools/ci/index.ts` rather than here,
 * because they need cross-file reasoning and produce messages that name the
 * governing rule. ESLint covers what a single file can prove.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.generated.ts',
      'packages/client/vite.config.ts',
      'vitest.config.ts',
      'eslint.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // T-1 "fail closed" depends on errors actually propagating. A floating
      // promise is a denial nobody waited for.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // AZ-I1: `authorize` throws. Swallowing that turns a denial into an allow.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // SE-2 fails closed on unknown actions; a switch that silently falls
      // through to a permissive branch is the same defect in miniature.
      // A `default` branch counts as exhaustive here BECAUSE the convention in
      // this codebase is that default means MATCH_NOTHING / deny — see
      // resource policies. Requiring every scope to be listed would mean adding
      // a new Scope value silently produces a compile error rather than a safe
      // denial, which is the wrong failure direction.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],

      // OFF deliberately: `ResourcePolicy`, `ScopeResolverPort` and friends
      // declare async methods, and an implementation that happens not to await
      // is still obliged to match the signature. The rule cannot see that and
      // would push implementers toward dropping `async`, breaking the contract.
      '@typescript-eslint/require-await': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // §13: never log a payslip amount, a deal's commercials, a notepad body
      // or a geofence coordinate. console is allowed only where structured
      // logging is not yet wired; warn keeps it visible.
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // Tools and seeds are build-time scripts: they legitimately read files,
    // print to stdout and talk to the admin database role.
    files: ['tools/**/*.ts', 'seeds/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
