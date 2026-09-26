'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  hasAnyRole,
  MANAGING_ROLES,
  MAX_TABLES_WITH_HALL,
  type ClubSettings,
  type ClubTable,
  type Hall,
  type SettingsChange,
} from '@yenisey/types';
import { AdminShell } from '@/components/layout/AdminShell';
import { clubPath } from '@/components/layout/ClubNav';
import { Alert } from '@/components/ui/Alert';
import { AddressCombobox, type ChosenAddress } from '@/components/ui/AddressCombobox';
import { CityCombobox } from '@/components/ui/CityCombobox';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Tab } from '@/components/ui/Tab';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { rolesInClub } from '@/lib/membership';
import { ApiError } from '@/lib/api';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';
import { ClubPageCard } from './ClubPageCard';
import { HallForm } from './HallForm';
import { PendingChanges } from './PendingChanges';
import { SettingsForm } from './SettingsForm';
import { TablesCard } from './TablesCard';


type Loaded = {
  settings: ClubSettings;
  halls: Hall[];
  tables: ClubTable[];
  /** Правки, ждущие полуночи, и история недели. */
  changes: SettingsChange[];
};

/**
 * Настройки клуба: общие правила, залы и столы.
 *
 * Расписания здесь больше нет — оно переехало в раздел «Расписание»
 * операционки. Сетку правят каждый вечер, а эту страницу открывают раз в
 * сезон, и держать их вместе значило гонять администратора через цены ради
 * переноса занятия. Заодно страница стала грузить три справочника вместо
 * семи: тренеры, типы и турниры были нужны только сетке.
 *
 * Проверка роли здесь — это удобство, а не защита: она убирает со страницы то,
 * чем человек всё равно не сможет воспользоваться. Настоящий запрет стоит на
 * API (`@Roles('ADMIN', 'OWNER')`), и обойти его, открыв адрес напрямую,
 * нельзя.
 */
export default function ClubPage() {
  const session = useSession();
  const router = useRouter();

  const [data, setData] = useState<Loaded | null>(null);
  const [hallId, setHallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingHall, setAddingHall] = useState(false);
  const [newHall, setNewHall] = useState<{
    name: string;
    cityId: string | null;
    address: ChosenAddress | null;
    tableCount: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Отмена правки возвращает формам прежние значения: они показывали
  // «каким станет», и без пересборки отменённое осталось бы на экране.
  const [formVersion, setFormVersion] = useState(0);

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

  const club = useClubApi();

  useEffect(() => {
    if (!allowed) {
      return;
    }

    let cancelled = false;

    // Всё грузится разом: это один экран, и ждать части по очереди означало бы
    // умножить ожидание на ровном месте.
    Promise.all([club.clubSettings(), club.halls(), club.clubTables(), club.settingsChanges()])
      .then(([settings, halls, tables, changes]) => {
        if (cancelled) return;

        setData({ settings, halls, tables, changes });
        setHallId((previous) => previous ?? halls[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const hall = data?.halls.find((item) => item.id === hallId) ?? null;

  /**
   * Перечитать запланированное после любой правки: что именно ушло в
   * очередь и когда вступит, решает сервер (одинаковое значение он не
   * ставит вовсе).
   */
  /** После отмены: формы — заново с сервера, как есть сейчас. */
  function reloadAfterCancel(changes: SettingsChange[]): void {
    Promise.all([club.clubSettings(), club.halls(), club.clubTables()])
      .then(([settings, halls, tables]) => {
        setData((previous) => (previous ? { ...previous, settings, halls, tables, changes } : previous));
        setFormVersion((value) => value + 1);
      })
      .catch(() => setData((previous) => (previous ? { ...previous, changes } : previous)));
  }

  function refreshChanges(): void {
    club
      .settingsChanges()
      .then((changes) => setData((previous) => (previous ? { ...previous, changes } : previous)))
      .catch(() => undefined);
  }

  /**
   * Новый зал — окном «название, город, адрес»: адрес обязателен и приходит
   * только из справочника (решение владельца от 25.09.2026), поэтому завести
   * зал одной кнопкой, как раньше, больше нельзя.
   */
  function startHall(): void {
    if (!data) return;

    const source = hall ?? data.halls[0];
    setError(null);
    setNewHall({
      name: nextHallName(data.halls),
      cityId: source?.cityId ?? null,
      address: null,
      tableCount: String(source ? data.tables.filter((table) => table.hallId === source.id).length : 0),
    });
  }

  async function addHall(): Promise<void> {
    if (!data || !newHall) return;

    if (!newHall.address) {
      setError('Выберите адрес нового зала из подсказок');
      return;
    }

    const tableCount = Number(newHall.tableCount.trim() || '0');

    if (!Number.isInteger(tableCount) || tableCount < 0 || tableCount > MAX_TABLES_WITH_HALL) {
      setError(`Столов — целое число от 0 до ${MAX_TABLES_WITH_HALL}`);
      return;
    }

    setError(null);
    setAddingHall(true);

    try {
      // Новый зал заводится с настройками текущего: второй зал клуба обычно
      // похож на первый, и переписывать цены с нуля незачем.
      const source = hall ?? data.halls[0];
      const created = await club.createHall({
        name: newHall.name.trim() || nextHallName(data.halls),
        // Пояс и город тоже наследуются от соседнего зала: второй зал обычно
        // в том же городе, а если нет — это ровно то, что администратор
        // придёт и поправит. Пустой пояс здесь означал бы зал, живущий по
        // времени сервера.
        timezone: source?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        cityId: newHall.cityId,
        addressFiasId: newHall.address.fiasId,
        bookingStep: source?.bookingStep ?? 'MIN_30',
        tableHourPrice: source?.tableHourPrice ?? 0,
        tableExtra30MinPrice: source?.tableExtra30MinPrice ?? 0,
        hasRobotOption: false,
        robot30MinPrice: null,
        robot60MinPrice: null,
        robotExtra30MinPrice: null,
        tableCount,
      });

      // Зал появится в полночь (решение владельца от 26.09.2026) — в список
      // он не встаёт, а ждёт в «Запланированных изменениях».
      setNewHall(null);
      setNotice(`Зал «${created.name}» появится в ближайшие 00:00 — вместе со столами. Передумали — отмените ниже.`);
      refreshChanges();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setAddingHall(false);
    }
  }

  return (
    <AdminShell>
      <h1 className="mb-2 text-[1.75rem]">Настройки клуба</h1>
      <p className="mb-7 max-w-2xl text-[0.9375rem] text-text-muted">
        Всё на этой странице клуб меняет сам, без участия разработчика. Правки вступают в силу в ближайшие
        00:00 по времени зала, а не посреди рабочего дня, — сразу меняется только оформление страницы клуба.
        Уже созданные брони хранят свою копию цены, и правка прайса не переписывает историю задним числом.
      </p>

      {session.status === 'ready' && !allowed && (
        <Alert>Раздел доступен только администратору и руководству клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && !error && !data && <SettingsSkeleton />}

      {data && (
        <div className="grid gap-6">
          {notice && <Alert tone="info">{notice}</Alert>}

          <PendingChanges changes={data.changes} onChange={reloadAfterCancel} />

          <SettingsForm
            key={formVersion}
            initial={data.settings}
            onSaved={(settings) => {
              setData({ ...data, settings });
              refreshChanges();
            }}
          />

          <ClubPageCard
            settings={data.settings}
            halls={data.halls}
            onSettings={(settings) => setData({ ...data, settings })}
          />

          <div>
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[0.8125rem] tracking-[0.06em] text-text-subtle uppercase">
                Залы
              </span>

              {data.halls.map((item) => (
                <Tab key={item.id} active={item.id === hallId} onClick={() => setHallId(item.id)}>
                  {item.name}
                </Tab>
              ))}

              {data.changes
                .filter((change) => change.status === 'PENDING' && change.kind === 'HALL_CREATE')
                .map((change) => (
                  <span
                    key={change.id}
                    className="rounded-full border border-dashed border-border px-3 py-1 text-[0.8125rem] text-text-muted"
                    title="Зал появится в полночь — тогда его и можно будет править"
                  >
                    {change.newName} · {change.effectiveLabel}
                  </span>
                ))}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={startHall}
              >
                + Зал
              </Button>
            </div>

            {newHall && (
              <Dialog
                title="Новый зал"
                description="Цены, шаг брони и пояс возьмём у текущего зала — поправите после."
                onClose={() => setNewHall(null)}
              >
                <form
                  className="px-6 py-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addHall();
                  }}
                >
                  {error && <Alert>{error}</Alert>}
                  <Field
                    label="Название зала"
                    value={newHall.name}
                    onChange={(event) => setNewHall({ ...newHall, name: event.target.value })}
                    required
                  />
                  <CityCombobox
                    className="mb-4"
                    label="Город зала"
                    value={newHall.cityId}
                    onChange={(city) => setNewHall({ ...newHall, cityId: city?.id ?? null, address: null })}
                  />
                  <AddressCombobox
                    label="Адрес"
                    cityId={newHall.cityId}
                    value={newHall.address}
                    onChange={(address) => setNewHall({ ...newHall, address })}
                  />
                  <Field
                    label="Сколько столов"
                    hint="«Стол 1», «Стол 2»… — переименовать можно потом. Зал со столами появится в ближайшие 00:00."
                    inputMode="numeric"
                    value={newHall.tableCount}
                    onChange={(event) => setNewHall({ ...newHall, tableCount: event.target.value })}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setNewHall(null)}>
                      Отмена
                    </Button>
                    <Button type="submit" pending={addingHall} disabled={!newHall.address}>
                      Завести зал
                    </Button>
                  </div>
                </form>
              </Dialog>
            )}

            {hall && (
              <div className="grid gap-6">
                <HallForm
                  key={`${hall.id}:${formVersion}`}
                  hall={hall}
                  canDelete={data.halls.length > 1}
                  onSaved={(updated) => {
                    setData({
                      ...data,
                      halls: data.halls.map((item) => (item.id === updated.id ? updated : item)),
                    });
                    refreshChanges();
                  }}
                  // Зал удаляется в полночь: до тех пор он остаётся в списке.
                  onDeleted={() => refreshChanges()}
                />

                <TablesCard hallId={hall.id} tables={data.tables} changes={data.changes} onQueued={refreshChanges} />

                <p className="text-[0.875rem] text-text-muted">
                  Расписание зала — шаблон недели и правки на даты — теперь в разделе{' '}
                  <Link
                    href={clubPath(slug, '/schedule')}
                    className="text-text-accent underline underline-offset-2"
                  >
                    «Расписание залов»
                  </Link>
                  .
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminShell>
  );
}

/** Следующее свободное имя вида «Зал 2». */
function nextHallName(halls: Hall[]): string {
  const taken = new Set(halls.map((hall) => hall.name));

  for (let index = 2; ; index += 1) {
    const name = `Зал ${index}`;

    if (!taken.has(name)) {
      return name;
    }
  }
}

/**
 * Заглушка на время загрузки.
 *
 * Серые полосы вместо надписи «Загружаю…»: они занимают то место, куда встанут
 * поля, и страница не подпрыгивает в момент ответа сервера.
 */
function SettingsSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader title="Клуб" description="Загружаю настройки…" />
      <CardBody>
        <div className="grid gap-5">
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <div className="h-2.5 w-32 rounded-full bg-border" />
              <div className="mt-2.5 h-10 w-full rounded-control bg-border/60" />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
