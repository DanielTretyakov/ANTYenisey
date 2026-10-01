/**
 * Лента клуба: акции и объявления (решение владельца от 26.09.2026). Пишут
 * руководитель, управляющий и администратор; клиентам клуба — сообщение.
 * Текст — в разметке новостей (`parseMarkup`), как у новостей платформы.
 *
 * Первой закреплено приветствие клуба (решение от 30.09.2026): оно есть у
 * каждого клуба, собирается из данных клуба, пока клуб не напишет своё, и
 * не удаляется. Непрочитанное вошедшему подсвечивается.
 */

export interface ClubPost {
  id: string;
  title: string;
  body: string;
  /** Пусто — черновик: виден только сотрудникам в редакторе. */
  publishedAt: string | null;
  updatedAt: string;
  /** Автор — сокращённо: подпись, а не контакт. У приветствия — название клуба. */
  author: string;
  /** Закреплённое приветствие клуба. */
  welcome: boolean;
  /** Текст приветствия собирается из данных клуба (залы, часы, контакты). */
  autoBody: boolean;
  /** Вошедший ещё не открывал; анониму — всегда false. */
  unread: boolean;
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
  /**
   * Только для приветствия: true — собирать текст из данных клуба (заголовок
   * и текст запроса тогда не пишутся), false — свой текст.
   */
  auto?: boolean;
}

export interface ClubPostPage {
  /** Приветствие клуба — закреплено над лентой; скрытое — null. */
  pinned: ClubPost | null;
  items: ClubPost[];
  total: number;
  /** Непрочитанного вошедшим в этом клубе, с приветствием; анониму — 0. */
  unreadCount: number;
}

/** Отметить прочитанными — то, что человек увидел в окне новостей. */
export interface ClubPostsReadRequest {
  ids: string[];
}

/** Непрочитанное по «моим клубам» — для шапки и стартовой. */
export interface ClubPostsUnread {
  total: number;
  clubs: { slug: string; name: string; accentColor: string | null; unread: number }[];
}
