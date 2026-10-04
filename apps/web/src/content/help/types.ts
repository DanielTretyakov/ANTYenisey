import type { ReactNode } from 'react';

/** Для кого статья — вкладки оглавления справки. */
export type HelpAudience = 'players' | 'parents' | 'coaches' | 'clubs';

export const HELP_AUDIENCES: { id: HelpAudience; label: string; lead: string }[] = [
  { id: 'players', label: 'Игрокам', lead: 'Найти клуб, записаться, забронировать стол, отменить и не переплатить.' },
  { id: 'parents', label: 'Родителям', lead: 'Как вести ребёнка до 14 лет: учётка, запись, отмена.' },
  { id: 'coaches', label: 'Тренерам', lead: 'Карточка, группы, спарринги и статистика.' },
  {
    id: 'clubs',
    label: 'Клубу',
    lead: 'Администратору, управляющему и руководителю: смена, расписание, люди, абонементы, настройки.',
  },
];

/**
 * Статья справки — ответ на один вопрос. Заголовок — сам вопрос, так, как его
 * задаёт человек; `keywords` — слова, которыми его ищут, если в заголовке
 * их нет.
 */
export interface HelpArticle {
  slug: string;
  audience: HelpAudience;
  title: string;
  summary: string;
  keywords: string[];
  body: ReactNode;
  /** «См. также» — адреса других статей. */
  related?: string[];
}
