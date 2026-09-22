import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  // Сборка, которая умеет запускаться сама: Next кладёт в `.next/standalone`
  // сервер вместе с теми файлами node_modules, до которых действительно
  // дотягивается код. Образу тогда не нужен ни pnpm, ни весь монорепозиторий —
  // это разница между сотнями мегабайт и гигабайтом.
  //
  // Включается только переменной, и это не осторожность, а необходимость: в
  // pnpm-монорепозитории Next собирает standalone симлинками, а Windows их
  // создавать без особых прав не даёт — обычный `pnpm build` на рабочей машине
  // падал бы с EPERM. Переменную ставит Dockerfile, где сборка идёт под Linux.
  output: process.env.NEXT_STANDALONE === 'on' ? 'standalone' : undefined,
  // Корень, от которого Next считает файлы для standalone. Без него он берёт
  // каталог приложения и не находит пакеты workspace: в pnpm они лежат
  // симлинками в общий store двумя уровнями выше.
  outputFileTracingRoot: join(here, '../../'),
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
