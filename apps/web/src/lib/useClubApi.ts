'use client';

import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { clubApi } from './api';
import { TENANT_SLUG } from './config';

/**
 * Код клуба текущей страницы — из адреса.
 *
 * Все клубные страницы живут под `/clubs/[slug]/...`, поэтому спрашивать его у
 * маршрута надёжнее, чем передавать пропсом: вложенные карточки настроек и
 * формы иначе получали бы его через три уровня компонентов ради одной строки
 * в запросе.
 *
 * Запасное значение из окружения оставлено для разработки: без него страница,
 * случайно оказавшаяся вне `/clubs/[slug]`, падала бы на пустом адресе вместо
 * внятного ответа сервера.
 */
export function useClubSlug(): string {
  const params = useParams<{ slug?: string }>();

  return params?.slug ?? TENANT_SLUG;
}

/**
 * Клиент API, привязанный к клубу текущей страницы.
 *
 * Мемоизирован по коду клуба: без этого каждый рендер создавал бы новый объект
 * и всякий `useEffect`, зависящий от него, уходил бы в бесконечный цикл.
 */
export function useClubApi(): ReturnType<typeof clubApi> {
  const slug = useClubSlug();

  return useMemo(() => clubApi(slug), [slug]);
}
