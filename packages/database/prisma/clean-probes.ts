/**
 * Удаление тестовых пользователей, которых заводит apps/api/scripts/smoke-auth.mjs.
 *
 * Отдельный скрипт, а не уборка внутри самой проверки: та работает только по
 * HTTP и доступа к базе не имеет, а удаления пользователя через API нет и не
 * будет — в продукте «удаление» клиента это deactivatedAt, а не DELETE.
 *
 * Запуск: pnpm db:clean-probes
 */
// Путь оканчивается на /index.js, а не на каталог: скрипт запускается
// напрямую через node с нативным срезанием типов, то есть как ES-модуль, а
// тот не умеет достраивать /index к пути каталога.
import { PrismaClient } from '../generated/client/index.js';

const prisma = new PrismaClient();

// Ровно тот префикс, который ставит smoke-auth.mjs. Шире брать нельзя:
// скрипт не должен уметь снести живую клиентскую базу.
const PROBE_EMAIL_PREFIX = 'probe-';

async function main(): Promise<void> {
  const where = { email: { startsWith: PROBE_EMAIL_PREFIX } };

  const users = await prisma.user.findMany({ where, select: { id: true } });
  const ids = users.map((user) => user.id);

  if (ids.length === 0) {
    console.log('Тестовых пользователей не найдено.');
    return;
  }

  // Порядок важен: на связях стоит onDelete: Restrict, база не даст удалить
  // пользователя, пока на него ссылаются сессии и профиль.
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  // Брони проверочных клиентов — раньше их профилей: на клиенте стоит
  // Restrict, а смоук отменяет бронь, но удалить её по HTTP не может и не
  // должен. В продукте бронь не удаляется никогда — это история платежей.
  await prisma.tableBooking.deleteMany({ where: { clientId: { in: ids } } });
  // Мероприятия, которых касались проверочные клиенты, запоминаются ДО
  // удаления их записей: после удаления связь с ними теряется, и отличить
  // заведённое смоуком занятие от живого расписания клуба будет уже нечем.
  const touchedSessions = new Set(
    (
      await prisma.trainingBooking.findMany({
        where: { clientId: { in: ids } },
        select: { sessionId: true },
      })
    ).map((booking) => booking.sessionId),
  );

  const touchedTournaments = new Set(
    (
      await prisma.tournamentRegistration.findMany({
        where: { clientId: { in: ids } },
        select: { tournamentId: true },
      })
    ).map((registration) => registration.tournamentId),
  );

  // Записи на занятия и турниры — по той же причине и тем же порядком, что и
  // брони столов: на клиенте стоит Restrict, а смоук запись отменяет, но не
  // удаляет.
  await prisma.trainingBooking.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.tournamentRegistration.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.clientProfile.deleteMany({ where: { userId: { in: ids } } });
  const removed = await prisma.user.deleteMany({ where });

  // Сами мероприятия, ради которых смоук эти записи и заводил.
  //
  // Убрать их сама проверка не может: пока на занятии висит хотя бы одна
  // запись — пусть даже отменённая, — сервер отказывает, и правильно делает.
  //
  // Удаляем только то, что стало ничьим: ни одной чужой записи и ни одного
  // окна в расписании. Занятие, которое смоук взял из живого расписания клуба,
  // под это условие не подойдёт и останется на месте.
  const sessions = await prisma.trainingSession.deleteMany({
    where: { id: { in: [...touchedSessions] }, bookings: { none: {} }, dayClosures: { none: {} } },
  });
  const tournaments = await prisma.tournament.deleteMany({
    where: {
      id: { in: [...touchedTournaments] },
      registrations: { none: {} },
      dayClosures: { none: {} },
    },
  });

  console.log(`Удалено тестовых пользователей: ${removed.count}`);
  console.log(
    `Убрано мероприятий смоука: занятий ${sessions.count}, турниров ${tournaments.count}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Уборка не выполнена:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
