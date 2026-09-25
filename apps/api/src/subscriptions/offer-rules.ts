/**
 * Какие тарифы клуба показать тому, у кого абонементов нет: 3–5 основных и
 * максимально разных (решение владельца от 25.09.2026), остальное — по ссылке
 * на страницу клуба.
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 *
 * «Разные» — прежде всего по тому, ЧТО тариф покрывает: у клуба бывает семь
 * пакетов одного детского абонемента (8, 12, 16… визитов), и пять строк из
 * пяти про одно и то же ничего не предлагают. Поэтому сначала — по одному
 * тарифу каждого вида (самый доступный вход), потом, если место осталось, —
 * самые большие пакеты тех же видов, потом середина.
 */

export interface OfferPlan {
  id: string;
  name: string;
  visitsCount: number | null;
  durationDays: number | null;
  price: number;
  covers: string[];
}

export const OFFER_LIMIT = 5;

export function pickOffers<T extends OfferPlan>(plans: T[], limit = OFFER_LIMIT): T[] {
  // Вид тарифа — название и покрытие вместе: одноимённые тарифы с разным
  // покрытием — разные предложения.
  const groups = new Map<string, T[]>();

  for (const plan of plans) {
    const key = `${plan.name}\u0000${[...plan.covers].sort().join('|')}`;
    groups.set(key, [...(groups.get(key) ?? []), plan]);
  }

  // Внутри вида — от меньшего пакета к большему, безлимит последним; виды — от
  // самого доступного входа.
  const ordered = [...groups.values()]
    .map((group) => [...group].sort(bySize))
    .sort((a, b) => a[0]!.price - b[0]!.price);

  const picked: T[] = [];
  const take = (plan: T | undefined): void => {
    if (plan && picked.length < limit && !picked.includes(plan)) picked.push(plan);
  };

  for (const group of ordered) take(group[0]);
  for (const group of ordered) take(group.at(-1));
  for (const group of ordered) take(group[Math.floor(group.length / 2)]);

  // Порядок показа — как у видов: вид за видом, внутри — по размеру.
  return picked.sort((a, b) => {
    const groupA = ordered.findIndex((group) => group.includes(a));
    const groupB = ordered.findIndex((group) => group.includes(b));

    return groupA - groupB || bySize(a, b);
  });
}

function bySize(a: OfferPlan, b: OfferPlan): number {
  const visits = (plan: OfferPlan): number => plan.visitsCount ?? Number.MAX_SAFE_INTEGER;

  return visits(a) - visits(b) || a.price - b.price;
}
