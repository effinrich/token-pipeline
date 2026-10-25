import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    // The generated contract file carries two compile-time assertions whose
    // values are never read at runtime. That is the point of them, so the
    // unused-variable rule must not fire on a machine-written file.
    files: ['**/tokens.generated.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              // An application may use libraries.
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            {
              // A library may use libraries, but never an application.
              sourceTag: 'type:lib',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            {
              // Nothing in the token pipeline may reach outside the token
              // pipeline. This is the rule that keeps the DevKit and the
              // Figma tooling out of product code.
              sourceTag: 'scope:tokens',
              onlyDependOnLibsWithTags: ['scope:tokens'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.json'],
    // Override or add rules here
    rules: {},
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
