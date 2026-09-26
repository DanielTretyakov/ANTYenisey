'use client';

import { useState, type FormEvent } from 'react';
import { MAX_CLUB_VALUES, type ClubSettings, type ClubValue } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, inputClassName } from '@/components/ui/Field';
import { CityCombobox } from '@/components/ui/CityCombobox';
import { Toggle } from '@/components/ui/Toggle';
import { ApiError } from '@/lib/api';
import { changedOnly } from '@/lib/changed';
import { useClubApi } from '@/lib/useClubApi';
import { cn } from '@/lib/cn';

/**
 * Настройки клуба: общие для всех его залов.
 *
 * Цен, шага бронирования и ЧАСОВОГО ПОЯСА здесь нет — всё это у зала. Пояс
 * переехал туда потому, что залы одной организации бывают в разных регионах:
 * общий на клуб он сдвинул бы в одном из них границы операционного дня и
 * порог «за час до начала», от которого считаются деньги.
 *
 * Здесь остаётся то, что составляет договор клуба с клиентом: как его зовут,
 * в каком городе он числится, как выглядит его страница, что бывает при
 * неявке и как ведут себя абонементы. Разные правила отмены в двух залах
 * одного клуба пришлось бы отдельно оговаривать в оферте.
 *
 * Сроки держатся строками, а не числами: пока человек стирает старое значение,
 * поле законно пусто, и хранить это как число можно только через NaN.
 */
type FormState = {
  name: string;
  cityId: string;
  phone: string;
  email: string;
  description: string;
  values: ClubValue[];
  vkUrl: string;
  maxUrl: string;
  logoUrl: string;
  accentColor: string;
  noShowChargePercent: string;
  attendanceReminderAfterMinutes: string;
  attendanceAutoNoShowAfterMinutes: string;
  subscriptionBurnsOnNoShowOnly: boolean;
};

function toForm(settings: ClubSettings): FormState {
  return {
    name: settings.name,
    cityId: settings.cityId ?? '',
    phone: settings.phone ?? '',
    email: settings.email ?? '',
    description: settings.description ?? '',
    values: settings.values,
    vkUrl: settings.vkUrl ?? '',
    maxUrl: settings.maxUrl ?? '',
    logoUrl: settings.logoUrl ?? '',
    accentColor: settings.accentColor ?? '',
    noShowChargePercent: String(settings.noShowChargePercent),
    attendanceReminderAfterMinutes: String(settings.attendanceReminderAfterMinutes),
    attendanceAutoNoShowAfterMinutes: String(settings.attendanceAutoNoShowAfterMinutes),
    subscriptionBurnsOnNoShowOnly: settings.subscriptionBurnsOnNoShowOnly,
  };
}

/** Целое неотрицательное число из поля, или null, если введено не число. */
function toWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export function SettingsForm({
  initial,
  onSaved,
}: {
  initial: ClubSettings;
  /** Название и оформление нужны шапке страницы — сообщаем наверх об изменении. */
  onSaved: (settings: ClubSettings) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  // С чем сравнивать форму: что она показала при загрузке или после
  // последнего сохранения. Шлётся только отличное от этого.
  const [baseline, setBaseline] = useState<ClubSettings>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
    setSaved(false);
  }

  const club = useClubApi();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const noShowChargePercent = toWholeNumber(form.noShowChargePercent);
    const attendanceReminderAfterMinutes = toWholeNumber(form.attendanceReminderAfterMinutes);
    const attendanceAutoNoShowAfterMinutes = toWholeNumber(form.attendanceAutoNoShowAfterMinutes);

    if (
      noShowChargePercent === null ||
      attendanceReminderAfterMinutes === null ||
      attendanceAutoNoShowAfterMinutes === null
    ) {
      setErrors(['Проценты и сроки указываются целым числом']);
      return;
    }

    setErrors([]);

    const changes = changedOnly(
      {
        name: form.name.trim(),
        // Пустое поле означает «не задано», а не пустую строку: базе нужен
        // либо настоящий идентификатор города, либо NULL.
        cityId: form.cityId || null,
        // Пустое поле — «контакта нет», а не пустая строка: посетителю нельзя
        // показать ссылку `tel:` в никуда.
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        description: form.description.trim() || null,
        // Пустые пункты сервер отбросит сам; адреса ВК и MAX он же
        // нормализует — «vk.com/yenisey» вернётся с https.
        values: form.values,
        vkUrl: form.vkUrl.trim() || null,
        maxUrl: form.maxUrl.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        accentColor: form.accentColor.trim() || null,
        noShowChargePercent,
        attendanceReminderAfterMinutes,
        attendanceAutoNoShowAfterMinutes,
        subscriptionBurnsOnNoShowOnly: form.subscriptionBurnsOnNoShowOnly,
      },
      baseline,
    );

    if (Object.keys(changes).length === 0) {
      setSaved(true);
      return;
    }

    setPending(true);

    try {
      const updated = await club.updateClubSettings(changes);

      setForm(toForm(updated));
      setBaseline(updated);
      setSaved(true);
      onSaved(updated);
    } catch (cause) {
      setErrors(
        cause instanceof ApiError
          ? cause.message.split('; ')
          : ['Сервис недоступен, попробуйте позже'],
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      {errors.length > 0 && (
        <Alert>
          {errors.length === 1 ? (
            errors[0]
          ) : (
            <ul className="list-disc space-y-1 pl-4">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {saved && (
        <Alert tone="info">
          Сохранено. Оформление страницы уже на месте, остальное вступит в силу в ближайшие 00:00 — это видно в
          «Запланированных изменениях».
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Клуб"
          description="Как клуб называется и в каком городе его ищут. Часовой пояс задаётся у каждого зала отдельно — залы бывают в разных регионах."
        />
        <CardBody>
          <Field
            label="Название"
            hint="Его видит человек в поиске клубов и на странице клуба."
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            required
          />
          <CityCombobox
            className="mb-4"
            label="Основной город"
            hint="По нему клуб находят на стартовой странице. Города залов указываются отдельно, и поиск учитывает их тоже."
            emptyLabel="Не указан"
            value={form.cityId || null}
            onChange={(city) => set('cityId', city?.id ?? '')}
          />
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Field
              label="Телефон клуба"
              hint="Виден на странице клуба ссылкой для звонка. Пусто — не показывается."
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
              placeholder="+79991234567"
              inputMode="tel"
            />
            <Field
              label="Почта клуба"
              hint="Тоже видна посетителю — на случай, если звонить неудобно."
              value={form.email}
              onChange={(event) => set('email', event.target.value)}
              placeholder="club@example.ru"
              inputMode="email"
            />
          </div>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Field
              label="ВКонтакте"
              hint="Страница или группа клуба. Можно вставить как есть: vk.com/…"
              value={form.vkUrl}
              onChange={(event) => set('vkUrl', event.target.value)}
              placeholder="https://vk.com/yenisey"
            />
            <Field
              label="MAX"
              hint="Канал или чат клуба в MAX."
              value={form.maxUrl}
              onChange={(event) => set('maxUrl', event.target.value)}
              placeholder="https://max.ru/…"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Оформление"
          description="Как выглядит страница клуба. Пустые поля оставляют её в цветах платформы."
        />
        <CardBody>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-[0.8125rem] font-medium text-text-muted">Описание клуба</span>
            <textarea
              value={form.description}
              onChange={(event) => set('description', event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Чем живёт клуб, для кого он, как добраться"
              className={cn(inputClassName, 'resize-y')}
            />
            <span className="mt-1.5 block text-[0.8125rem] text-text-subtle">
              Показывается под баннером на странице клуба. До 2000 символов.
            </span>
          </label>
          <ValuesEditor values={form.values} onChange={(values) => set('values', values)} />
          <Field
            label="Ссылка на логотип"
            hint="Показывается рядом с названием на странице клуба."
            value={form.logoUrl}
            onChange={(event) => set('logoUrl', event.target.value)}
            placeholder="https://..."
          />
          <div className="grid items-end gap-x-6 sm:grid-cols-[1fr_auto]">
            <Field
              label="Фирменный цвет"
              hint="Шестизначный HEX, например #126b54."
              value={form.accentColor}
              onChange={(event) => set('accentColor', event.target.value)}
              placeholder="#126b54"
            />
            {/* Образец рядом с полем: цвет проверяют глазами, а не по коду. */}
            <span
              aria-hidden="true"
              className="mb-5 h-10 w-10 rounded-control border border-border"
              style={{
                background: /^#[0-9a-fA-F]{6}$/.test(form.accentColor.trim())
                  ? form.accentColor.trim()
                  : 'var(--surface-sunken)',
              }}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Присутствие и неявка"
          description="Что происходит, когда клиент не отменил бронь и не пришёл."
        />
        <CardBody>
          <div className="grid gap-x-6 sm:grid-cols-3">
            <Field
              label="Списать при неявке, %"
              inputMode="numeric"
              value={form.noShowChargePercent}
              onChange={(event) => set('noShowChargePercent', event.target.value)}
            />
            <Field
              label="Напомнить админу через, мин"
              inputMode="numeric"
              value={form.attendanceReminderAfterMinutes}
              onChange={(event) => set('attendanceReminderAfterMinutes', event.target.value)}
            />
            <Field
              label="Зафиксировать неявку через, мин"
              inputMode="numeric"
              value={form.attendanceAutoNoShowAfterMinutes}
              onChange={(event) => set('attendanceAutoNoShowAfterMinutes', event.target.value)}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Абонементы"
          description="Что происходит с визитом на балансе, когда бронь не состоялась. Денег это не касается: абонемент уже оплачен, и штраф за отмену к нему не применяется."
        />
        <CardBody>
          <Toggle
            label="Мягкое правило: визит сгорает только при неявке"
            checked={form.subscriptionBurnsOnNoShowOnly}
            onChange={(event) => set('subscriptionBurnsOnNoShowOnly', event.target.checked)}
          />

          <SubscriptionRules soft={form.subscriptionBurnsOnNoShowOnly} />
        </CardBody>
      </Card>

      <div>
        <Button type="submit" pending={pending} size="lg">
          Сохранить настройки клуба
        </Button>
      </div>
    </form>
  );
}

/**
 * Разбор трёх случаев, которыми отличаются мягкое и строгое правила.
 *
 * Одного переключателя мало: «сгорает только при неявке» не говорит, что
 * будет с поздней отменой, а именно она и есть спорный случай. Поэтому
 * показаны все три исхода сразу, и различающийся выделен.
 */
function SubscriptionRules({ soft }: { soft: boolean }) {
  const rules = [
    {
      event: 'Клиент отменил заранее',
      detail: 'не позднее порога из политики отмены клуба',
      outcome: 'Визит возвращается на баланс',
      differs: false,
    },
    {
      event: 'Клиент отменил поздно',
      detail: 'позже порога, вплоть до самого начала',
      outcome: soft ? 'Визит возвращается на баланс' : 'Визит сгорает',
      differs: true,
    },
    {
      event: 'Клиент не отменил и не пришёл',
      detail: 'неявку отмечает администратор или система',
      outcome: 'Визит сгорает',
      differs: false,
    },
  ];

  return (
    <>
      <dl className="mt-1 divide-y divide-border border-y border-border">
        {rules.map((rule) => (
          <div key={rule.event} className="grid gap-1 py-3 sm:grid-cols-2 sm:gap-4">
            <dt>
              <span className="text-[0.9375rem] text-text">{rule.event}</span>
              <span className="block text-[0.8125rem] text-text-subtle">{rule.detail}</span>
            </dt>
            <dd
              className={cn(
                'text-[0.9375rem]',
                rule.differs ? 'font-medium text-text-accent' : 'text-text-muted',
              )}
            >
              {rule.outcome}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-[0.875rem] text-text-muted">
        {soft
          ? 'Так работает «Енисей» по ТЗ: отменить запись можно в любой момент, даже за пять минут до начала, и визит сохранится. Правило мягче, чем для оплаты картой, — там поздняя отмена всё равно стоит денег.'
          : 'Строгое правило: визит подчиняется той же политике отмены, что и оплата картой, — поздняя отмена сгорает наравне с неявкой. Для «Енисея» в ТЗ описано мягкое правило, так что этот вариант — отступление от него.'}
      </p>
    </>
  );
}

/**
 * Ценности клуба — до шести карточек «заголовок и пара строк» под описанием
 * (решение владельца от 25.09.2026). Порядок — как на странице клуба.
 */
function ValuesEditor({ values, onChange }: { values: ClubValue[]; onChange: (values: ClubValue[]) => void }) {
  const update = (index: number, patch: Partial<ClubValue>): void =>
    onChange(values.map((value, at) => (at === index ? { ...value, ...patch } : value)));

  const move = (index: number, delta: -1 | 1): void => {
    const next = [...values];
    [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
    onChange(next);
  };

  return (
    <fieldset className="mb-5">
      <legend className="mb-1.5 text-[0.8125rem] font-medium text-text-muted">Ценности клуба</legend>
      <p className="mb-3 text-[0.8125rem] text-text-subtle">
        До {MAX_CLUB_VALUES} карточек под описанием: «Семейный клуб — тренируемся всей семьёй».
      </p>

      <ol className="grid gap-3">
        {values.map((value, index) => (
          <li key={index} className="rounded-control border border-border p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2.5 w-5 text-[0.8125rem] text-text-subtle tabular-nums">{index + 1}.</span>
              <div className="grid min-w-0 grow gap-2">
                <input
                  aria-label={`Ценность ${index + 1}: заголовок`}
                  value={value.title}
                  maxLength={60}
                  onChange={(event) => update(index, { title: event.target.value })}
                  placeholder="Заголовок"
                  className={inputClassName}
                />
                <textarea
                  aria-label={`Ценность ${index + 1}: пояснение`}
                  value={value.text}
                  maxLength={300}
                  rows={2}
                  onChange={(event) => update(index, { text: event.target.value })}
                  placeholder="Пара строк пояснения — необязательно"
                  className={cn(inputClassName, 'resize-y')}
                />
              </div>
              <div className="flex flex-col">
                <SmallButton label="Выше" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </SmallButton>
                <SmallButton label="Ниже" disabled={index === values.length - 1} onClick={() => move(index, 1)}>
                  ↓
                </SmallButton>
                <SmallButton label="Убрать" disabled={false} onClick={() => onChange(values.filter((_, at) => at !== index))}>
                  ×
                </SmallButton>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {values.length < MAX_CLUB_VALUES && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-3"
          onClick={() => onChange([...values, { title: '', text: '' }])}
        >
          + Добавить ценность
        </Button>
      )}
    </fieldset>
  );
}

function SmallButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-control text-text-muted hover:bg-surface-sunken hover:text-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}
