'use client';

import { usePathname } from 'next/navigation';
import type { Role } from '@yenisey/types';
import { NavLink } from '@/components/layout/SiteHeader';
import { roleInClub } from '@/lib/membership';
import { useSession } from '@/lib/useSession';

/**
 * Разделы одного клуба.
 *
 * Отдельно от разделов платформы («Мои записи», «Кабинет») — те у аккаунта
 * одни на все клубы, а эти зависят от роли ИМЕННО в этом клубе. Один и тот же
 * человек бывает клиентом здесь и владельцем в соседнем клубе, поэтому роль
 * спрашивается с указанием клуба, а не «вообще».
 */
const SECTIONS: { path: string; label: string; roles: Role[] }[] = [
  // Бронирует только клиент: бронь ссылается на его карточку, которой у
  // сотрудника нет. Ручная бронь администратором — отдельный сценарий ТЗ.
  { path: '/booking', label: 'Забронировать стол', roles: ['CLIENT'] },
  // У администратора здесь ОДНА ссылка, а не список разделов. Разделы живут в
  // колонке AdminShell: их шесть, они делятся на две группы с разной частотой
  // обращения, и в горизонтальной строке эта разница не выражается никак — а
  // восемь ссылок подряд вдобавок ломают неизменную высоту шапки.
  { path: '/desk', label: 'Рабочее место', roles: ['ADMIN', 'OWNER'] },
  // У тренера две ссылки, и обе горизонтальные: отдельной колонки, как у
  // администратора, они не оправдывают. Появятся статистика и спарринг —
  // тогда и колонка.
  { path: '/coach/groups', label: 'Мои группы', roles: ['COACH'] },
  // Та же страница, что у клиента, и то же бронирование — ТЗ описывает
  // спарринг именно так. Подпись другая: тренер берёт стол себе под занятие.
  { path: '/booking', label: 'Стол под спарринг', roles: ['COACH'] },
  { path: '/coach', label: 'Моя карточка', roles: ['COACH'] },
];

/**
 * Начало адреса всех страниц клуба.
 *
 * Одно место на всё приложение: клуб едет участком адреса, и собирать эту
 * строку в каждой ссылке значило бы искать их все при следующей правке схемы
 * маршрутов.
 */
export function clubPath(slug: string, path = ''): string {
  return `/clubs/${slug}${path}`;
}

export function ClubNav({ slug }: { slug: string }) {
  const session = useSession();
  const pathname = usePathname();

  // Пока сессия грузится, ничего не рисуем: место под правую группу уже
  // зарезервировано заглушкой в SiteHeader, и вторая заглушка рядом дала бы
  // полосу из серых прямоугольников во всю ширину.
  if (session.status !== 'ready') {
    return null;
  }

  // Человек без привязки к этому клубу видит то же, что клиент: записаться
  // может любой пользователь платформы, и прятать от него кнопку брони значило
  // бы закрыть единственный вход в клуб.
  const role = roleInClub(session.user, slug) ?? 'CLIENT';

  return (
    <nav className="flex items-center gap-1 sm:gap-2" aria-label="Разделы клуба">
      {SECTIONS.filter((section) => section.roles.includes(role)).map((section) => {
        const href = clubPath(slug, section.path);

        return (
          <NavLink key={section.path} href={href} active={pathname === href}>
            {section.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
