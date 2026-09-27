/**
 * Лента клуба: акции и объявления (решение владельца от 26.09.2026). Пишут
 * руководитель, управляющий и администратор; клиентам клуба — сообщение.
 * Текст простой, абзацы — через пустую строку, как у новостей платформы.
 */

export interface ClubPost {
  id: string;
  title: string;
  body: string;
  /** Пусто — черновик: виден только сотрудникам в редакторе. */
  publishedAt: string | null;
  updatedAt: string;
  /** Автор — сокращённо: подпись, а не контакт. */
  author: string;
}

/** Публикация в ленте «из моих клубов» на стартовой — с клубом. */
export interface ClubPostWithClub extends ClubPost {
  club: { slug: string; name: string; accentColor: string | null };
}

export interface ClubPostRequest {
  title: string;
  body: string;
  /** true — опубликовано, false — черновик. Дата публикации ставится один раз. */
  published: boolean;
}

export interface ClubPostPage {
  items: ClubPost[];
  total: number;
}
