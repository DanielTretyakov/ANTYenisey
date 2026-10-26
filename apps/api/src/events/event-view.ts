import { BookingStatus, type Gender, type RatingSystem } from '@yenisey/database';
import type {
  ClientPaymentMode,
  ClubCatalogItem,
  ClubEvent,
  ClubRef,
  EventDetail,
  EventKind,
  EventPlace,
  EventRestrictions,
} from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { participantView } from '../players/player-rules';

/**
 * Мероприятие в том виде, в каком его показывают: сборка `ClubEvent` из строк
 * базы.
 *
 * Отдельным модулем, а не методами сервиса, потому что мест сборки два и они в
 * разных модулях: открытый список клуба (`EventsService`) и лента ближайшего
 * по моим клубам (`MeService`). Пока сборка была одна, дублировать было нечего;
 * с появлением занятий копий стало бы две, и разошлись бы они молча — на
 * странице клуба у занятия видны свободные места, а в ленте того же занятия
 * нет.
 *
 * Здесь же и `select` для запросов: форма выборки и форма ответа обязаны
 * меняться вместе, иначе первым признаком расхождения будет ошибка типов в
 * чужом файле.
 */

/**
 * Клиент записи в том объёме, в каком его показывают другим.
 *
 * Полное имя наружу не уходит: список записавшихся видит любой пользователь, и
 * сокращает его сервер, а не браузер.
 */
const PARTICIPANT_SELECT = {
  select: { membership: { select: { user: { select: { fullName: true } } } } },
} as const;

/**
 * Зал строки мероприятия: по первому окну расписания (связь идёт через стол), а
 * без окна — залы вида: единственный из них и есть зал. С поясом: время
 * мероприятия показывается по часам его зала (решение от 05.10.2026).
 */
export const HALL_NAME_SELECT = {
  select: { table: { select: { hall: { select: { name: true, timezone: true } } } } },
  orderBy: { startMinute: 'asc' },
  take: 1,
} as const;

export const TYPE_HALLS_SELECT = { select: { hall: { select: { name: true, timezone: true } } } } as const;

/**
 * Пояс клуба — старшего зала, как у утренних сводок (`clubTimezone`): им
 * показывается мероприятие, зал которого не определить. Берётся через вид, а
 * не через `tenant` строки: тот у ленты и списка тренера выбран под карточку
 * клуба, и второй выбор того же поля его перекрыл бы.
 */
export const CLUB_ZONE_SELECT = {
  select: { halls: { select: { timezone: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
} as const;

/**
 * Кто может записаться — у вида (решения владельца от 20.10.2026). Выбирается
 * вместе со строкой: «для кого» показывается в списке до нажатия кнопки.
 */
export const RESTRICTIONS_SELECT = { minAge: true, maxAge: true, gender: true } as const;

/** У турнира к ним — справочная планка рейтинга с системой. */
export const TOURNAMENT_RULES_SELECT = { ...RESTRICTIONS_SELECT, ratingLabel: true, ratingSystem: true } as const;

type Restricted = { minAge: number | null; maxAge: number | null; gender: Gender | null };

/** Ограничения вида строкой ответа — только три поля, без остального типа. */
export function restrictionsOf(type: Restricted): EventRestrictions {
  return { minAge: type.minAge, maxAge: type.maxAge, gender: type.gender };
}

/** Пояс, если в клубе нет ни одного зала: тот же запасной, что у сводок. */
const FALLBACK_ZONE = 'Asia/Krasnoyarsk';

/** Что нужно от турнира, чтобы показать его строкой. */
export const TOURNAMENT_EVENT_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  tournamentTypeId: true,
  tournamentType: {
    select: { name: true, ...TOURNAMENT_RULES_SELECT, price: true, halls: TYPE_HALLS_SELECT, tenant: CLUB_ZONE_SELECT },
  },
  dayClosures: HALL_NAME_SELECT,
  registrations: {
    where: { status: BookingStatus.BOOKED },
    select: { clientId: true, client: PARTICIPANT_SELECT },
  },
} as const;

/** То же для занятия. Отличий два: тренер и лимит мест. */
export const TRAINING_EVENT_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  trainingTypeId: true,
  trainingType: { select: { name: true, ...RESTRICTIONS_SELECT, price: true, halls: TYPE_HALLS_SELECT, tenant: CLUB_ZONE_SELECT } },
  dayClosures: HALL_NAME_SELECT,
  coach: { select: { membership: { select: { user: { select: { fullName: true } } } } } },
  bookings: {
    where: { status: BookingStatus.BOOKED },
    select: { clientId: true, client: PARTICIPANT_SELECT },
  },
} as const;

type Participant = { clientId: string; client: { membership: { user: { fullName: string } } } };

/** Окно расписания и залы вида — ради зала строки. */
type HallSource = {
  dayClosures: { table: { hall: { name: string; timezone: string } } }[];
};
type TypeHalls = {
  halls?: { hall: { name: string; timezone: string } }[];
  tenant?: { halls: { timezone: string }[] };
};

/**
 * Пояс мероприятия: зала его окна в сетке, иначе единственного зала вида,
 * иначе клуба. Тем же порядком, что зал строки (`hallOf`), — иначе время
 * показывалось бы по одному залу, а подпись называла другой.
 */
export function eventZone(row: HallSource, type: TypeHalls): string {
  return (
    row.dayClosures[0]?.table.hall.timezone ??
    (type.halls?.length === 1 ? type.halls[0]!.hall.timezone : undefined) ??
    type.tenant?.halls[0]?.timezone ??
    FALLBACK_ZONE
  );
}

/**
 * Зал мероприятия: окно в сетке, иначе единственный зал вида. Единственный
 * зал клуба подставляет список клуба (`EventsService`) — здесь о клубе не знают.
 */
function hallOf(row: HallSource, type: TypeHalls): string | null {
  const placed = row.dayClosures[0]?.table.hall.name;

  if (placed) return placed;

  return type.halls?.length === 1 ? type.halls[0]!.hall.name : null;
}

type TournamentRow = HallSource & {
  id: string;
  tournamentTypeId: string;
  startsAt: Date;
  endsAt: Date;
  tournamentType: { name: string; ratingLabel: string | null; ratingSystem: RatingSystem | null; price: number } & Restricted &
    TypeHalls;
  registrations: Participant[];
};

type TrainingRow = HallSource & {
  id: string;
  trainingTypeId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  trainingType: { name: string; price: number } & Restricted & TypeHalls;
  coach: { membership: { user: { fullName: string } } };
  bookings: Participant[];
};

export function tournamentEvent(row: TournamentRow, userId: string | null): ClubEvent {
  return {
    id: row.id,
    kind: 'TOURNAMENT',
    typeId: row.tournamentTypeId,
    title: row.tournamentType.name,
    ratingLabel: row.tournamentType.ratingLabel,
    ratingSystem: row.tournamentType.ratingSystem,
    restrictions: restrictionsOf(row.tournamentType),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    subtitle: null,
    hall: hallOf(row, row.tournamentType),
    timezone: eventZone(row, row.tournamentType),
    price: row.tournamentType.price,
    // Чем оплатит смотрящий, решает страница клуба — ей известен человек, за
    // которого действуют. Лента и прочие списки абонементов не касаются.
    payWith: null,
    registeredCount: row.registrations.length,
    // Лимита мест у турнира нет: в схеме он несёт только дату и тип, и ТЗ
    // ограничения не требует. Число записавшихся показывается справочно.
    capacity: null,
    freeSeats: null,
    participants: participantsOf(row.registrations),
    registered: registeredBy(userId, row.registrations),
  };
}

export function trainingEvent(row: TrainingRow, userId: string | null): ClubEvent {
  return {
    id: row.id,
    kind: 'TRAINING',
    typeId: row.trainingTypeId,
    title: row.trainingType.name,
    // Число-ограничение по рейтингу — свойство турнира, у занятия его нет.
    ratingLabel: null,
    ratingSystem: null,
    restrictions: restrictionsOf(row.trainingType),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    subtitle: `Тренер: ${shortName(row.coach.membership.user.fullName)}`,
    hall: hallOf(row, row.trainingType),
    timezone: eventZone(row, row.trainingType),
    price: row.trainingType.price,
    payWith: null,
    registeredCount: row.bookings.length,
    capacity: row.capacity,
    // Не уходит в минус: опустить лимит ниже числа записавшихся сервис не даёт,
    // но «−2 места» на странице читалось бы как поломка, а не как запрет.
    freeSeats: Math.max(row.capacity - row.bookings.length, 0),
    participants: participantsOf(row.bookings),
    registered: registeredBy(userId, row.bookings),
  };
}

/**
 * Вид мероприятия во вкладке «Мероприятия клуба»: тип и ближайшее проведение.
 * `next` — итог группировки по типу (`_min.startsAt`, `_count`); у типа без
 * проведений впереди его нет.
 */
export function catalogItem(
  kind: EventKind,
  type: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    ratingLabel?: string | null;
    ratingSystem?: RatingSystem | null;
    halls: { hallId: string }[];
  } & Restricted,
  next: { startsAt: Date | null; count: number } | undefined,
  /** Пояс ближайшего проведения — его время показывается по часам его зала. */
  nextZone: string | null = null,
): ClubCatalogItem {
  return {
    kind,
    typeId: type.id,
    name: type.name,
    description: type.description,
    price: type.price,
    ratingLabel: type.ratingLabel ?? null,
    ratingSystem: type.ratingSystem ?? null,
    restrictions: restrictionsOf(type),
    nextStartsAt: next?.startsAt?.toISOString() ?? null,
    nextTimezone: next?.startsAt ? nextZone : null,
    upcomingCount: next?.count ?? 0,
    hallIds: type.halls.map((link) => link.hallId),
  };
}

/** Записавшиеся в формате «Фамилия И.» — как требует ТЗ. */
function participantsOf(rows: Participant[]): string[] {
  return rows
    .map((row) => shortName(row.client.membership.user.fullName))
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

/**
 * Записан ли спрашивающий.
 *
 * `null` для анонима, а не `false`: список открыт без входа, и отвечать «не
 * записан» тому, кто просто не представился, значило бы показать ему кнопку
 * записи, ведущую на форму входа.
 */
function registeredBy(userId: string | null, rows: { clientId: string }[]): boolean | null {
  return userId ? rows.some((row) => row.clientId === userId) : null;
}

// ---------------------------------------------------------------------------
// Окно мероприятия
// ---------------------------------------------------------------------------

/**
 * Записавшийся для окна: кроме имени — дата рождения (решает, раскрывать ли
 * его) и аватар. Полное имя уходит из выборки только сокращённым.
 */
const DETAIL_PARTICIPANT_SELECT = {
  select: {
    membership: {
      select: {
        user: {
          select: {
            id: true,
            fullName: true,
            birthDate: true,
            gender: true,
            playerProfile: { select: { avatarFileId: true } },
          },
        },
      },
    },
  },
} as const;

/**
 * Зал мероприятия. Прямой связи «мероприятие → зал» в схеме нет: она идёт
 * через окно расписания, а оно — через стол. Окон у занятия бывает несколько
 * (на каждый стол), зал у них один — берётся первое.
 */
const PLACE_SELECT = {
  select: {
    table: {
      select: {
        hall: {
          select: { name: true, timezone: true, address: true, phone: true, city: { select: { name: true } } },
        },
      },
    },
  },
  orderBy: { startMinute: 'asc' },
  take: 1,
} as const;

/** Клуб окна мероприятия: ссылка на страницу и как он берёт деньги. */
const DETAIL_CLUB_SELECT = { select: { slug: true, name: true, accentColor: true, paymentMode: true } } as const;

export const TOURNAMENT_DETAIL_SELECT = {
  ...TOURNAMENT_EVENT_SELECT,
  tournamentType: {
    select: {
      name: true,
      ...TOURNAMENT_RULES_SELECT,
      price: true,
      description: true,
      halls: TYPE_HALLS_SELECT,
      tenant: CLUB_ZONE_SELECT,
    },
  },
  registrations: {
    where: { status: BookingStatus.BOOKED },
    select: { clientId: true, client: DETAIL_PARTICIPANT_SELECT },
  },
  dayClosures: PLACE_SELECT,
  tenant: DETAIL_CLUB_SELECT,
  cancelReason: true,
} as const;

export const TRAINING_DETAIL_SELECT = {
  ...TRAINING_EVENT_SELECT,
  trainingType: {
    select: { name: true, ...RESTRICTIONS_SELECT, price: true, description: true, halls: TYPE_HALLS_SELECT, tenant: CLUB_ZONE_SELECT },
  },
  coach: { select: { userId: true, membership: { select: { user: { select: { fullName: true } } } } } },
  bookings: {
    where: { status: BookingStatus.BOOKED },
    select: { clientId: true, client: DETAIL_PARTICIPANT_SELECT },
  },
  dayClosures: PLACE_SELECT,
  tenant: DETAIL_CLUB_SELECT,
  cancelReason: true,
} as const;

type DetailParticipant = {
  clientId: string;
  client: {
    membership: {
      user: {
        id: string;
        fullName: string;
        birthDate: Date;
        gender: Gender | null;
        playerProfile: { avatarFileId: string | null } | null;
      };
    };
  };
};

type PlaceRow = {
  table: {
    hall: { name: string; timezone: string; address: string | null; phone: string | null; city: { name: string } | null };
  };
};

type DetailExtras = {
  dayClosures: PlaceRow[];
  tenant: ClubRef & { paymentMode: ClientPaymentMode };
  cancelReason: string | null;
};

export function tournamentDetail(
  row: TournamentRow &
    DetailExtras & {
      tournamentType: { description: string | null };
      registrations: DetailParticipant[];
    },
  userId: string | null,
  today: Date,
): EventDetail {
  return {
    ...tournamentEvent(row, userId),
    club: clubRef(row.tenant),
    description: row.tournamentType.description,
    place: placeOf(row.dayClosures),
    coach: null,
    people: peopleOf(row.registrations, today),
    cancelReason: row.cancelReason,
    paymentMode: row.tenant.paymentMode,
  };
}

export function trainingDetail(
  row: TrainingRow &
    DetailExtras & {
      trainingType: { description: string | null };
      coach: { userId: string };
      bookings: DetailParticipant[];
    },
  userId: string | null,
  today: Date,
): EventDetail {
  return {
    ...trainingEvent(row, userId),
    club: clubRef(row.tenant),
    description: row.trainingType.description,
    place: placeOf(row.dayClosures),
    coach: { id: row.coach.userId, name: shortName(row.coach.membership.user.fullName) },
    people: peopleOf(row.bookings, today),
    cancelReason: row.cancelReason,
    paymentMode: row.tenant.paymentMode,
  };
}

/** Ссылка на клуб — без лишнего: способ оплаты идёт своим полем. */
function clubRef({ slug, name, accentColor }: ClubRef): ClubRef {
  return { slug, name, accentColor };
}

function placeOf(rows: PlaceRow[]): EventPlace | null {
  const hall = rows[0]?.table.hall;

  return hall
    ? { hallName: hall.name, city: hall.city?.name ?? null, address: hall.address, phone: hall.phone }
    : null;
}

/** Те же люди, что в `participants`, и в том же порядке — но кружками. */
function peopleOf(rows: DetailParticipant[], today: Date): EventDetail['people'] {
  return rows
    .map(({ client }) =>
      participantView(
        {
          userId: client.membership.user.id,
          name: shortName(client.membership.user.fullName),
          birthDate: client.membership.user.birthDate,
          avatarFileId: client.membership.user.playerProfile?.avatarFileId ?? null,
          gender: client.membership.user.gender,
        },
        today,
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
