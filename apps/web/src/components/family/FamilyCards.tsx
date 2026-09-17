'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { FamilyChild, GuardianshipRequestView, MyGuardian, PublicUser } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { guardianshipLeft } from '@/lib/family';

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером';
}

/**
 * «Мои дети» — в кабинете взрослого.
 *
 * Расширение сверх ТЗ по решениям владельца от 12.09 и 17.09.2026. Родитель
 * ведёт ребёнка младше 16: записывает, отменяет, видит историю, ведёт профиль
 * игрока. Сам список детей и переключатель «за кого» живут в
 * `usePersonSwitch` — эта карточка только меняет состав семьи.
 */
export function ParentFamilyCard({
  user,
  kids,
  onChanged,
  onOpenProfile,
}: {
  user: PublicUser;
  kids: FamilyChild[];
  /** Состав семьи поменялся — перечитать список детей. */
  onChanged: () => void;
  /** Открыть профиль игрока ребёнка здесь же, в кабинете. */
  onOpenProfile: (childId: string) => void;
}) {
  const [mode, setMode] = useState<'create' | 'attach' | null>(null);

  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader
        title="Мои дети"
        description="Пока ребёнку нет 16, записывает и отменяет за него родитель, он же ведёт профиль игрока. Ребёнок входит своей учёткой и видит, куда записан."
      />
      <CardBody className="grid gap-6">
        {kids.length === 0 && mode === null && (
          <p className="text-[0.875rem] text-text-muted">Детей пока нет.</p>
        )}

        {kids.length > 0 && (
          <ul className="divide-y divide-border">
            {kids.map((child) => (
              <li key={child.id} className="py-3.5 first:pt-0">
                <ChildRow child={child} onChanged={onChanged} onOpenProfile={onOpenProfile} />
              </li>
            ))}
          </ul>
        )}

        {mode === 'create' && (
          <CreateChildForm
            parentPhone={user.phone}
            onDone={() => {
              setMode(null);
              onChanged();
            }}
            onCancel={() => setMode(null)}
          />
        )}

        {mode === 'attach' && <AttachChildForm onCancel={() => setMode(null)} />}

        {mode === null && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMode('create')}>
              Добавить ребёнка
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('attach')}>
              У ребёнка уже есть учётка
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ChildRow({
  child,
  onChanged,
  onOpenProfile,
}: {
  child: FamilyChild;
  onChanged: () => void;
  onOpenProfile: (childId: string) => void;
}) {
  const [action, setAction] = useState<'password' | 'unlink' | null>(null);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(work: () => Promise<void>, message: string | null): Promise<void> {
    setPending(true);
    setError(null);

    try {
      await work();
      setAction(null);
      setPassword('');
      setDone(message);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.9375rem]">{child.fullName}</p>
          <p className="mt-0.5 text-[0.8125rem] text-text-muted">
            {child.email} · до 16 лет {guardianshipLeft(child.guardianUntil)}
          </p>
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem]">
            <Link href={`/my-bookings?for=${child.id}`} className="text-text-accent underline-offset-2 hover:underline">
              Записи
            </Link>
            {/* Кнопка, а не ссылка на /cabinet?for=: это та же страница, и
                переход по ней не перемонтирует её — выбор бы не сработал. */}
            <button
              type="button"
              onClick={() => onOpenProfile(child.id)}
              className="text-text-accent underline-offset-2 hover:underline"
            >
              Профиль игрока
            </button>
          </p>
        </div>

        {action === null && (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" onClick={() => setAction('password')}>
              Сменить пароль
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAction('unlink')}>
              Отвязать
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {done && action === null && <p className="mt-2 text-[0.8125rem] text-text-muted">{done}</p>}

      {action === 'password' && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => api.setChildPassword(child.id, password),
              'Пароль сменён. На всех устройствах ребёнку нужно войти заново.',
            );
          }}
        >
          <div className="min-w-[14rem] flex-1 [&>div]:mb-0">
            <Field
              label="Новый пароль ребёнка"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" pending={pending}>
            Сменить
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAction(null)}>
            Отмена
          </Button>
        </form>
      )}

      {action === 'unlink' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[0.8125rem] text-text-muted">
            Отвязать? До 16 лет ребёнок не сможет записываться — ни сам, ни через вас.
          </span>
          <Button
            size="sm"
            variant="danger"
            pending={pending}
            onClick={() =>
              void run(async () => {
                await api.unlinkChild(child.id);
                onChanged();
              }, null)
            }
          >
            Да, отвязать
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
            Нет
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Учётка ребёнку — те же поля, что при регистрации.
 *
 * Почта у ребёнка своя: учётки разные, а почта уникальна на платформе. Семье с
 * одним ящиком форма подсказывает адрес с плюсом заранее, а не после ответа
 * «почта занята».
 */
export function CreateChildForm({
  parentPhone,
  onDone,
  onCancel,
  submit = (payload) => api.createChild(payload),
  title = 'Новая учётка ребёнка',
}: {
  parentPhone: string;
  onDone: (child: FamilyChild) => void;
  onCancel: () => void;
  /** У стойки форму отправляет администратор — своим маршрутом. */
  submit?: (payload: Parameters<typeof api.createChild>[0]) => Promise<FamilyChild>;
  title?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    try {
      onDone(
        await submit({
          lastName: String(form.get('lastName')),
          firstName: String(form.get('firstName')),
          middleName: String(form.get('middleName')),
          birthDate: String(form.get('birthDate')),
          email: String(form.get('email')),
          password: String(form.get('password')),
          phone: String(form.get('phone')),
        }),
      );
    } catch (cause) {
      setError(messageOf(cause));
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void send(event)}
      className="rounded-control border border-border bg-surface-sunken px-4 pt-4 pb-3"
    >
      <h3 className="mb-3 text-[0.9375rem] font-medium">{title}</h3>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label="Фамилия" name="lastName" required autoComplete="off" />
        <Field label="Имя" name="firstName" required autoComplete="off" />
        <Field label="Отчество" name="middleName" required autoComplete="off" />
      </div>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Дата рождения" name="birthDate" type="date" required max={new Date().toISOString().slice(0, 10)} />
        <Field
          label="Телефон"
          name="phone"
          type="tel"
          required
          defaultValue={parentPhone}
          hint="Можно родительский, в виде +79991234567"
        />
      </div>

      <Field
        label="Почта ребёнка"
        name="email"
        type="email"
        required
        autoComplete="off"
        hint="Своя у каждого. Если ящик у семьи один, подойдёт адрес с плюсом: ivanov+kolya@mail.ru — письма придут в тот же ящик."
      />
      <Field
        label="Пароль ребёнка"
        name="password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        hint="Не короче 8 символов. Сменить его можно будет здесь же."
      />

      <div className="flex gap-2">
        <Button type="submit" size="sm" pending={pending}>
          Завести учётку
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

/**
 * Закрепить уже существующую учётку — по её почте.
 *
 * Ответ сервера одинаковый при любом исходе, и форма его просто показывает:
 * иначе по ней можно было бы проверять, чьи почты принадлежат детям.
 */
function AttachChildForm({ onCancel }: { onCancel: () => void }) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      setNotice((await api.attachChild(email)).message);
      setEmail('');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void send(event)}
      className="rounded-control border border-border bg-surface-sunken px-4 pt-4 pb-3"
    >
      <h3 className="mb-1 text-[0.9375rem] font-medium">Закрепить учётку ребёнка</h3>
      <p className="mb-3 text-[0.8125rem] text-text-muted">
        Ребёнок подтвердит заявку у себя в кабинете — без его подтверждения закрепить нельзя.
      </p>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      <Field
        label="Почта ребёнка"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <div className="flex gap-2">
        <Button type="submit" size="sm" pending={pending}>
          Отправить заявку
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {notice ? 'Готово' : 'Отмена'}
        </Button>
      </div>
    </form>
  );
}

/**
 * «Семья» — в кабинете ребёнка младше 16: кто его ведёт и кто просит
 * закрепить. Ответить на заявку может только он сам.
 */
export function ChildFamilyCard() {
  const [guardian, setGuardian] = useState<MyGuardian | null | undefined>(undefined);
  const [requests, setRequests] = useState<GuardianshipRequestView[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    api
      .myGuardian()
      .then(setGuardian)
      .catch(() => setGuardian(null));
    api
      .guardianshipRequests()
      .then(setRequests)
      .catch(() => setRequests([]));
  }

  useEffect(load, []);

  async function answer(id: string, value: 'confirm' | 'reject'): Promise<void> {
    setPending(id + value);
    setError(null);

    try {
      await api.answerGuardianshipRequest(id, value);
      load();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader
        title="Семья"
        description="До 16 лет на занятия и турниры записывает родитель — или администратор клуба у стойки."
      />
      <CardBody className="grid gap-4">
        {error && <Alert>{error}</Alert>}

        {guardian === undefined && <p className="text-[0.875rem] text-text-muted">Загружаю…</p>}

        {guardian && (
          <p className="text-[0.9375rem]">
            Записывает родитель: <span className="font-medium">{guardian.name}</span>
          </p>
        )}

        {guardian === null && (
          <p className="text-[0.875rem] text-text-muted">
            За вами пока никто не закреплён. Записать вас может администратор клуба у стойки, а родитель —
            после того как вы подтвердите его заявку.
          </p>
        )}

        {requests.map((request) => (
          <div
            key={request.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface-sunken px-4 py-3"
          >
            <p className="text-[0.9375rem]">
              Вас хочет закрепить за собой <span className="font-medium">{request.guardianName}</span>
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                pending={pending === request.id + 'confirm'}
                disabled={pending !== null}
                onClick={() => void answer(request.id, 'confirm')}
              >
                Подтвердить
              </Button>
              <Button
                size="sm"
                variant="ghost"
                pending={pending === request.id + 'reject'}
                disabled={pending !== null}
                onClick={() => void answer(request.id, 'reject')}
              >
                Отклонить
              </Button>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
