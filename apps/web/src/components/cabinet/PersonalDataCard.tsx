'use client';

import { useState, type FormEvent } from 'react';
import type { PublicUser } from '@yenisey/types';
import { PhoneField } from '@/components/PhoneField';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { isChildBirthDate } from '@/lib/family';
import { saveSession } from '@/lib/session';

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером';
}

/**
 * Личные данные — наверху редактора и с правкой (решение владельца от
 * 25.09.2026).
 *
 * Сам человек меняет ФИО, телефон и пароль. Почта и дата рождения — через
 * администратора клуба: почта — логин, а писем подтверждения в продукте нет,
 * и опечатка закрыла бы человеку вход; дата рождения решает правила до 14
 * лет, и правка её самим ребёнком вывела бы его из-под опеки. До 14 лет ФИО и
 * телефон тоже ведут родитель и клуб — как профиль игрока.
 *
 * На странице игрока ничего отсюда нет: там имя «Фамилия И.» и всё.
 */
export function PersonalDataCard({ user: initial }: { user: PublicUser }) {
  const [user, setUser] = useState(initial);
  const child = isChildBirthDate(user.birthDate);

  return (
    <>
      <Card className="max-w-2xl">
        <CardHeader
          title="Личные данные"
          description="Их видят администраторы ваших клубов. На странице игрока их нет — там только «Фамилия И.»."
        />
        <CardBody>
          {child ? <ReadOnlyData user={user} /> : <DataForm user={user} onSaved={setUser} />}
        </CardBody>
      </Card>

      <PasswordCard />
    </>
  );
}

/**
 * Разбор ФИО на части для формы. Хранится одной строкой; при двойной фамилии
 * разбор ошибётся — человек поправит поля сам, сервер сохранит как введено.
 */
function nameParts(fullName: string): { lastName: string; firstName: string; middleName: string } {
  const [lastName = '', firstName = '', ...rest] = fullName.trim().split(/\s+/);

  return { lastName, firstName, middleName: rest.join(' ') };
}

function DataForm({ user, onSaved }: { user: PublicUser; onSaved: (user: PublicUser) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const parts = nameParts(user.fullName);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const phone = String(form.get('phone'));

    // Скрытое поле телефона пустеет, пока не набраны все десять цифр.
    if (!phone) {
      setError('Введите номер телефона полностью — десять цифр');
      return;
    }

    setPending(true);
    setError(null);
    setSaved(false);

    try {
      onSaved(
        await api.updateMe({
          lastName: String(form.get('lastName')),
          firstName: String(form.get('firstName')),
          middleName: String(form.get('middleName')),
          phone,
        }),
      );
      setSaved(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label="Фамилия" name="lastName" defaultValue={parts.lastName} required maxLength={100} autoComplete="family-name" />
        <Field label="Имя" name="firstName" defaultValue={parts.firstName} required maxLength={100} autoComplete="given-name" />
        <Field label="Отчество" name="middleName" defaultValue={parts.middleName} required maxLength={100} autoComplete="additional-name" />
      </div>

      <div className="sm:max-w-xs">
        <PhoneField initial={user.phone} />
      </div>

      <FixedFacts user={user} />

      <div className="mt-2 flex items-center gap-3">
        <Button type="submit" size="sm" pending={pending}>
          Сохранить
        </Button>
        {saved && <span className="text-[0.8125rem] text-text-muted">Сохранено</span>}
      </div>
    </form>
  );
}

function ReadOnlyData({ user }: { user: PublicUser }) {
  return (
    <>
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Fact label="ФИО" value={user.fullName} />
        <Fact label="Телефон" value={user.phone || '—'} />
      </dl>
      <FixedFacts user={user} />
      <p className="mt-4 text-[0.8125rem] text-text-subtle">
        До 14 лет данные меняет родитель или администратор клуба.
      </p>
    </>
  );
}

/** Почта и дата рождения — видны, но меняются только через клуб. */
function FixedFacts({ user }: { user: PublicUser }) {
  return (
    <div className="mt-2 mb-4 rounded-control border border-border bg-surface-sunken px-4 py-3.5">
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Fact label="Электронная почта" value={user.email} />
        <Fact label="Дата рождения" value={formatBirthDate(user.birthDate)} />
      </dl>
      <p className="mt-3 text-[0.8125rem] text-text-subtle">
        Почта — ваш логин, дата рождения решает правила до 14 лет. Их меняет администратор клуба.
      </p>
    </div>
  );
}

function PasswordCard() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get('newPassword'));

    if (newPassword !== String(form.get('repeatPassword'))) {
      setError('Новый пароль и повтор не совпадают');
      return;
    }

    setPending(true);
    setError(null);
    setDone(false);

    try {
      // Ответ — новая сессия: прежние сервер погасил все, эта вкладка
      // продолжает работать с новым токеном.
      saveSession(await api.changePassword({ currentPassword: String(form.get('currentPassword')), newPassword }));
      formElement.reset();
      setDone(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title="Пароль"
        description="После смены все остальные входы — на других устройствах и в других браузерах — закроются."
      />
      <CardBody>
        <form onSubmit={(event) => void submit(event)}>
          {error && <Alert>{error}</Alert>}
          {done && <Alert tone="info">Пароль изменён. Остальные входы закрыты.</Alert>}

          <Field label="Текущий пароль" name="currentPassword" type="password" autoComplete="current-password" required />
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field
              label="Новый пароль"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              hint="Не короче 8 символов"
              required
            />
            <Field label="Повторите новый" name="repeatPassword" type="password" autoComplete="new-password" required />
          </div>

          <Button type="submit" size="sm" variant="secondary" pending={pending}>
            Сменить пароль
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">{label}</dt>
      <dd className="mt-1 text-[0.9375rem] break-words text-text">{value}</dd>
    </div>
  );
}

/** «17 мая 2001». Дата рождения приходит как «2001-05-17». */
function formatBirthDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);

  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}
