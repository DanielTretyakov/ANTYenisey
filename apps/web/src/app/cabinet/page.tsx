'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { BookingStatus, ClientBooking, PublicUser, Role } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { formatKopecks } from '@/lib/money';
import { useSession } from '@/lib/useSession';

const ROLE_LABELS: Record<Role, string> = {
  CLIENT: 'Клиент',
  COACH: 'Тренер',
  ADMIN: 'Администратор',
  OWNER: 'Руководство клуба',
};

export default function CabinetPage() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  const user = session.status === 'ready' ? session.user : null;

  return (
    <AppShell>
      <h1 className="mb-7 text-[1.75rem]">Личный кабинет</h1>

      {user ? <Profile user={user} /> : <ProfileSkeleton />}

      {user?.role === 'CLIENT' && <Bookings />}
    </AppShell>
  );
}

function Profile({ user }: { user: PublicUser }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Профиль" description="Данные, которые видит администратор клуба." />
      <CardBody>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Row label="ФИО" value={user.fullName} />
          <Row label="Электронная почта" value={user.email} />
          <Row label="Телефон" value={user.phone ?? '—'} />
          <Row label="Роль" value={ROLE_LABELS[user.role]} />
        </dl>
      </CardBody>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">{label}</dt>
      <dd className="mt-1 text-[0.9375rem] text-text">{value}</dd>
    </div>
  );
}

/**
 * Заглушка на время загрузки профиля.
 *
 * Серые полосы вместо надписи «Загружаю…»: они занимают ровно то место, куда
 * встанут данные, и карточка не подпрыгивает в момент ответа сервера.
 */
function ProfileSkeleton() {
  return (
    <Card className="max-w-2xl" aria-busy="true">
      <CardHeader title="Профиль" description="Загружаю данные…" />
      <CardBody>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <div className="h-2.5 w-24 rounded-full bg-border" />
              <div className="mt-2.5 h-3.5 w-40 rounded-full bg-border" />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Брони клиента.
 *
 * Показаны все, включая отменённые и прошедшие: клиент приходит сюда и чтобы
 * вспомнить, когда идти, и чтобы понять, сколько с него списали за отмену, —
 * прятать вторую половину значило бы отвечать только на первый вопрос.
 */
function Bookings() {
  const [bookings, setBookings] = useState<ClientBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    api
      .myBookings()
      .then(setBookings)
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, []);

  async function handleCancel(booking: ClientBooking): Promise<void> {
    setCancelling(booking.id);
    setError(null);

    try {
      const cancelled = await api.cancelBooking(booking.id);

      setBookings((current) =>
        (current ?? []).map((item) => (item.id === cancelled.id ? cancelled : item)),
      );
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      setCancelling(null);
    }
  }

  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader title="Брони столов" description="Аренда, которую вы оформили сами." />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {bookings === null && <p className="text-[0.875rem] text-text-muted">Загружаю…</p>}

        {bookings?.length === 0 && (
          <p className="text-[0.875rem] text-text-muted">
            Броней пока нет.{' '}
            <Link href="/booking" className="text-text-accent underline-offset-2 hover:underline">
              Забронировать стол
            </Link>
          </p>
        )}

        {bookings && bookings.length > 0 && (
          <ul className="divide-y divide-border">
            {bookings.map((booking) => (
              <li key={booking.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                <div className="min-w-0 grow">
                  <p className="text-[0.9375rem] text-text">
                    {formatSpan(booking.startsAt, booking.endsAt)}
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] text-text-muted">
                    {booking.hallName}, {booking.tableLabel}
                    {booking.withRobot && ' · с роботом'} · {formatKopecks(booking.price)}
                  </p>
                </div>

                <StatusBadge booking={booking} />

                {booking.status === 'BOOKED' && (
                  <Button
                    variant="danger"
                    size="sm"
                    pending={cancelling === booking.id}
                    onClick={() => void handleCancel(booking)}
                  >
                    Отменить
                    {booking.cancelChargePercentNow
                      ? ` (спишется ${booking.cancelChargePercentNow}%)`
                      : ''}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

const STATUS_LABELS: Record<BookingStatus, string> = {
  BOOKED: 'Активна',
  CANCELLED: 'Отменена',
  ATTENDED: 'Состоялась',
  NO_SHOW: 'Неявка',
};

function StatusBadge({ booking }: { booking: ClientBooking }) {
  // Списанный процент дописан к статусу, а не спрятан в подсказку: это деньги,
  // и увидеть их клиент должен там же, где видит саму отмену.
  const charged =
    booking.chargePercent !== null && booking.chargePercent > 0
      ? `, списано ${booking.chargePercent}%`
      : '';

  return (
    <span className="text-[0.8125rem] whitespace-nowrap text-text-subtle">
      {STATUS_LABELS[booking.status]}
      {charged}
    </span>
  );
}

/** «27 августа, 19:00 – 20:30» — момент показывается по часам браузера. */
function formatSpan(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(start);
  const time = (value: Date): string =>
    new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(value);

  return `${date}, ${time(start)} – ${time(end)}`;
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером';
}
