import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { HelpIndex } from './HelpIndex';

export const metadata: Metadata = { title: 'Помощь' };

/**
 * Справка платформы (решение владельца от 02.10.2026): открыта без входа,
 * по ролям, статья — ответ на один вопрос. Статьи для клуба тоже открыты:
 * секретов там нет, а будущему клубу это витрина продукта.
 */
export default function HelpPage() {
  return (
    <AppShell>
      <HelpIndex />
    </AppShell>
  );
}
