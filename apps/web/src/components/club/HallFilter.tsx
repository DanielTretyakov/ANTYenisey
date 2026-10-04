'use client';

import type { ReactNode } from 'react';
import type { PublicHall } from '@yenisey/types';
import { CompactSelect } from '@/components/ui/CompactSelect';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';
import { SectionHeading } from './SectionHeading';

/** Что выбрано: город и, внутри него, зал. Пусто — все. */
export interface HallSelection {
  city: string | null;
  hallId: string | null;
}

export const ALL_HALLS: HallSelection = { city: null, hallId: null };

/** Подпись города у зала без города в справочнике. */
const NO_CITY = 'Другие';

const cityOf = (hall: PublicHall): string => hall.city ?? NO_CITY;

/** Якорь выбора зала — к нему прокручивают «сменить зал». */
export const HALL_PICKER_ANCHOR = 'vybor-zala';

/**
 * Выбранные залы — или `null`, если выбраны все: фильтр тогда не нужен вовсе,
 * и запрос уходит без него.
 */
export function selectedHallIds(halls: readonly PublicHall[], selection: HallSelection): string[] | null {
  if (selection.hallId) {
    return [selection.hallId];
  }

  if (selection.city) {
    return halls.filter((hall) => cityOf(hall) === selection.city).map((hall) => hall.id);
  }

  return null;
}

/**
 * Выбор, приведённый к залам клуба: зал, которого больше нет, — «все»; у
 * выбранного зала город — его собственный. Выбор помнит браузер, а залы и
 * города у клуба меняются: сохранённое «Пироги» без города при втором городе
 * у клуба показало бы кнопку «Все города», а фильтр стоял бы на Пирогах.
 */
export function normalizeSelection(halls: readonly PublicHall[], selection: HallSelection): HallSelection {
  if (selection.hallId) {
    const hall = halls.find((item) => item.id === selection.hallId);

    return hall ? { city: cityOf(hall), hallId: hall.id } : ALL_HALLS;
  }

  return selection.city && halls.some((hall) => cityOf(hall) === selection.city) ? selection : ALL_HALLS;
}

/** Выбранный зал, если выбран ровно один. */
export function selectedHall(halls: readonly PublicHall[], selection: HallSelection): PublicHall | null {
  return selection.hallId ? (halls.find((hall) => hall.id === selection.hallId) ?? null) : null;
}

/**
 * Выбор зала — ключевой переключатель страницы клуба (решения владельца от
 * 25 и 27.09.2026): одна организация, залы в разных городах, и мероприятия,
 * тренеры, абонементы и расписание у них свои.
 *
 * Крупными кнопками, а не пилюлями `Tab`: от выбора зависит всё, что ниже, и
 * он должен читаться с первого взгляда. Выбранная залита цветом клуба.
 *
 * Городов несколько — первая строка «Все · Красноярск · Абакан», вторая — залы
 * выбранного города. Город один — сразу залы. Зал один — выбора нет, но блок
 * есть: под выбором — карточки выбранных залов (решение владельца от
 * 30.09.2026: зал — сразу у выбора, а не отдельной вкладкой ниже).
 *
 * На телефоне — двумя списками «Город» и «Зал» (решение от 03.10.2026):
 * крупные кнопки там уходили лентой за край, и залов за ним не было видно.
 * Адрес выбранного зала — в карточке сразу под списком.
 */
export function HallPicker({
  halls,
  value,
  onChange,
  children,
}: {
  halls: readonly PublicHall[];
  value: HallSelection;
  onChange: (selection: HallSelection) => void;
  /** Карточки выбранных залов — под кнопками выбора. */
  children?: ReactNode;
}) {
  if (halls.length < 2) {
    return (
      <section id={HALL_PICKER_ANCHOR} className="mb-12 scroll-mt-48">
        <SectionHeading
          title={halls.length === 1 ? 'Зал клуба' : 'Залы'}
          description="Где играют, когда открыто и почём стол — бронь прямо из карточки."
        />
        {children}
      </section>
    );
  }

  const cities = [...new Set(halls.map(cityOf))];
  const oneCity = cities.length === 1;
  const inCity = oneCity ? halls : value.city ? halls.filter((hall) => cityOf(hall) === value.city) : [];

  return (
    <section id={HALL_PICKER_ANCHOR} className="mb-12 scroll-mt-48">
      <SectionHeading
        title="Выберите зал"
        description="Под выбором — карточка зала: где он, когда открыт и почём стол. От зала зависит и всё ниже — мероприятия, тренеры, абонементы и расписание. Выбор запоминается в этом браузере."
      />

      <div className="grid gap-2 sm:hidden">
        {!oneCity && (
          <CompactSelect
            label="Город"
            value={value.city ?? ''}
            options={[{ value: '', label: 'Все города' }, ...cities.map((city) => ({ value: city, label: city }))]}
            onChange={(city) => onChange(city ? { city, hallId: null } : ALL_HALLS)}
            className="[&_label]:w-10"
          />
        )}
        {inCity.length > 1 && (
          <CompactSelect
            label="Зал"
            value={value.hallId ?? ''}
            options={[
              { value: '', label: `${oneCity ? 'Все залы' : 'Все залы города'} · ${inCity.length}` },
              ...inCity.map((hall) => ({ value: hall.id, label: hall.name })),
            ]}
            onChange={(hallId) => {
              const hall = inCity.find((item) => item.id === hallId);
              onChange(
                hall
                  ? { city: oneCity ? null : cityOf(hall), hallId: hall.id }
                  : { city: oneCity ? null : value.city, hallId: null },
              );
            }}
            className="[&_label]:w-10"
          />
        )}
      </div>

      {!oneCity && (
        <Row label="Город" className="mb-3">
          <Choice active={value.city === null} onClick={() => onChange(ALL_HALLS)} size="md">
            Все города
          </Choice>
          {cities.map((city) => (
            <Choice key={city} active={value.city === city} onClick={() => onChange({ city, hallId: null })} size="md">
              {city}
            </Choice>
          ))}
        </Row>
      )}

      {inCity.length > 1 && (
        <Row label="Зал">
          <Choice
            active={value.hallId === null}
            onClick={() => onChange({ city: oneCity ? null : value.city, hallId: null })}
            note={`${inCity.length} ${plural(inCity.length, 'зал', 'зала', 'залов')}`}
          >
            {oneCity ? 'Все залы' : 'Все залы города'}
          </Choice>
          {inCity.map((hall) => (
            <Choice
              key={hall.id}
              active={value.hallId === hall.id}
              onClick={() => onChange({ city: oneCity ? null : cityOf(hall), hallId: hall.id })}
              note={streetOf(hall)}
            >
              {hall.name}
            </Choice>
          ))}
        </Row>
      )}

      {/* Город с одним залом: зал выбран городом — показываем, какой это. */}
      {!oneCity && inCity.length === 1 && (
        <p className="mt-2 text-[0.9375rem] text-text-muted sm:mt-0">
          В этом городе один зал — <span className="text-text">{inCity[0]!.name}</span>.
        </p>
      )}

      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}

/**
 * Кнопка выбора. `aria-pressed` — это переключатель состояния страницы, как
 * `Tab`, только крупный: ради него на страницу и приходят.
 */
function Choice({
  active,
  onClick,
  children,
  note,
  size = 'lg',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  note?: string | null;
  size?: 'md' | 'lg';
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex shrink-0 flex-col items-start rounded-card border-2 text-left transition-colors',
        size === 'lg' ? 'min-h-14 min-w-36 px-5 py-2.5' : 'px-4 py-2',
        active
          ? 'border-accent bg-accent text-accent-text shadow-sm'
          : 'border-border-strong bg-surface-raised text-text hover:border-accent hover:bg-surface-accent-soft',
      )}
    >
      <span className={cn('font-medium whitespace-nowrap', size === 'lg' ? 'text-[1.0625rem]' : 'text-[0.9375rem]')}>
        {children}
      </span>
      {note && (
        <span
          className={cn('mt-0.5 max-w-52 truncate text-[0.8125rem]', active ? 'text-accent-text' : 'text-text-muted')}
        >
          {note}
        </span>
      )}
    </button>
  );
}

function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('-mx-1 hidden overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:block', className)}>
      <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/**
 * Где зал — коротко, для второй строки кнопки: улица и дом без города и
 * индекса. DaData пишет «г Красноярск, ул Ленина, д 1» — город в кнопке
 * лишний, он уже выбран. Адреса нет (залы, заведённые до 25.09.2026 и с тех
 * пор не правленные) — так и сказано: раньше на его месте стоял город, и
 * у соседних кнопок вторая строка значила разное.
 */
function streetOf(hall: PublicHall): string {
  if (!hall.address) {
    return 'адрес не указан';
  }

  const parts = hall.address.split(',').map((part) => part.trim());
  const withoutCity = parts.filter(
    (part) => !/^\d{6}$/.test(part) && !(hall.city && part.toLowerCase().includes(hall.city.toLowerCase())),
  );

  return withoutCity.join(', ') || hall.address;
}
