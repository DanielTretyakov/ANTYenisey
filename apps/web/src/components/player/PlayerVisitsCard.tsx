import Link from 'next/link';
import type { ClubVisits, PlayerVisitTops } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { plural } from '@/lib/plural';

const PERIODS: { key: 'month' | 'year' | 'all'; label: string }[] = [
  { key: 'month', label: 'В этом месяце' },
  { key: 'year', label: 'В этом году' },
  { key: 'all', label: 'За всё время' },
];

/**
 * «Больше всего посещений» (решение владельца от 30.09.2026): три клуба, где
 * игрок бывал чаще всего, за месяц, год и всё время. Во всю ширину страницы —
 * под инвентарём и достижениями.
 *
 * Визит — день с отметкой «пришёл», как в рейтинге клуба: клубы считают его
 * одинаково, и число здесь сходится с местом в рейтинге.
 */
export function PlayerVisitsCard({ visits }: { visits: PlayerVisitTops }) {
  const empty = visits.all.length === 0;

  return (
    <Card>
      <CardHeader
        title="Больше всего посещений"
        description="Клубы, где игрок бывает чаще всего. Визит — день, когда клуб отметил приход."
      />
      <CardBody>
        {visits.hiddenFromOthers && (
          <p className="mb-4 rounded-control bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] text-text-muted">
            Другие этот блок не видят: вы скрыли себя из рейтингов посещений.
          </p>
        )}

        {empty ? (
          <p className="text-[0.875rem] text-text-muted">
            Посещений пока нет — они появятся, когда клуб отметит приход.
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-3 sm:gap-5">
            {PERIODS.map((period) => (
              <section key={period.key} className="min-w-0">
                <h3 className="mb-3 text-[0.75rem] font-medium tracking-[0.08em] text-text-subtle uppercase">
                  {period.label}
                </h3>
                {visits[period.key].length === 0 ? (
                  <p className="text-[0.875rem] text-text-muted">Визитов не было.</p>
                ) : (
                  <ol className="grid gap-2.5">
                    {visits[period.key].map((club) => (
                      <VisitRow key={club.slug} club={club} />
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function VisitRow({ club }: { club: ClubVisits }) {
  return (
    <li>
      <Link
        href={`/clubs/${club.slug}`}
        className="group flex items-center gap-3 rounded-control border border-border px-3 py-2.5 transition-colors hover:border-border-strong"
      >
        <span className="w-4 shrink-0 text-center font-display text-[0.9375rem] text-text-subtle tabular-nums">
          {club.place}
        </span>
        <ClubMark club={club} size="sm" />
        <span className="min-w-0 grow">
          <span className="block truncate text-[0.9375rem] text-text group-hover:underline">{club.name}</span>
          <span className="block text-[0.8125rem] text-text-muted">
            {club.visits} {plural(club.visits, 'визит', 'визита', 'визитов')}
          </span>
        </span>
      </Link>
    </li>
  );
}
