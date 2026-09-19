'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClubPerson,
  DeskBooking,
  DeskDay,
  DeskEvent,
  DeskTableNow,
  Hall,
  Role,
} from '@yenisey/types';
import { AdminShell } from '@/components/layout/AdminShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { BookingDialog } from './BookingDialog';
import { MarkedBlock } from './MarkedBlock';
import { NewClientDialog } from './NewClientDialog';
import { PendingBlock } from './PendingBlock';
import { VisitDialog } from './VisitDialog';
import { inputClassName } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { pendingCounts } from '@/lib/attendance';
import { formatDate, formatMinute, todayIn } from '@/lib/bookingGrid';
import { cn } from '@/lib/cn';
import { roleInClub } from '@/lib/membership';
import { formatKopecks } from '@/lib/money';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

const MANAGERS: Role[] = ['ADMIN', 'OWNER'];

/**
 * Экран смены — главная страница администратора клуба.
 *
 * Отвечает на вопрос, который администратору задают чаще всех остальных
 * вместе взятых: что сейчас происходит в зале. Раньше такого экрана не было
 * вовсе — администратор попадал на клиентскую страницу клуба и видел то же,
 * что посетитель.
 *
 * Порядок разделов — не хронологический, и это осознанно. Сверху стоит то, что
 * требует действия руками (неотмеченное присутствие), потом состояние зала
 * прямо сейчас, потом лента будущего и в конце — уже отмеченное. Хронология
 * здесь проиграла бы задаче: неотмеченное вчера важнее, чем занятие через три
 * часа.
 *
 * Каждая запись стоит ровно в одном месте: не началась — в ленте, началась и
 * не отмечена — в «Требует отметки», отмечена — в «Отмечено в этот день».
 * Одна запись в двух списках читалась бы как две.
 *
 * Адрес `/desk`, а не `/today`: экран показывает не только сегодня — вечером
 * смотрят завтра, в понедельник разбирают субботу, — и `today` начал бы врать
 * на первом же перещёлке даты.
 */
export default function DeskPage() {
  const session = useSession();
  const router = useRouter();
  const slug = useClubSlug();
  const club = useClubApi();

  const role = session.status === 'ready' ? roleInClub(session.user, slug) : null;
  const allowed = role !== null && MANAGERS.includes(role);

  const [halls, setHalls] = useState<Hall[] | null>(null);
  const [hallId, setHallId] = useState('');
  const [date, setDate] = useState('');
  const [day, setDay] = useState<DeskDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seating, setSeating] = useState(false);
  const [visiting, setVisiting] = useState(false);
  const [newClient, setNewClient] = useState(false);
  /** Кого вносить визитом — заполняется после привязки новичка «с порога». */
  const [visitFor, setVisitFor] = useState<ClubPerson | null>(null);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  useEffect(() => {
    if (!allowed) return;

    club
      .halls()
      .then((loaded) => {
        setHalls(loaded);
        setHallId((current) => current || (loaded[0]?.id ?? ''));
      })
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, [allowed, club]);

  const hall = halls?.find((item) => item.id === hallId) ?? null;

  // «Сегодня» считается по поясу ЗАЛА, а не браузера: залы одной организации
  // бывают в разных регионах, и у зала в Абакане свой день. Пока залы не
  // загружены, дата не выбирается вовсе — иначе первый же ответ сервера
  // перебросил бы администратора на другой день.
  useEffect(() => {
    if (!hall) return;

    setDate((current) => current || todayIn(hall.timezone));
  }, [hall]);

  const load = useCallback(() => {
    if (!hallId || !date) return;

    club
      .deskDay(hallId, date)
      .then((loaded) => {
        setDay(loaded);
        setError(null);
      })
      .catch((cause: unknown) => {
        setDay(null);
        setError(messageOf(cause));
      });
  }, [club, hallId, date]);

  useEffect(() => {
    // Сетка сбрасывается вместе с залом и датой: состояние прошлого зала,
    // оставшееся на экране при загрузке нового, читается как ответ сервера.
    setDay(null);
    load();
  }, [load]);

  // Экран держат открытым весь вечер: раз в минуту он перечитывается сам,
  // иначе «просрочено» и свободные столы застывали бы на моменте открытия.
  // Только при видимой вкладке — фоновая вкладка ходила бы к серверу впустую.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [load]);

  const ahead = useMemo(() => (day ? aheadOf(day) : null), [day]);
  const counts = day ? pendingCounts(day.pending) : null;

  return (
    <AdminShell>
      <header className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <h1 className="text-[1.75rem]">Смена</h1>
          <p className="mt-1.5 text-[0.9375rem] text-text-muted">
            {day ? `${day.hallName} · ${formatDate(day.date)}` : 'Загружаем зал…'}
          </p>
        </div>

        {day?.today && day.nowMinute !== null && (
          <p className="ml-auto text-[0.875rem] text-text-subtle">
            Сейчас{' '}
            <span className="font-display text-[1.375rem] text-text tabular-nums">
              {formatMinute(day.nowMinute)}
            </span>
          </p>
        )}
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <label className="contents">
          <span className="sr-only">Зал</span>
          <select
            value={hallId}
            onChange={(event) => setHallId(event.target.value)}
            className={cn(inputClassName, 'w-auto')}
          >
            {(halls ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="contents">
          <span className="sr-only">День</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={cn(inputClassName, 'w-auto')}
          />
        </label>

        {hall && date !== todayIn(hall.timezone) && (
          <button
            type="button"
            onClick={() => setDate(todayIn(hall.timezone))}
            className="rounded-control border border-border px-3.5 py-2 text-[0.875rem] text-text-muted transition-colors hover:bg-surface hover:text-text"
          >
            Сегодня
          </button>
        )}

        {day && hall && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setNewClient(true)}>
              Новый клиент
            </Button>
            <Button variant="secondary" onClick={() => setVisiting(true)}>
              Внести визит
            </Button>
            <Button onClick={() => setSeating(true)}>Посадить клиента</Button>
          </span>
        )}
      </div>

      {newClient && (
        <NewClientDialog
          onClose={() => setNewClient(false)}
          onAttached={(person) => {
            // Привязали — сразу предлагаем внести визит: человек стоит у
            // стойки, и ради этого он и подошёл.
            setNewClient(false);
            setVisitFor(person);
            setVisiting(true);
          }}
        />
      )}

      {visiting && day && (
        <VisitDialog
          day={day}
          person={visitFor}
          onClose={() => {
            setVisiting(false);
            setVisitFor(null);
          }}
          onCreated={() => {
            setVisiting(false);
            setVisitFor(null);
            load();
          }}
        />
      )}

      {seating && day && hall && (
        <BookingDialog
          day={day}
          hall={hall}
          onClose={() => setSeating(false)}
          onCreated={() => {
            setSeating(false);
            // Перечитываем день целиком, а не дописываем бронь в список: она
            // меняет и занятость столов, и загрузку по часам, и деньги дня —
            // собрать это на клиенте значило бы завести вторую правду.
            load();
          }}
        />
      )}

      {session.status === 'ready' && !allowed && (
        <Alert>Рабочее место доступно только администратору и руководству клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && !day && !error && <DaySkeleton />}

      {day && ahead && counts && (
        // grid-cols-1 — это minmax(0, 1fr): без нуля в минимуме колонка
        // растягивается по самому широкому содержимому, и график загрузки с
        // горизонтальной прокруткой раздувал весь экран на телефоне до 600px.
        <div className="grid grid-cols-1 gap-6">
          <Tiles day={day} pending={counts} />

          <PendingBlock day={day} onChanged={load} />

          {day.today && <Now day={day} />}

          <Ahead day={day} rows={ahead} onChanged={load} />

          <MarkedBlock day={day} onChanged={load} />
        </div>
      )}
    </AdminShell>
  );
}

/* ==========================================================================
   Итог дня
   ========================================================================== */

function Tiles({ day, pending }: { day: DeskDay; pending: { total: number; overdue: number } }) {
  const free = day.tables.filter((table) => table.busy === null).length;
  // Когда освободится ближайший занятый — это второй по частоте вопрос после
  // «есть свободный стол?», и ответ на него должен стоять рядом с первым.
  const busyUntil = day.tables
    .map((table) => table.busy?.untilMinute)
    .filter((minute): minute is number => minute !== undefined);

  return (
    <div className="grid gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        title="Визитов"
        value={String(day.money.count)}
        note={day.today ? 'записанные и пришедшие' : 'за этот день'}
      />

      <Tile
        title="Услуг оказано на"
        value={formatKopecks(day.money.total)}
        // Не «выручка»: платежей в системе нет, сумма сложена из копий цен на
        // момент записи. Назвать её кассой значит соврать в первой же строке.
        //
        // Продажи абонементов — рядом, а не в сумме: абонемент — предоплата
        // будущих визитов, и записи по нему в сумме дают ноль.
        note={[
          day.money.cancelled > 0
            ? `из них ${formatKopecks(day.money.cancelled)} по отменам`
            : 'по цене на момент записи',
          day.money.subscriptionSales.count > 0
            ? `абонементов продано на ${formatKopecks(day.money.subscriptionSales.amount)}`
            : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      {day.today ? (
        <Tile
          title="Свободно сейчас"
          value={`${free} из ${day.tables.length}`}
          note={
            free === day.tables.length
              ? 'зал пуст'
              : busyUntil.length > 0
                ? `ближайший освободится в ${formatMinute(Math.min(...busyUntil))}`
                : ''
          }
        />
      ) : (
        <Tile
          title="Столов в зале"
          value={String(day.tables.length)}
          note="состояние показывается только на сегодня"
        />
      )}

      <Tile
        title="Ждут отметки"
        value={String(pending.total)}
        // По всему клубу, как и сам список: вчерашнее неотмеченное важнее
        // того, в каком зале оно было.
        note={
          pending.total === 0
            ? 'всё отмечено'
            : pending.overdue > 0
              ? `из них просрочено ${pending.overdue}`
              : 'по всему клубу'
        }
        alert={pending.overdue > 0}
      />
    </div>
  );
}

function Tile({
  title,
  value,
  note,
  alert = false,
}: {
  title: string;
  value: string;
  note: string;
  alert?: boolean;
}) {
  return (
    <div className="bg-surface-raised px-5 py-4">
      <p className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">{title}</p>
      <p
        className={cn(
          'mt-1.5 font-display text-[1.625rem] leading-tight tabular-nums',
          alert && 'text-warning',
        )}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-[0.8125rem] text-text-muted">{note}</p>}
    </div>
  );
}

/* ==========================================================================
   Сейчас
   ========================================================================== */

function Now({ day }: { day: DeskDay }) {
  return (
    <Card>
      <CardHeader
        title="Сейчас"
        description="Состояние зала на текущий момент. Закрытое расписанием время администратор занять всё равно может — жизнь в зале сложнее расписания."
      />
      <CardBody>
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {day.tables.map((table) => (
            <li key={table.tableId}>
              <TableChip table={table} />
            </li>
          ))}
        </ul>

        <Load day={day} />
      </CardBody>
    </Card>
  );
}

function TableChip({ table }: { table: DeskTableNow }) {
  const busy = table.busy;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-control border px-3 py-2.5',
        busy ? 'border-border-accent bg-surface-accent-soft' : 'border-border bg-surface-raised',
      )}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px] bg-accent"
        />
      )}

      <p className={cn('text-[0.8125rem] font-semibold', busy && 'text-text-accent')}>
        {table.label}
      </p>

      <p className="truncate text-[0.8125rem] text-text-muted">
        {busy ? (busy.person ?? PURPOSE[busy.purpose]) : 'свободен'}
      </p>

      <p className="text-[0.75rem] text-text-subtle tabular-nums">
        {busy
          ? `${PURPOSE[busy.purpose]} · до ${formatMinute(busy.untilMinute)}`
          : table.nextFromMinute === null
            ? 'до конца дня'
            : `занят с ${formatMinute(table.nextFromMinute)}`}
      </p>
    </div>
  );
}

/**
 * Загрузка столов по часам.
 *
 * Клетки, а не сплошной столбик. Вопрос, который админ задаёт этому графику, —
 * «сколько столов занято», и по высоте закрашенного прямоугольника он не
 * читается: надо прикинуть долю от максимума, а максимум нарисован не везде.
 * Клетки пересчитываются глазами и отвечают точно. Столбик при этом всегда
 * одной высоты — по числу столов зала, — поэтому виден не только занятый зал,
 * но и запас.
 *
 * Один визуальный канал на одну величину. Заливка значит «занято» и ничего
 * больше: прежняя версия красила прошедшие часы серым, и в том же канале
 * оказались две разные вещи — сколько столов и когда это было. Текущий час
 * помечен чертой под колонкой, вне клеток.
 */
function Load({ day }: { day: DeskDay }) {
  const total = Math.max(day.tables.length, 1);
  const nowHour = day.nowMinute === null ? null : Math.floor(day.nowMinute / 60);

  // Сверху вниз: N, N-1, … 1. Клетка «занята», если её номер не больше числа
  // занятых столов, то есть стопка заполняется снизу.
  const levels = Array.from({ length: total }, (_, index) => total - index);
  const peak = day.load.reduce((most, hour) => Math.max(most, hour.busyTables), 0);
  const peakHour = day.load.find((hour) => hour.busyTables === peak);

  return (
    <div className="mt-6">
      <p className="text-[0.875rem] font-medium text-text-muted">Загрузка столов по часам</p>

      <div className="mt-2 overflow-x-auto">
        <div
          className="flex min-w-[34rem] gap-1"
          role="img"
          aria-label={
            peak === 0
              ? 'За этот день зал не занимали ни разу'
              : `Пик загрузки: ${peak} из ${total} столов в ${formatMinute((peakHour?.hour ?? 0) * 60)}`
          }
        >
          {/* Шкала. Пересчёт клеток остаётся основным способом чтения, числа
              нужны на больших залах, где считать десять клеток уже долго. */}
          <div className="flex shrink-0 flex-col gap-[2px] pr-1.5" aria-hidden="true">
            {levels.map((level) => (
              <span
                key={level}
                className="h-3 text-right text-[0.6875rem] leading-3 text-text-subtle tabular-nums"
              >
                {level}
              </span>
            ))}
          </div>

          {day.load.map((hour) => (
            <div
              key={hour.hour}
              title={`${formatMinute(hour.hour * 60)} — занято столов: ${hour.busyTables} из ${total}`}
              className={cn(
                'flex flex-1 flex-col gap-[2px] border-b-2 pb-1',
                hour.hour === nowHour ? 'border-accent' : 'border-transparent',
              )}
            >
              {levels.map((level) => (
                <span
                  key={level}
                  className={cn(
                    'h-3 rounded-[2px] border',
                    level <= hour.busyTables
                      ? 'border-accent bg-accent'
                      : 'border-border bg-transparent',
                  )}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="mt-1 flex min-w-[34rem] gap-1" aria-hidden="true">
          {/* Пустышка под шкалой: подписи часов обязаны стоять ровно под своими
              колонками, а колонки сдвинуты вправо на ширину шкалы. */}
          <div className="shrink-0 pr-1.5">
            <span className="block text-[0.6875rem] tabular-nums opacity-0">{total}</span>
          </div>

          {day.load.map((hour) => (
            <span
              key={hour.hour}
              className={cn(
                'flex-1 text-center text-[0.6875rem] tabular-nums',
                hour.hour === nowHour ? 'font-semibold text-text-accent' : 'text-text-subtle',
              )}
            >
              {hour.hour % 2 === 0 || hour.hour === nowHour ? hour.hour : ''}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[0.8125rem] text-text-subtle">
        Клетка — стол, столбик — час. Стол считается занятым в часе, если занят хотя бы часть
        часа: получасовая бронь в 19:30 делает девятнадцатый час занятым.
      </p>
    </div>
  );
}

/* ==========================================================================
   Лента дня
   ========================================================================== */

function Ahead({
  day,
  rows,
  onChanged,
}: {
  day: DeskDay;
  rows: Row[];
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader
        title={day.today ? 'Дальше сегодня' : 'В этот день'}
        description="Телефон стоит прямо в строке: чтобы позвонить, не нужно открывать карточку."
      />

      {rows.length === 0 ? (
        <CardBody>
          <p className="text-[0.9375rem] text-text-muted">
            {day.today
              ? 'До конца дня в этом зале больше ничего не начнётся.'
              : day.date < todayIn(day.timezone)
                ? 'Всё, что было в этот день, — в отметках ниже.'
                : 'В этот день зал свободен.'}
          </p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3.5">
              <When at={row.at} note={row.note} />
              <RowBody row={row} />
              <span className="text-[0.875rem] whitespace-nowrap text-text-muted tabular-nums">
                {formatKopecks(row.price)}
              </span>
              {row.bookingId && <CancelBooking id={row.bookingId} onDone={onChanged} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Отмена брони администратором.
 *
 * Два шага, а не один: отмена списывает с человека деньги по политике клуба, и
 * случайное нажатие в ленте из двадцати строк обошлось бы клубу дороже, чем
 * лишний вопрос. Второй шаг заодно предлагает простить списание — «стол
 * сломался» в политику отмены не заложено, и без этой кнопки администратору
 * осталось бы звонить в бухгалтерию.
 */
function CancelBooking({ id, onDone }: { id: string; onDone: () => void }) {
  const club = useClubApi();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);

  async function cancel(waiveCharge: boolean): Promise<void> {
    setPending(true);

    try {
      await club.cancelDeskBooking(id, { waiveCharge });
      onDone();
    } finally {
      setPending(false);
      setAsking(false);
    }
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="text-[0.8125rem] text-text-subtle underline underline-offset-2 hover:text-danger"
      >
        Отменить
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
      <span className="text-text-muted">Списать по политике клуба?</span>
      <Button size="sm" variant="danger" pending={pending} onClick={() => void cancel(false)}>
        Да, отменить
      </Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => void cancel(true)}>
        Без списания
      </Button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="text-text-subtle underline underline-offset-2 hover:text-text"
      >
        не надо
      </button>
    </span>
  );
}

function When({ at, note }: { at: string; note: string }) {
  return (
    <span className="grid min-w-[4.5rem] tabular-nums">
      <span className="font-display text-[1.0625rem] leading-tight">{clock(at)}</span>
      <span className="text-[0.75rem] text-text-subtle">{note}</span>
    </span>
  );
}

function RowBody({ row }: { row: Row }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-[0.9375rem]">{row.title}</span>
      <span className="mt-0.5 block truncate text-[0.8125rem] text-text-muted">{row.subtitle}</span>
    </span>
  );
}

function DaySkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <div className="grid gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile} className="bg-surface-raised px-5 py-4">
            <span className="block h-2.5 w-24 rounded-full bg-border/60" />
            <span className="mt-3 block h-6 w-16 rounded-full bg-border/50" />
            <span className="mt-2 block h-2.5 w-32 rounded-full bg-border/40" />
          </div>
        ))}
      </div>

      <div className="h-64 rounded-card border border-border bg-surface-raised" />
    </div>
  );
}

/* ==========================================================================
   Сборка ленты
   ========================================================================== */

/** Строка ленты: и бронь, и мероприятие сведены к одному виду ради показа. */
interface Row {
  key: string;
  /** Момент начала в ISO — по нему строка и сортируется. */
  at: string;
  /** Подпись под часами: чем занято. */
  note: string;
  title: string;
  subtitle: string;
  price: number;
  /**
   * Идентификатор брони, если строка — аренда стола.
   *
   * У занятия и турнира его нет: отменить их целиком — не то же самое, что
   * отменить одну бронь, и делается это в расписании зала.
   */
  bookingId?: string;
}

const PURPOSE: Record<string, string> = {
  RENT: 'аренда',
  ROBOT: 'робот',
  SPARRING: 'спарринг',
  TRAINING: 'тренировка',
  TOURNAMENT: 'турнир',
  OTHER: 'занято',
};

/**
 * Лента дня — то, что ещё не началось.
 *
 * Начавшееся уходит в «Требует отметки», отмеченное — в «Отмечено в этот
 * день». Фазу считает сервер: по часам браузера бронь могла бы казаться
 * начавшейся, когда отменить её сервер ещё позволит, — и наоборот.
 */
function aheadOf(day: DeskDay): Row[] {
  const rows: Row[] = [
    // Отменённые в ленте не показываются: они не занимают стол и никого не
    // ждут. В деньгах дня они при этом учтены — там своя правда.
    ...day.bookings
      .filter((booking) => booking.status !== 'CANCELLED' && booking.phase === 'UPCOMING')
      .map(bookingRow),
    // Мероприятия вне сетки не видны ни в одном зале, кроме как здесь.
    ...[...day.events, ...day.unplaced]
      .filter((event) => event.phase === 'UPCOMING')
      .map(eventRow),
  ];

  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

function bookingRow(booking: DeskBooking): Row {
  return {
    key: `booking-${booking.id}`,
    bookingId: booking.id,
    at: booking.startsAt,
    note: booking.sparring ? 'спарринг' : booking.withRobot ? 'робот' : 'аренда',
    title: `${booking.client.fullName} · ${booking.tableLabel}`,
    subtitle: [
      booking.client.phone,
      duration(booking.startsAt, booking.endsAt),
      // «Завёл админ» объясняет, почему человек не видел эту бронь в
      // приложении и почему о переносе он позвонит в клуб.
      booking.manual ? 'завёл админ' : '',
    ]
      .filter(Boolean)
      .join(' · '),
    price: booking.price,
  };
}

function eventRow(event: DeskEvent): Row {
  const booked = event.participants.filter((entry) => entry.status === 'BOOKED').length;

  return {
    key: `event-${event.id}`,
    at: event.startsAt,
    note: event.kind === 'TRAINING' ? 'занятие' : 'турнир',
    title: [event.title, event.coachName].filter(Boolean).join(' · '),
    subtitle:
      event.capacity === null
        ? `записались ${booked}`
        : `записались ${booked} из ${event.capacity}`,
    price: event.price,
  };
}

/** «18:30» из момента. Часовой пояс — браузера: администратор в своём зале. */
function clock(at: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(at),
  );
}

function duration(startsAt: string, endsAt: string): string {
  const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return [hours > 0 ? `${hours} ч` : '', rest > 0 ? `${rest} мин` : ''].filter(Boolean).join(' ');
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером';
}
