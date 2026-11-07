/** Публикация новости выпуска без рассылки. Повторный запуск не создаёт дубль. */
import { PrismaClient } from '@yenisey/database';
import { MOBILE_DESK_NEWS } from './release-news.ts';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Автор — существующий действующий владелец платформы. Учётки и права
  // скрипт не создаёт и не меняет; они остаются такими же, как в редакторе.
  const owner = await prisma.user.findFirst({
    where: { platformRole: 'OWNER', deactivatedAt: null, anonymizedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) throw new Error('Нет действующего владельца платформы — автор новости не определён');

  const existing = await prisma.platformNews.findFirst({
    where: { OR: [{ id: MOBILE_DESK_NEWS.id }, { title: MOBILE_DESK_NEWS.title }] },
    select: { id: true, publishedAt: true },
  });
  const { id, ...content } = MOBILE_DESK_NEWS;
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ dryRun: true, ...content, path: `/news/${existing?.id ?? id}` }));
    return;
  }
  const news = await prisma.platformNews.upsert({
    where: { id: existing?.id ?? id },
    create: { id, ...content, authorId: owner.id, publishedAt: new Date() },
    update: { ...content, publishedAt: existing?.publishedAt ?? new Date() },
    select: { id: true, title: true, publishedAt: true },
  });
  console.log(JSON.stringify({ ...news, path: `/news/${news.id}` }));
}

main().catch((error: unknown) => {
  console.error('Новость не опубликована:', error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
