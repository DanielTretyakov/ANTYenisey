'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PersonPage } from '@/components/person/PersonPage';

/**
 * Страница тренера — открыта всем, без входа. С 26.10.2026 это раздел
 * «Тренер» общей страницы человека (`PersonPage`): рядом — «Игрок», тот же,
 * что на `/players/:id`.
 *
 * Имя — «Фамилия И.», как в списке мероприятий клуба; ни телефона, ни почты
 * сервер сюда не отдаёт.
 */
export default function CoachPage() {
  const params = useParams<{ id: string }>();

  return (
    <AppShell>
      <PersonPage id={params.id} initial="coach" />
    </AppShell>
  );
}
