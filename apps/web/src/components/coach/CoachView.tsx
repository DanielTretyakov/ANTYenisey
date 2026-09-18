'use client';

import type { CoachProfile, CoachSocialLink, PublicCoach } from '@yenisey/types';

/**
 * Куски карточки тренера, одинаковые в трёх местах: в кабинете тренера, на
 * публичной странице и в карточке человека у администратора. Три копии
 * разошлись бы на первой же правке подписи.
 *
 * Фотографию рисует `PlayerAvatar` из профиля игрока: там ровно то же —
 * файл байтами и инициалы, пока его нет.
 */

/** Что показывать: и в карточке правки, и в публичной — одни и те же поля. */
type Card = Pick<CoachProfile | PublicCoach, 'achievements' | 'inventory' | 'priceInfo' | 'socialLinks'>;

export function coachCardEmpty(card: Card): boolean {
  return !card.achievements && !card.inventory && !card.priceInfo && card.socialLinks.length === 0;
}

/**
 * Свободный текст карточки.
 *
 * Переносы строк сохраняются: тренер перечисляет достижения по одному в
 * строку, и склеенный абзац потерял бы список.
 */
export function CoachText({ title, text }: { title: string; text: string | null }) {
  if (!text) {
    return null;
  }

  return (
    <section>
      <h3 className="mb-2 text-[0.9375rem] font-medium">{title}</h3>
      <p className="text-[0.9375rem] whitespace-pre-line break-words">{text}</p>
    </section>
  );
}

/**
 * Ссылки на соцсети.
 *
 * `rel` обязателен: страница открыта без входа, и вкладка, открытая по чужой
 * ссылке, иначе получает доступ к окну-родителю через `window.opener`.
 */
export function CoachLinks({ links }: { links: CoachSocialLink[] }) {
  if (links.length === 0) {
    return null;
  }

  return (
    <section>
      <h3 className="mb-2 text-[0.9375rem] font-medium">Контакты</h3>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {links.map((link) => (
          <li key={`${link.label}:${link.url}`} className="min-w-0">
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[0.9375rem] break-words text-text-accent underline-offset-2 hover:underline"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Карточка целиком, только для чтения. */
export function CoachCardBody({ card }: { card: Card }) {
  if (coachCardEmpty(card)) {
    return <p className="text-[0.875rem] text-text-muted">Карточка пока не заполнена.</p>;
  }

  return (
    <div className="grid gap-7">
      <CoachText title="Достижения" text={card.achievements} />
      <CoachText title="Инвентарь" text={card.inventory} />
      <CoachText title="Стоимость занятий" text={card.priceInfo} />
      <CoachLinks links={card.socialLinks} />
    </div>
  );
}
