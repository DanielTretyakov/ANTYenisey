import type { PublicPlan } from '@yenisey/types';
import { formatKopecks } from '@/lib/money';
import { plural } from '@/lib/plural';

/**
 * Тарифы клуба строками: название, условия, покрытие, цена.
 *
 * Один список на два места — предложение в кабинете у того, у кого абонементов
 * нет, и блок «Абонементы» на странице клуба, куда ведёт «Больше абонементов».
 * Две вёрстки одного прайса разошлись бы на первой правке.
 */
export function PlanList({ plans }: { plans: PublicPlan[] }) {
  return (
    <ul className="divide-y divide-border rounded-control border border-border bg-surface-raised">
      {plans.map((plan) => (
        <li key={plan.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
          <span className="min-w-0 grow">
            <span className="block text-[0.9375rem] text-text">{plan.name}</span>
            <span className="block text-[0.8125rem] text-text-muted">
              {planTerms(plan)}
              {plan.covers.length > 0 && ` · ${plan.covers.join(', ')}`}
            </span>
          </span>
          <span className="text-[0.9375rem] whitespace-nowrap text-text">{formatKopecks(plan.price)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Полный прайс клуба по видам: название и покрытие — один раз, под ними
 * пакеты плитками «8 визитов · бессрочно — 4 000 ₽». У клуба бывает десять
 * пакетов одного абонемента, и десять одинаковых названий подряд прайс не
 * читается. Вид — название вместе с покрытием, как в отборе `pickOffers`.
 */
export function PlanGroups({ plans }: { plans: PublicPlan[] }) {
  const groups = new Map<string, PublicPlan[]>();

  for (const plan of plans) {
    const key = `${plan.name}\u0000${[...plan.covers].sort().join('|')}`;
    groups.set(key, [...(groups.get(key) ?? []), plan]);
  }

  return (
    <div className="grid gap-4">
      {[...groups.entries()].map(([key, group]) => (
        <section key={key} className="rounded-card border border-border bg-surface-raised px-5 py-4">
          <h3 className="text-[0.9375rem] font-medium">{group[0]!.name}</h3>
          {group[0]!.covers.length > 0 && (
            <p className="mt-0.5 text-[0.8125rem] text-text-muted">{group[0]!.covers.join(', ')}</p>
          )}

          <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2">
            {group.map((plan) => (
              <li key={plan.id} className="rounded-control border border-border px-3 py-2">
                <span className="block text-[0.8125rem] text-text-muted">{planTerms(plan)}</span>
                <span className="block text-[0.9375rem] text-text">{formatKopecks(plan.price)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Якорь блока «Абонементы» на странице клуба — цель ссылки из кабинета. */
export const PLANS_ANCHOR = 'abonementy';

/** «8 визитов · 30 дней», «безлимит · бессрочно». */
export function planTerms(plan: PublicPlan): string {
  const visits =
    plan.visitsCount === null ? 'безлимит' : `${plan.visitsCount} ${plural(plan.visitsCount, 'визит', 'визита', 'визитов')}`;
  const days =
    plan.durationDays === null ? 'бессрочно' : `${plan.durationDays} ${plural(plan.durationDays, 'день', 'дня', 'дней')}`;

  return `${visits} · ${days}`;
}
