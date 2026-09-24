'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useCabinet } from '@/components/cabinet/CabinetEdit';
import { MyClubsCard } from '@/components/cabinet/MyClubsCard';
import { ProfileCard } from '@/components/cabinet/ProfileCard';
import { FIRST_SECTION, isSection, sectionsFor } from '@/components/cabinet/sections';
import { ChildFamilyCard, ParentFamilyCard } from '@/components/family/FamilyCards';
import { NotificationsCard } from '@/components/notifications/NotificationsCard';
import { PlayerEditor } from '@/components/player/PlayerEditor';
import { MySubscriptions } from '@/components/subscriptions/MySubscriptions';
import { canBeGuardianBirthDate, isChildBirthDate } from '@/lib/family';

/**
 * Один раздел редактора кабинета.
 *
 * Списка записей здесь нет — он в «Моих записях» целиком (ТЗ → «Мои записи»):
 * два списка записей в двух местах разошлись бы в поведении отмены. Роли в
 * профиле тоже нет: она свойство пары «человек + клуб», её видно в «Моих
 * клубах».
 *
 * Карточки разделов несут свой верхний отступ — из тех времён, когда они
 * стояли друг под другом; здесь он снимается обёрткой.
 */
export default function CabinetSectionPage() {
  const router = useRouter();
  const params = useParams<{ section: string }>();
  const { user, family } = useCabinet();

  const known = isSection(params.section) && sectionsFor(user).some((item) => item.id === params.section);

  useEffect(() => {
    if (!known) router.replace(`/cabinet/edit/${FIRST_SECTION}`);
  }, [known, router]);

  if (!known) return null;

  const child = family.selected;
  const name = child?.fullName ?? user.fullName;
  // Ребёнок младше 16 смотрит свой профиль, а правит его родитель.
  const readOnly = child === null && isChildBirthDate(user.birthDate);
  const section = params.section;

  return (
    <div className="[&>*:first-child]:mt-0">
      {(section === 'avatar' || section === 'equipment' || section === 'rank' || section === 'achievements') && (
        <PlayerEditor
          key={`${section}:${child?.id ?? 'self'}`}
          section={section}
          name={name}
          forPerson={child?.id ?? null}
          readOnly={readOnly}
        />
      )}

      {section === 'subscriptions' && (
        <MySubscriptions key={`subscriptions:${child?.id ?? 'self'}`} forPerson={child?.id ?? null} />
      )}

      {section === 'family' && canBeGuardianBirthDate(user.birthDate) && (
        <ParentFamilyCard
          user={user}
          kids={family.children}
          onChanged={family.reload}
          onOpenProfile={(childId) => router.push(`/cabinet?for=${childId}`)}
        />
      )}

      {section === 'family' && isChildBirthDate(user.birthDate) && <ChildFamilyCard />}

      {section === 'clubs' && <MyClubsCard user={user} />}

      {/* Уведомления — свои у каждого, в том числе у ребёнка: это его учётка
          и его сообщения. Переключатель «за ребёнка» их поэтому не меняет. */}
      {section === 'notifications' && <NotificationsCard />}

      {section === 'profile' && <ProfileCard user={user} />}
    </div>
  );
}
