'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { fullYears, hasAnyRole, MANAGING_ROLES, type ClubPeoplePage, type ClubPerson, type Role } from '@yenisey/types';
import { AdminShell } from '@/components/layout/AdminShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CompactSelect } from '@/components/ui/CompactSelect';
import { Tab } from '@/components/ui/Tab';
import { inputClassName } from '@/components/ui/Field';
import { rolesInClub } from '@/lib/membership';
import { ROLE_LABELS, rolesLabel } from '@/lib/roles';
import { ApiError } from '@/lib/api';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/useSession';


/** Вкладки. «Все» первой: чаще нужно найти человека, чем перебрать роль. */
const TABS: { value: Role | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Все' },
  { value: 'OWNER', label: 'Руководители' },
  { value: 'MANAGER', label: 'Управляющие' },
  { value: 'ADMIN', label: 'Администраторы' },
  { value: 'COACH', label: 'Тренеры' },
  { value: 'CLIENT', label: 'Клиенты' },
];

const PAGE_SIZE = 50;

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/** Месяц браузера, 1–12: «в этом месяце» — у того, кто сидит за стойкой. */
function currentMonth(): number {
  return new Date().getMonth() + 1;
}

/** Роли, которые переключаются в строке; клиент — когда не выбрана ни одна. */
const EDITABLE_ROLES: Role[] = ['OWNER', 'MANAGER', 'ADMIN', 'COACH'];

/**
 * Состав клуба: сотрудники и клиенты.
 *
 * Отдельным разделом, а не вкладкой в настройках клуба, намеренно. Настройки —
 * это то, что администратор правит изредка и осознанно; список людей он
 * открывает по несколько раз в день, чтобы кого-то найти. Складывать их в
 * одно место значит заставлять пролистывать цены ради телефона клиента.
 */
export default function PeoplePage() {
  const session = useSession();
  const router = useRouter();

  const [tab, setTab] = useState<Role | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  // Фильтры по дате рождения: месяц дня рождения и возраст «от — до».
  const [birthMonth, setBirthMonth] = useState<number | null>(null);
  const [ageFrom, setAgeFrom] = useState('');
  const [ageTo, setAgeTo] = useState('');
  const [page, setPage] = useState<ClubPeoplePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Роль берётся из привязки к КЛУБУ ИЗ АДРЕСА, а не из профиля: аккаунт один
  // на платформу, и в разных клубах она разная. Раньше клуб здесь не
  // указывался вовсе, и роль бралась из запасного TENANT_SLUG окружения —
  // администратор одного клуба видел админский интерфейс в чужом, а в своём
  // получал отказ. Настоящий доступ это не открывало (сервер проверяет
  // TenantMembership на каждый запрос), но показывало не то.
  const slug = useClubSlug();
  const roles = session.status === 'ready' ? rolesInClub(session.user, slug) : [];
  const allowed = hasAnyRole(roles, MANAGING_ROLES);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  // Смена вкладки или поиска возвращает к началу списка: иначе «показано
  // 51–100» на выборке из трёх человек показало бы пустую страницу.
  useEffect(() => {
    setOffset(0);
  }, [tab, search, birthMonth, ageFrom, ageTo]);

  const club = useClubApi();

  const load = useCallback(async () => {
    if (!allowed) return;

    setLoading(true);
    setError(null);

    try {
      setPage(
        await club.people({
          role: tab === 'ALL' ? undefined : tab,
          search: search.trim() || undefined,
          birthMonth: birthMonth ?? undefined,
          ageFrom: age(ageFrom),
          ageTo: age(ageTo),
          limit: PAGE_SIZE,
          offset,
        }),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setLoading(false);
    }
  }, [allowed, club, tab, search, birthMonth, ageFrom, ageTo, offset]);

  useEffect(() => {
    // Пауза перед запросом: без неё каждая буква в поиске — отдельный поход в
    // базу, и ответы возвращаются вперемешку.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const items = page?.items ?? [];
  const total = page?.total ?? 0;

  return (
    <AdminShell>
      <h1 className="mb-2 text-[1.75rem]">Состав клуба</h1>
      <p className="mb-7 max-w-2xl text-[0.9375rem] text-text-muted">
        Сотрудники и клиенты одним списком. Отключённые учётки остаются здесь и
        помечаются: удаления в продукте нет — за человеком висят платежи и история
        визитов, нужные бухгалтерии.
      </p>

      {session.status === 'ready' && !allowed && (
        <Alert>Раздел доступен только администратору и руководству клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && (
        <Card>
          <CardHeader
            title="Люди"
            description={
              loading
                ? 'Загружаю…'
                : `Показано ${items.length} из ${total} ${plural(total, 'человека', 'человек', 'человек')}`
            }
          />
          <CardBody>
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {/* На телефоне — список ролей (решение от 03.10.2026). */}
              <CompactSelect
                label="Кто"
                value={tab}
                options={TABS.map((item) => ({ value: item.value, label: item.label }))}
                onChange={(value) => {
                  const item = TABS.find((candidate) => candidate.value === value);
                  if (item) setTab(item.value);
                }}
                className="w-full sm:hidden"
              />

              <div className="hidden flex-wrap gap-1.5 sm:flex">
                {TABS.map((item) => (
                  <Tab key={item.value} active={tab === item.value} onClick={() => setTab(item.value)}>
                    {item.label}
                  </Tab>
                ))}
              </div>

              <input
                aria-label="Поиск по людям"
                placeholder="Фамилия, почта, телефон или 17.05"
                title="Дата вида 17.05.2001 ищет по дате рождения, 17.05 — по дню рождения в любом году"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={cn(inputClassName, 'w-full py-1.5 text-[0.875rem] sm:ml-auto sm:w-64')}
              />
            </div>

            <BirthFilters
              birthMonth={birthMonth}
              ageFrom={ageFrom}
              ageTo={ageTo}
              onBirthMonth={setBirthMonth}
              onAgeFrom={setAgeFrom}
              onAgeTo={setAgeTo}
            />

            {items.length === 0 && !loading ? (
              <p className="text-[0.9375rem] text-text-muted">
                {search.trim() || birthMonth !== null || ageFrom || ageTo
                  ? 'Никого не нашлось.'
                  : 'В этой роли пока никого нет.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.875rem]">
                  <thead>
                    <tr className="border-b border-border text-left text-text-subtle">
                      <th className="py-2 pr-4 font-medium">ФИО</th>
                      <th className="py-2 pr-4 font-medium">Почта</th>
                      <th className="py-2 pr-4 font-medium">Телефон</th>
                      <th className="py-2 pr-4 font-medium">Дата рождения</th>
                      <th className="py-2 font-medium">Роли</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((person) => (
                      <PersonRow
                        key={person.id}
                        person={person}
                        self={session.status === 'ready' && session.user.id === person.id}
                        viewerRoles={roles}
                        onChanged={(updated) =>
                          setPage((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  items: previous.items.map((item) =>
                                    item.id === updated.id ? updated : item,
                                  ),
                                }
                              : previous,
                          )
                        }
                        onError={setError}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {total > PAGE_SIZE && (
              <div className="mt-4 flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Назад
                </Button>
                <span className="text-[0.8125rem] text-text-subtle">
                  {offset + 1}–{offset + items.length} из {total}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total || loading}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Дальше
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </AdminShell>
  );
}

/**
 * Строка человека с возможностью сменить роль.
 *
 * Роль — выпадающий список прямо в таблице, а не отдельный экран: повышение
 * клиента до тренера случается на ходу, и заводить ради него мастер из трёх
 * шагов значит сделать так, чтобы им не пользовались.
 */
function PersonRow({
  person,
  self,
  viewerRoles,
  onChanged,
  onError,
}: {
  person: ClubPerson;
  /** Свою роль изменить нельзя — сервер это тоже запрещает. */
  self: boolean;
  /** Роли смотрящего: руководство назначает только руководитель. */
  viewerRoles: Role[];
  onChanged: (person: ClubPerson) => void;
  onError: (message: string) => void;
}) {
  const club = useClubApi();
  const slug = useClubSlug();
  const [pending, setPending] = useState(false);

  // Роли — переключателями, их несколько сразу (решение владельца от
  // 26.09.2026). Ни одной сотруднической — клиент.
  async function toggle(role: Role): Promise<void> {
    const staff: Role[] = person.roles.filter((item) => item !== 'CLIENT');
    const next = staff.includes(role) ? staff.filter((item) => item !== role) : [...staff, role];

    setPending(true);

    try {
      onChanged(await club.changeRoles(person.id, next.length > 0 ? next : ['CLIENT']));
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2.5 pr-4 text-text">
        <Link
          href={`/clubs/${slug}/people/${person.id}`}
          className="underline-offset-2 hover:text-text-accent hover:underline"
        >
          {person.fullName}
        </Link>
        {person.deactivated && (
          <span className="ml-2 text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
            отключён
          </span>
        )}
      </td>
      <td className="py-2.5 pr-4 text-text-muted">{person.email}</td>
      <td className="py-2.5 pr-4 text-text-muted">{person.phone}</td>
      <td className="py-2.5 pr-4 whitespace-nowrap text-text-muted">
        <BirthDate iso={person.birthDate} />
      </td>
      <td className="py-2.5">
        {self ? (
          <span className="text-text-muted" title="Свои роли изменить нельзя">
            {rolesLabel(person.roles)}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1" role="group" aria-label={`Роли: ${person.fullName}`}>
            {EDITABLE_ROLES.map((role) => {
              // Руководство назначает руководитель — остальным переключатель
              // виден, но заперт.
              const locked = (role === 'OWNER' || role === 'MANAGER') && !viewerRoles.includes('OWNER');

              return (
                <button
                  key={role}
                  type="button"
                  aria-pressed={person.roles.includes(role)}
                  disabled={pending || locked}
                  title={locked ? 'Назначает руководитель клуба' : undefined}
                  onClick={() => void toggle(role)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[0.75rem] transition-colors disabled:opacity-40',
                    person.roles.includes(role)
                      ? 'border-border-accent bg-surface-accent-soft text-text-accent'
                      : 'border-border text-text-muted hover:bg-surface-sunken',
                  )}
                >
                  {ROLE_LABELS[role]}
                </button>
              );
            })}
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Фильтры по дате рождения. «Дни рождения в этом месяце» — отдельной кнопкой
 * (решение владельца от 26.09.2026: клуб поздравляет клиентов); список тогда
 * идёт по дню месяца, и чей праздник ближе — видно сразу.
 */
function BirthFilters({
  birthMonth,
  ageFrom,
  ageTo,
  onBirthMonth,
  onAgeFrom,
  onAgeTo,
}: {
  birthMonth: number | null;
  ageFrom: string;
  ageTo: string;
  onBirthMonth: (month: number | null) => void;
  onAgeFrom: (value: string) => void;
  onAgeTo: (value: string) => void;
}) {
  const thisMonth = currentMonth();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-[0.875rem]">
      <Tab
        active={birthMonth === thisMonth}
        onClick={() => onBirthMonth(birthMonth === thisMonth ? null : thisMonth)}
        title="Кого поздравить в этом месяце"
      >
        Дни рождения в этом месяце
      </Tab>

      <label className="flex items-center gap-1.5 whitespace-nowrap text-text-muted">
        Месяц рождения
        <select
          value={birthMonth ?? ''}
          onChange={(event) => onBirthMonth(event.target.value ? Number(event.target.value) : null)}
          className={cn(inputClassName, 'w-auto py-1.5 text-[0.875rem]')}
        >
          <option value="">любой</option>
          {MONTHS.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 whitespace-nowrap text-text-muted">
        Возраст от
        <input
          inputMode="numeric"
          value={ageFrom}
          onChange={(event) => onAgeFrom(event.target.value.replace(/\D/g, '').slice(0, 3))}
          className={cn(inputClassName, '!w-16 py-1.5 text-[0.875rem]')}
        />
      </label>
      <label className="flex items-center gap-1.5 whitespace-nowrap text-text-muted">
        до
        <input
          inputMode="numeric"
          value={ageTo}
          onChange={(event) => onAgeTo(event.target.value.replace(/\D/g, '').slice(0, 3))}
          className={cn(inputClassName, '!w-16 py-1.5 text-[0.875rem]')}
        />
      </label>

      {(birthMonth !== null || ageFrom || ageTo) && (
        <button
          type="button"
          onClick={() => {
            onBirthMonth(null);
            onAgeFrom('');
            onAgeTo('');
          }}
          className="text-text-subtle underline-offset-2 hover:text-text hover:underline"
        >
          Сбросить
        </button>
      )}
    </div>
  );
}

/**
 * Дата рождения с возрастом; у именинника сегодня — пометка, чтобы у стойки
 * не пропустить. Заглушку миграции (1900 год) возрастом не подписываем.
 */
function BirthDate({ iso }: { iso: string }) {
  const today = new Date();
  const born = new Date(`${iso}T00:00:00Z`);
  const placeholder = iso.startsWith('1900-');
  const birthdayToday = !placeholder && born.getUTCMonth() === today.getMonth() && born.getUTCDate() === today.getDate();
  const years = fullYears(born, new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));

  return (
    <>
      {formatDate(iso)}
      {!placeholder && <span className="ml-1.5 text-text-subtle">· {years}</span>}
      {birthdayToday && (
        <span className="ml-2 rounded-full bg-surface-accent-soft px-2 py-0.5 text-[0.75rem] text-text-accent">
          сегодня
        </span>
      )}
    </>
  );
}

/** Возраст из поля ввода: пусто — без ограничения. */
function age(value: string): number | undefined {
  return value === '' ? undefined : Number(value);
}

/** «2001-05-17» → «17.05.2001». Заглушку из миграции показываем как есть. */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

/** Русское склонение по числу: 1 человека, 2 человек, 5 человек. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;

  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;

  return many;
}
