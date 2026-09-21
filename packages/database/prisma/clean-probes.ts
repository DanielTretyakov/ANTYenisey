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

// Те же префиксы, что ставит smoke-auth.mjs залам и столам проверки. Шире
// брать нельзя по той же причине, что и с почтой.
const PROBE_HALL_PREFIX = 'Зал проверки ';
const PROBE_TABLE_PREFIX = 'Стол проверки ';

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: PROBE_EMAIL_PREFIX } },
    select: { id: true, createdAt: true },
  });
  const found = users.map((user) => user.id);

  // Учётки, на которые ссылается журнал абонементов, не трогаются вовсе:
  // журнал — только вставки, исключений из этого нет (см. ledgerLocked).
  const locked = await ledgerLocked(found);
  const ids = found.filter((id) => !locked.has(id));
  const where = { email: { startsWith: PROBE_EMAIL_PREFIX }, id: { in: ids } };

  /**
   * Нижняя граница «своего» — момент появления самой ранней проверочной учётки.
   *
   * Она отделяет мероприятия, которые смоук создал сам, от клубных, на которые
   * проверочный клиент всего лишь записался. Без неё условие «ни одной записи и
   * ни одного окна» их не различает: пустой демо-турнир клуба выглядит ровно
   * так же, как брошенный турнир смоука, — и уборка сносит живые данные.
   *
   * Проверено на себе: запись пробного клиента на демо-турнир «Енисея» стоила
   * этому турниру жизни.
   */
  const notOlderThan = users.reduce<Date | null>(
    (earliest, user) => (earliest === null || user.createdAt < earliest ? user.createdAt : earliest),
    null,
  );

  if (locked.size > 0) {
    console.log(
      `Оставлено учёток: ${locked.size} — на них ссылается журнал абонементов, а он только на вставку.`,
    );
  }

  if (ids.length === 0) {
    console.log('Тестовых пользователей к удалению не найдено.');
    // Залы и столы смоука убираются всё равно: они переживают уборку учёток
    // (стол с бронями удалить нельзя, пока брони не удалены), и после
    // повторного запуска остались бы висеть навсегда.
    await removeProbeRooms();
    return;
  }

  // Порядок важен: на связях стоит onDelete: Restrict, база не даст удалить
  // пользователя, пока на него ссылаются сессии и профиль.
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  // Визиты — раньше броней и записей: визит ссылается на запись, по которой
  // отмечен, и на связи стоит Restrict.
  //
  // Журнал аудита не трогается и не может быть тронут: база отклоняет любое
  // удаление из него (AuditLog_append_only). Строки об отметках пробных
  // клиентов остаются в нём ссылками на удалённые записи — это цена журнала,
  // который нельзя подчистить, и она принята намеренно. Автор этих строк —
  // учётка администратора смоука, а не пробная, поэтому удалению пробных
  // учёток журнал не мешает.
  await prisma.visitLog.deleteMany({ where: { clientId: { in: ids } } });
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

  const coached = await removeProbeCoaching(ids);

  // Абонементы — после записей (запись ссылается на абонемент своего клиента)
  // и до анкеты (абонемент ссылается на анкету).
  const subscriptions = await prisma.subscription.deleteMany({ where: { clientId: { in: ids } } });

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
    where: {
      id: { in: [...touchedSessions] },
      bookings: { none: {} },
      dayClosures: { none: {} },
      ...(notOlderThan ? { createdAt: { gte: notOlderThan } } : {}),
    },
  });
  const tournaments = await prisma.tournament.deleteMany({
    where: {
      id: { in: [...touchedTournaments] },
      registrations: { none: {} },
      dayClosures: { none: {} },
      ...(notOlderThan ? { createdAt: { gte: notOlderThan } } : {}),
    },
  });

  console.log(`Удалено тестовых пользователей: ${removed.count}`);
  console.log(
    `Убрано мероприятий смоука: занятий ${sessions.count + coached.sessions}, турниров ${tournaments.count}`,
  );
  console.log(`Убрано спаррингов пробных тренеров: ${coached.sparrings}`);
  console.log(`Убрано абонементов пробных клиентов: ${subscriptions.count}`);

  await removeProbeRooms();
}

// Префикс, который смоук ставит своим тарифам. Шире брать нельзя: скрипт не
// должен уметь снести настоящие тарифы клуба.
const PROBE_PLAN_PREFIX = 'Тариф проверки ';

/**
 * Пробные учётки, которые убрать нельзя: на них ссылается журнал абонементов.
 *
 * Журнал — только вставки, как журнал аудита: ни UPDATE, ни DELETE база не
 * принимает ни от кого и ни под каким флагом (решение владельца от 20.09.2026 —
 * прежнее исключение для уборки снято). А раз строку журнала не удалить, то и
 * запись, и абонемент, на которые она ссылается, останутся навсегда: связи
 * стоят на Restrict.
 *
 * Поэтому такие учётки не удаляются, а называются числом в отчёте — иначе
 * уборка падала бы целиком на первой же из них. Смоук со своей стороны ведёт
 * абонементы под одной и той же учёткой, так что растёт этот остаток не с
 * каждым прогоном, а один раз.
 */
async function ledgerLocked(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }

  const rows = await prisma.subscriptionLedger.findMany({
    where: {
      OR: [
        { subscription: { clientId: { in: ids } } },
        { trainingBooking: { clientId: { in: ids } } },
        // Занятие пробного тренера уборка сносит целиком, вместе с чужими
        // записями на него (removeProbeCoaching) — а строку журнала по такой
        // записи не снесёт. Значит, и тренера трогать нельзя.
        { trainingBooking: { session: { coachId: { in: ids } } } },
        { tournamentRegistration: { clientId: { in: ids } } },
      ],
    },
    select: {
      subscription: { select: { clientId: true } },
      trainingBooking: { select: { clientId: true, session: { select: { coachId: true } } } },
      tournamentRegistration: { select: { clientId: true } },
    },
  });

  const probes = new Set(ids);
  const locked = new Set<string>();

  for (const row of rows) {
    for (const id of [
      row.subscription?.clientId,
      row.trainingBooking?.clientId,
      row.trainingBooking?.session.coachId,
      row.tournamentRegistration?.clientId,
    ]) {
      if (id && probes.has(id)) {
        locked.add(id);
      }
    }
  }

  return locked;
}

/**
 * То, что пробная учётка сделала ТРЕНЕРОМ: спарринги и занятия.
 *
 * Смоук выдаёт пробным учёткам роль тренера (карточка, спарринг), а сценарии
 * расписания берут первого тренера клуба — и следующий прогон, если перед ним
 * не убирали, вешает свои занятия на пробного. Без этой уборки удаление учётки
 * упирается в `TrainingSession → CoachProfile` (Restrict), и падает вся уборка.
 *
 * Занятие, которое ведёт пробный тренер, — мусор смоука по построению: живое
 * расписание клуба пробной учёткой не заводится. Поэтому оно убирается целиком,
 * вместе с чужими записями на него, окнами расписания и визитами.
 */
async function removeProbeCoaching(ids: string[]): Promise<{ sessions: number; sparrings: number }> {
  // Спарринги — брони, где за столом сам тренер. Клиента в них нет, поэтому
  // уборка броней по clientId их не находит.
  const sparrings = await prisma.tableBooking.deleteMany({ where: { coachId: { in: ids } } });

  const sessionIds = (
    await prisma.trainingSession.findMany({ where: { coachId: { in: ids } }, select: { id: true } })
  ).map((session) => session.id);

  // Визиты ссылаются и на запись, и на тренера — оба раза с Restrict.
  await prisma.visitLog.deleteMany({
    where: { OR: [{ coachId: { in: ids } }, { trainingBooking: { sessionId: { in: sessionIds } } }] },
  });
  await prisma.trainingBooking.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.dayClosure.deleteMany({ where: { trainingSessionId: { in: sessionIds } } });
  const sessions = await prisma.trainingSession.deleteMany({ where: { id: { in: sessionIds } } });

  return { sessions: sessions.count, sparrings: sparrings.count };
}

/**
 * Залы и столы, заведённые смоуком под проверку ручной брони.
 *
 * Своя уборка внутри проверки их снять не может, и это не недоработка, а
 * правило продукта: бронь не удаляется никогда — это история платежей, — и
 * стол, за которым хоть раз кого-то посадили, остаётся неудаляемым. Смоук это
 * правило прямо проверяет и оставляет зал здесь.
 *
 * Условия сужены до предела: имя с точным префиксом смоука И ни одной
 * оставшейся брони, ни одного окна расписания. Живой зал клуба под них не
 * подойдёт, даже если кто-то назовёт его похоже.
 */
async function removeProbeRooms(): Promise<void> {
  const tables = await prisma.table.deleteMany({
    where: {
      label: { startsWith: PROBE_TABLE_PREFIX },
      bookings: { none: {} },
      closureRules: { none: {} },
      dayClosures: { none: {} },
    },
  });

  // После столов, а не до: зал со столом база удалить не даст.
  const halls = await prisma.hall.deleteMany({
    where: { name: { startsWith: PROBE_HALL_PREFIX }, tables: { none: {} } },
  });

  // Тарифы смоука — те, по которым не осталось ни одного абонемента. Связки с
  // типами уходят каскадом вместе с тарифом.
  const plans = await prisma.subscriptionPlan.deleteMany({
    where: { name: { startsWith: PROBE_PLAN_PREFIX }, subscriptions: { none: {} } },
  });

  console.log(`Убрано залов смоука: ${halls.count}, столов: ${tables.count}, тарифов: ${plans.count}`);
}

main()
  .catch((error: unknown) => {
    console.error('Уборка не выполнена:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
