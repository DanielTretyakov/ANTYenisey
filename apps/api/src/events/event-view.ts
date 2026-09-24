import { BookingStatus } from '@yenisey/database';
import type { ClubEvent, ClubRef, EventDetail, EventPlace } from '@yenisey/types';
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

/** Что нужно от турнира, чтобы показать его строкой. */
export const TOURNAMENT_EVENT_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  tournamentTypeId: true,
  tournamentType: { select: { name: true, ratingLabel: true, price: true } },
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
  trainingType: { select: { name: true, price: true } },
  coach: { select: { membership: { select: { user: { select: { fullName: true } } } } } },
  bookings: {
    where: { status: BookingStatus.BOOKED },
    select: { clientId: true, client: PARTICIPANT_SELECT },
  },
} as const;

type Participant = { clientId: string; client: { membership: { user: { fullName: string } } } };

type TournamentRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  tournamentType: { name: string; ratingLabel: string | null; price: number };
  registrations: Participant[];
};

type TrainingRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  trainingType: { name: string; price: number };
  coach: { membership: { user: { fullName: string } } };
  bookings: Participant[];
};

export function tournamentEvent(row: TournamentRow, userId: string | null): ClubEvent {
  return {
    id: row.id,
    kind: 'TOURNAMENT',
    title: row.tournamentType.name,
    ratingLabel: row.tournamentType.ratingLabel,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    subtitle: null,
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
    title: row.trainingType.name,
    // Число-ограничение по рейтингу — свойство турнира, у занятия его нет.
    ratingLabel: null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    subtitle: `Тренер: ${shortName(row.coach.membership.user.fullName)}`,
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
        hall: { select: { name: true, address: true, city: { select: { name: true } } } },
      },
    },
  },
  orderBy: { startMinute: 'asc' },
  take: 1,
} as const;

const CLUB_REF_SELECT = { select: { slug: true, name: true, accentColor: true } } as const;

export const TOURNAMENT_DETAIL_SELECT = {
  ...TOURNAMENT_EVENT_SELECT,
  tournamentType: { select: { name: true, ratingLabel: true, price: true, description: true } },
  registrations: {
    where: { status: BookingStatus.BOOKED },
    select: { clientId: true, client: DETAIL_PARTICIPANT_SELECT },
  },
  dayClosures: PLACE_SELECT,
  tenant: CLUB_REF_SELECT,
} as const;

export const TRAINING_DETAIL_SELECT = {
  ...TRAINING_EVENT_SELECT,
  trainingType: { select: { name: true, price: true, description: true } },
  coach: { select: { userId: true, membership: { select: { user: { select: { fullName: true } } } } } },
  bookings: {
    where: { status: BookingStatus.BOOKED },
    select: { clientId: true, client: DETAIL_PARTICIPANT_SELECT },
  },
  dayClosures: PLACE_SELECT,
  tenant: CLUB_REF_SELECT,
} as const;

type DetailParticipant = {
  clientId: string;
  client: {
    membership: {
      user: {
        id: string;
        fullName: string;
        birthDate: Date;
        playerProfile: { avatarFileId: string | null } | null;
      };
    };
  };
};

type PlaceRow = {
  table: { hall: { name: string; address: string | null; city: { name: string } | null } };
};

type DetailExtras = { dayClosures: PlaceRow[]; tenant: ClubRef };

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
    club: row.tenant,
    description: row.tournamentType.description,
    place: placeOf(row.dayClosures),
    coach: null,
    people: peopleOf(row.registrations, today),
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
    club: row.tenant,
    description: row.trainingType.description,
    place: placeOf(row.dayClosures),
    coach: { id: row.coach.userId, name: shortName(row.coach.membership.user.fullName) },
    people: peopleOf(row.bookings, today),
  };
}

function placeOf(rows: PlaceRow[]): EventPlace | null {
  const hall = rows[0]?.table.hall;

  return hall ? { hallName: hall.name, city: hall.city?.name ?? null, address: hall.address } : null;
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
        },
        today,
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
