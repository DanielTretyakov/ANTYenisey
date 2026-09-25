'use client';

import type { PublicHall } from '@yenisey/types';
import { Tab } from '@/components/ui/Tab';

/** Что выбрано: город и, внутри него, зал. Пусто — все. */
export interface HallSelection {
  city: string | null;
  hallId: string | null;
}

export const ALL_HALLS: HallSelection = { city: null, hallId: null };

/** Подпись города у зала без города в справочнике. */
const NO_CITY = 'Другие';

const cityOf = (hall: PublicHall): string => hall.city ?? NO_CITY;

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
 * Фильтр страницы клуба «город, внутри — зал» (решение владельца от
 * 25.09.2026): одна организация, залы в разных городах, и мероприятия,
 * тренеры, залы и абонементы у них свои.
 *
 * Городов несколько — первая строка «Все · Красноярск · Абакан», а у города с
 * несколькими залами — вторая, с залами. Город один — сразу залы. Зал один —
 * фильтра нет.
 */
export function HallFilter({
  halls,
  value,
  onChange,
}: {
  halls: readonly PublicHall[];
  value: HallSelection;
  onChange: (selection: HallSelection) => void;
}) {
  if (halls.length < 2) {
    return null;
  }

  const cities = [...new Set(halls.map(cityOf))];
  const oneCity = cities.length === 1;
  const inCity = oneCity ? halls : value.city ? halls.filter((hall) => cityOf(hall) === value.city) : [];

  return (
    <div className="mb-8 grid gap-2.5 rounded-card border border-border bg-surface-raised px-4 py-3.5 sm:px-5">
      <p className="text-[0.8125rem] text-text-muted">
        Показать мероприятия, тренеров и абонементы {oneCity ? 'зала' : 'города и зала'}:
      </p>

      {!oneCity && (
        <Row label="Город">
          <Tab active={value.city === null} onClick={() => onChange(ALL_HALLS)}>
            Все города
          </Tab>
          {cities.map((city) => (
            <Tab key={city} active={value.city === city} onClick={() => onChange({ city, hallId: null })}>
              {city}
            </Tab>
          ))}
        </Row>
      )}

      {inCity.length > 1 && (
        <Row label="Зал">
          <Tab
            active={value.hallId === null}
            onClick={() => onChange({ city: oneCity ? null : value.city, hallId: null })}
          >
            {oneCity ? 'Все залы' : 'Все залы города'}
          </Tab>
          {inCity.map((hall) => (
            <Tab
              key={hall.id}
              active={value.hallId === hall.id}
              onClick={() => onChange({ city: oneCity ? null : cityOf(hall), hallId: hall.id })}
            >
              {hall.name}
            </Tab>
          ))}
        </Row>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
      <div className="flex w-max items-center gap-1.5" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
