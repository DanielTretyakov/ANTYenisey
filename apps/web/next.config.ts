import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Каталог сборки. По умолчанию `.next`, как у всех, но переопределяемый:
  // `next build` и `next dev` пишут в одно место, и сборка, запущенная при
  // работающем dev-сервере, затирает его чанки — тот потом сыплет сотнями
  // «Cannot find module './855.js'» и выглядит как сломанный код.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Пакеты workspace лежат в репозитории как TypeScript-исходники, а не
  // собранные артефакты, — Next должен пропустить их через свой компилятор.
  transpilePackages: ['@yenisey/types'],
};

export default config;
