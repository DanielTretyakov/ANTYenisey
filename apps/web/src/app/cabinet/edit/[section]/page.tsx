'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useCabinet } from '@/components/cabinet/CabinetEdit';
import { MyClubsCard } from '@/components/cabinet/MyClubsCard';
import { PersonalDataCard } from '@/components/cabinet/PersonalDataCard';
import { FIRST_SECTION, isSection } from '@/components/cabinet/sections';
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
 * стояли друг под другом; у первой он снимается обёрткой.
 */
export default function CabinetSectionPage() {
  const router = useRouter();
  const params = useParams<{ section: string }>();
  const { user, family } = useCabinet();

  const known = isSection(params.section);

  useEffect(() => {
    if (!known) router.replace(`/cabinet/edit/${FIRST_SECTION}`);
  }, [known, router]);

  if (!known) return null;

  const child = family.selected;
  const forPerson = child?.id ?? null;
  const section = params.section;

  return (
    <div className="grid gap-6 [&>*]:mt-0">
      {section === 'profile' && <PersonalDataCard user={user} />}

      {section === 'player' && (
        <PlayerEditor
          key={`player:${forPerson ?? 'self'}`}
          sections={['avatar', 'equipment', 'rank', 'achievements']}
          name={child?.fullName ?? user.fullName}
          forPerson={forPerson}
          // Ребёнок младше 14 смотрит свой профиль, а правит его родитель.
          readOnly={child === null && isChildBirthDate(user.birthDate)}
        />
      )}

      {section === 'subscriptions' && <MySubscriptions key={`subscriptions:${forPerson ?? 'self'}`} forPerson={forPerson} />}

      {section === 'clubs' && (
        <>
          <MyClubsCard user={user} />

          {canBeGuardianBirthDate(user.birthDate) && (
            <ParentFamilyCard
              user={user}
              kids={family.children}
              onChanged={family.reload}
              onOpenProfile={(childId) => router.push(`/cabinet?for=${childId}`)}
            />
          )}

          {isChildBirthDate(user.birthDate) && <ChildFamilyCard />}
        </>
      )}

      {/* Уведомления — свои у каждого, в том числе у ребёнка: это его учётка
          и его сообщения. Переключатель «за ребёнка» их поэтому не меняет. */}
      {section === 'notifications' && <NotificationsCard />}
    </div>
  );
}
