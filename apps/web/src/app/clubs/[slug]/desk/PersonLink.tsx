'use client';

import Link from 'next/link';
import { useClubSlug } from '@/lib/useClubApi';

/**
 * Имя человека на экране смены — ссылка на его карточку.
 *
 * Отметка и звонок начинаются с вопроса «а кто это»: сколько раз не приходил,
 * когда был в последний раз. Раньше ответа на экране не было вовсе, и
 * администратор шёл искать человека в составе клуба руками.
 *
 * Спарринг ссылки не получает: у брони тренера клиента нет, и `userId` там
 * пустой (см. `personOf` в desk.service.ts).
 */
export function PersonLink({ userId, children }: { userId: string; children: string }) {
  const slug = useClubSlug();

  if (!userId) {
    return <>{children}</>;
  }

  return (
    <Link
      href={`/clubs/${slug}/people/${userId}`}
      className="underline-offset-2 hover:text-text-accent hover:underline"
    >
      {children}
    </Link>
  );
}
