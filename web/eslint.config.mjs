import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Páginas en desarrollo locales (gitignored): no las lintamos.
  {
    ignores: ['src/app/community/**', 'src/app/profile/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // El codebase usa `any` en sitios que parsean payloads dinámicos del
      // backend (gráficos, eventos del timeline). Tiparlos correctamente
      // es trabajo separado; lo dejamos como warning para que se vea pero
      // no bloquee el lint check.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Algunos return-with-side-effects (toasts, logs condicionales) son
      // intencionales; downgradeo a warning.
      '@typescript-eslint/no-unused-expressions': 'warn',
    },
  },
];

export default eslintConfig;
