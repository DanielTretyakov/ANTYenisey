'use client';

import type { PublicUser } from '@yenisey/types';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';

/**
 * Личные данные: ФИО, почта, телефон, дата рождения.
 *
 * Отдельный раздел кабинета, а не шапка страницы игрока: на странице игрока их
 * не видит никто — там имя «Фамилия И.» и ничего больше.
 */
export function ProfileCard({ user }: { user: PublicUser }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Личные данные" description="Их видят администраторы ваших клубов, на странице игрока их нет." />
      <CardBody>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Row label="ФИО" value={user.fullName} />
          <Row label="Электронная почта" value={user.email} />
          <Row label="Телефон" value={user.phone ?? '—'} />
          <Row label="Дата рождения" value={formatBirthDate(user.birthDate)} />
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

/** «17 мая 2001». Дата рождения приходит как «2001-05-17». */
function formatBirthDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);

  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(parsed);
}
