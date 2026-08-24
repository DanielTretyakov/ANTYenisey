import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Пакеты workspace лежат в репозитории как TypeScript-исходники, а не
  // собранные артефакты, — Next должен пропустить их через свой компилятор.
  transpilePackages: ['@yenisey/types'],
};

export default config;
