'use client';

import type { ExternalRatingBadge, ExternalRatingChoice, MyExternalRatings, RatingSystem } from '@yenisey/types';
import { RATING_SYSTEM_LABEL } from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useDisclosure } from '@/lib/useDisclosure';

/**
 * Логотипы систем. ФНТР и RTTF — знаки самих систем (их надпись и есть
 * название), RTTW — значок, рядом с которым название подписывается словом.
 * Подложка всегда светлая: чёрный знак ФНТР в тёмной теме пропал бы.
 */
const LOGOS: Record<RatingSystem, { src: string; className: string; withName: boolean }> = {
  FNTR: { src: '/brand/ratings/fntr.png', className: 'h-4 w-auto', withName: false },
  RTTF: { src: '/brand/ratings/rttf.svg', className: 'h-6 w-auto', withName: false },
  RTTW: { src: '/brand/ratings/rttw.svg', className: 'h-4 w-4', withName: true },
};

/** Порядок плашек: федерация первой, дальше любительские. */
const ORDER: RatingSystem[] = ['FNTR', 'RTTF', 'RTTW'];

/**
 * Чем заглушка объясняет пустую плашку. RTTF сайт пока не читает — честно
 * «скоро», а не «не найден»: человек не должен думать, что его там нет.
 */
const EMPTY: Record<RatingSystem, { caption: string; hint: string }> = {
  FNTR: { caption: 'нет данных', hint: 'Рейтинг ФНТР не найден. Сайт ищет его сам раз в сутки — по фамилии, имени и дате рождения.' },
  RTTF: { caption: 'скоро', hint: 'Рейтинг RTTF подключим позже.' },
  RTTW: { caption: 'нет данных', hint: 'Рейтинг RTTW не найден. Сайт ищет его сам раз в сутки — по ФИО и городу клуба игрока.' },
};

/** Своё в кабинете: варианты «выберите себя» и что закреплено самим. */
export interface OwnRatings {
  mine: MyExternalRatings;
  busy: boolean;
  onClaim: (system: RatingSystem, externalId: string) => void;
  onUnclaim: (system: RatingSystem) => void;
}

/**
 * Рейтинги во внешних системах — плашками под именем (решения владельца от
 * 20.10.2026): все три всегда, найденная — с числом и ссылкой на источник,
 * ненайденная — заглушкой. В кабинете (`own`) там, где под ФИО нашлись
 * несколько, — «выберите себя» со списком совпавших.
 */
export function ExternalRatings({ ratings, own }: { ratings: ExternalRatingBadge[]; own?: OwnRatings }) {
  return (
    <ul className="mt-3 flex flex-wrap items-start gap-2" aria-label="Рейтинги">
      {ORDER.map((system) => {
        const badge = ratings.find((item) => item.system === system);
        const choices = own?.mine.choices[system] ?? [];

        return (
          <li key={system} className="relative">
            {badge ? (
              <>
                <RatingBadge badge={badge} />
                {own?.mine.claimed.includes(system) && (
                  <button
                    type="button"
                    disabled={own.busy}
                    onClick={() => own.onUnclaim(system)}
                    className="mt-1 block text-[0.75rem] text-text-subtle underline-offset-2 hover:text-text hover:underline"
                  >
                    Это не я — открепить
                  </button>
                )}
              </>
            ) : choices.length > 0 && own ? (
              <ChooseYourself system={system} choices={choices} own={own} />
            ) : (
              <EmptyBadge system={system} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RatingBadge({ badge }: { badge: ExternalRatingBadge }) {
  const name = RATING_SYSTEM_LABEL[badge.system];
  const asOf = badge.asOf ? formatDay(badge.asOf) : null;

  return (
    <a
      href={badge.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Рейтинг ${name}${asOf ? ` на ${asOf}` : ''} — открыть на сайте ${name}`}
      className={cn(SHELL, 'border-border bg-surface-raised shadow-sm hover:border-border-strong')}
    >
      <Logo system={badge.system} />
      <span className="flex flex-col justify-center px-3 leading-none">
        <span className="font-display text-[1.0625rem] text-text">{badge.rating}</span>
        <span className="mt-1 text-[0.6875rem] text-text-muted">
          {badge.place ? `${badge.place}-е место` : asOf ? `на ${asOf}` : 'рейтинг'}
        </span>
      </span>
    </a>
  );
}

/** Заглушка: та же плашка, приглушённая, с прочерком вместо числа. */
function EmptyBadge({ system }: { system: RatingSystem }) {
  const empty = EMPTY[system];

  return (
    <span title={empty.hint} className={cn(SHELL, 'border-dashed border-border bg-surface-sunken')}>
      <Logo system={system} muted />
      <span className="flex flex-col justify-center px-3 leading-none">
        <span aria-hidden="true" className="font-display text-[1.0625rem] text-text-subtle">
          —
        </span>
        <span className="mt-1 text-[0.6875rem] text-text-subtle">{empty.caption}</span>
      </span>
      <span className="sr-only">{empty.hint}</span>
    </span>
  );
}

/**
 * «Выберите себя» (решение владельца от 20.10.2026): под ФИО и год нашлись
 * несколько игроков — человек открывает список и отмечает «Это я!».
 */
function ChooseYourself({ system, choices, own }: { system: RatingSystem; choices: ExternalRatingChoice[]; own: OwnRatings }) {
  const disclosure = useDisclosure<HTMLDivElement>();
  const name = RATING_SYSTEM_LABEL[system];

  return (
    <div ref={disclosure.root}>
      <button
        type="button"
        {...disclosure.buttonProps}
        onClick={disclosure.toggle}
        className={cn(SHELL, 'border-dashed border-accent bg-surface-raised text-left hover:bg-surface-accent-soft')}
      >
        <Logo system={system} />
        <span className="flex flex-col justify-center px-3 leading-none">
          <span className="text-[0.8125rem] font-semibold text-text-accent">
            {choices.length === 1 ? 'Это вы?' : `Нашлось ${choices.length} — выберите себя`}
          </span>
          <span className="mt-1 text-[0.6875rem] text-text-muted">{disclosure.open ? 'свернуть ▴' : 'показать ▾'}</span>
        </span>
      </button>

      {disclosure.open && (
        <div
          id={disclosure.panelId}
          className="absolute top-full left-0 z-30 mt-2 w-[min(26rem,calc(100vw-2rem))] rounded-card border border-border bg-surface-raised p-3 shadow-lg"
        >
          <p className="mb-2 px-1 text-[0.8125rem] text-text-muted">
            В рейтинге {name} под ваши фамилию, имя и год {choices.length === 1 ? 'нашёлся игрок, которого сайт не смог закрепить сам' : 'нашлись несколько игроков'}.
            Отметьте себя — плашка будет обновляться сама.
          </p>
          <ul className="divide-y divide-border">
            {choices.map((choice) => (
              <li key={choice.externalId} className="flex items-center gap-3 px-1 py-2.5">
                <span className="min-w-0 grow">
                  <span className="block truncate text-[0.9375rem] text-text">{choice.name}</span>
                  <span className="block text-[0.8125rem] text-text-muted">
                    {[choice.city, choice.birthYear ? `${choice.birthYear} г. р.` : null, `рейтинг ${choice.rating}`]
                      .filter(Boolean)
                      .join(' · ')}{' '}
                    ·{' '}
                    <a href={choice.url} target="_blank" rel="noopener noreferrer" className="text-text-accent underline-offset-2 hover:underline">
                      на сайте {name}
                    </a>
                  </span>
                </span>
                <Button
                  size="sm"
                  pending={own.busy}
                  disabled={own.busy}
                  onClick={() => {
                    own.onClaim(system, choice.externalId);
                    disclosure.close();
                  }}
                >
                  Это я!
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Logo({ system, muted = false }: { system: RatingSystem; muted?: boolean }) {
  const logo = LOGOS[system];
  const name = RATING_SYSTEM_LABEL[system];

  return (
    // Приглушается знак, а не подложка: полупрозрачная белая подложка в
    // тёмной теме становится серым пятном.
    <span className={cn('flex min-w-[4.5rem] items-center justify-center gap-1.5 bg-white px-2.5', muted && '[&>*]:opacity-45 [&>*]:grayscale')}>
      <img src={logo.src} alt={logo.withName ? '' : name} className={logo.className} />
      {logo.withName && <span className="text-[0.8125rem] font-semibold tracking-wide text-[#2C3541]">{name}</span>}
    </span>
  );
}

/** Общая форма плашки: логотип слева на светлом, число справа. */
const SHELL = 'inline-flex h-11 items-stretch overflow-hidden rounded-control border transition-colors';

/** «2026-10-01» → «01.10.2026». */
function formatDay(day: string): string {
  const [year, month, date] = day.split('-');

  return `${date}.${month}.${year}`;
}
