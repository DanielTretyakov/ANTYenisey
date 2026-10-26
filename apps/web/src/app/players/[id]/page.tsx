'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PersonPage } from '@/components/person/PersonPage';

/**
 * Страница игрока — открыта всем, без входа. С 26.10.2026 это раздел «Игрок»
 * общей страницы человека (`PersonPage`): у тренера рядом — «Тренер».
 *
 * Расширение сверх ТЗ (решение владельца от 12.09.2026). Имя — «Фамилия И.»,
 * как в списках записавшихся; ни телефона, ни почты, ни даты рождения сервер
 * сюда не отдаёт вовсе.
 *
 * Игрока младше четырнадцати посторонний не найдёт: сервер отвечает 404, не
 * отличая «закрыто» от «нет такого». Сам игрок и администраторы его клубов
 * видят страницу с пометкой, что она скрыта.
 */
export default function PlayerPage() {
  const params = useParams<{ id: string }>();

  return (
    <AppShell>
      <PersonPage id={params.id} initial="player" />
    </AppShell>
  );
}
