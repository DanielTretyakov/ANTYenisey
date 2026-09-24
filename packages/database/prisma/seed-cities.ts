/**
 * Справочник городов РФ: заливка из `prisma/data/cities-ru.json`.
 *
 * Отдельным скриптом, а не только частью сида: на стенде полный сид гонять
 * незачем (он заводит демо-клуб), а справочник нужен и там —
 * `pnpm db:seed-cities`. Основной сид зовёт эту же функцию.
 *
 * Идемпотентно и без потерь:
 *  - город, который уже есть с тем же регионом, получает только население;
 *  - город, заведённый прежним сидом без региона («Новосибирск», null),
 *    получает регион в ТОЙ ЖЕ строке — на неё уже ссылаются клубы и залы, и
 *    вторая строка «Новосибирск, Новосибирская область» разделила бы поиск
 *    по городу надвое;
 *  - прочие заводятся одной вставкой.
 * Удаления нет: город, пропавший из справочника, может быть городом клуба.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '../generated/client/index.js';

interface CityRow {
  name: string;
  region: string | null;
  population: number | null;
}

export async function seedCities(prisma: PrismaClient): Promise<{ created: number; updated: number }> {
  const file = dataFile();
  const { cities } = JSON.parse(readFileSync(file, 'utf8')) as { cities: CityRow[] };

  const existing = await prisma.city.findMany({ select: { id: true, name: true, region: true, population: true } });
  const byKey = new Map(existing.map((row) => [keyOf(row.name, row.region), row]));
  // Строки прежнего сида без региона — кандидаты на дописывание региона.
  const regionless = new Map(existing.filter((row) => row.region === null).map((row) => [row.name, row]));

  const fresh: CityRow[] = [];
  let updated = 0;

  for (const city of cities) {
    const same = byKey.get(keyOf(city.name, city.region));

    if (same) {
      if (same.population !== city.population) {
        await prisma.city.update({ where: { id: same.id }, data: { population: city.population } });
        updated += 1;
      }
      continue;
    }

    const legacy = city.region !== null ? regionless.get(city.name) : undefined;

    if (legacy) {
      // Одна строка без региона — на один город справочника: второй
      // одноимённый («Железногорск» курский) заводится отдельно.
      regionless.delete(city.name);
      await prisma.city.update({
        where: { id: legacy.id },
        data: { region: city.region, population: city.population },
      });
      updated += 1;
      continue;
    }

    fresh.push(city);
  }

  // skipDuplicates — на случай параллельного прогона: уникальность пары
  // (название, регион) держит база.
  const { count } = await prisma.city.createMany({ data: fresh, skipDuplicates: true });

  return { created: count, updated };
}

/**
 * Где лежит справочник. От каталога запуска, а не от самого файла: скрипт
 * идёт через node со срезанием типов как ES-модуль, `__dirname` там нет, а
 * `import.meta` не пропускает проверка типов пакета (он собран под CommonJS).
 * Скрипты пакета запускаются из `packages/database`, корень репозитория —
 * запасной вариант.
 */
function dataFile(): string {
  const candidates = [
    join(process.cwd(), 'prisma', 'data', 'cities-ru.json'),
    join(process.cwd(), 'packages', 'database', 'prisma', 'data', 'cities-ru.json'),
  ];
  const found = candidates.find((path) => existsSync(path));

  if (!found) {
    throw new Error(`Справочник городов не найден: ${candidates.join(', ')}`);
  }

  return found;
}

function keyOf(name: string, region: string | null): string {
  return `${name}\u0000${region ?? ''}`;
}

// Запуск самим скриптом: `pnpm db:seed-cities`.
if (process.argv[1]?.endsWith('seed-cities.ts')) {
  void (async () => {
    const { PrismaClient: Client } = await import('../generated/client/index.js');
    const prisma = new Client();

    try {
      const result = await seedCities(prisma);
      console.log(`Города: заведено ${result.created}, обновлено ${result.updated}`);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
