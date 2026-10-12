import type { LetterTemplate } from './letters';

/**
 * Пробные данные каждого письма — для просмотра вёрстки: их рисуют
 * `/api/dev/mail/preview` и файл `docs/mail-examples.html`
 * (`pnpm --filter @yenisey/api mail:gallery`). Импорт выше — только тип,
 * поэтому модуль годится и для `node --experimental-strip-types`.
 */
export const LETTER_SAMPLES: { id: string; template: LetterTemplate; title: string; payload: unknown; news?: boolean }[] = [
  { id: 'verify', template: 'VERIFY_EMAIL', title: 'Подтверждение почты', payload: { name: 'Иванов Пётр Сергеевич', token: 'proba' } },
  { id: 'reset', template: 'PASSWORD_RESET', title: 'Восстановление пароля', payload: { name: 'Иванов Пётр Сергеевич', token: 'proba' } },
  {
    id: 'password-changed',
    template: 'PASSWORD_CHANGED',
    title: 'Пароль изменён',
    payload: { name: 'Иванов Пётр Сергеевич', at: '2026-10-12T11:30:00.000Z', timezone: 'Asia/Krasnoyarsk' },
  },
  { id: 'application', template: 'APPLICATION_RECEIVED', title: 'Заявка клуба получена', payload: { contactName: 'Сидорова Анна Викторовна', clubName: 'КНТ «Столбы»' } },
  { id: 'club-created', template: 'CLUB_CREATED', title: 'Клуб заведён', payload: { name: 'Сидорова Анна Викторовна', clubName: 'КНТ «Столбы»', slug: 'stolby' } },
  {
    id: 'subscription-reminder',
    template: 'SUBSCRIPTION',
    title: 'Подписка: напоминание',
    payload: { variant: 'REMINDER', club: 'КНТ «Столбы»', slug: 'stolby', timezone: 'Asia/Krasnoyarsk', until: '2026-10-19T17:00:00.000Z', trial: true },
  },
  {
    id: 'subscription-past-due',
    template: 'SUBSCRIPTION',
    title: 'Подписка: не оплачена',
    payload: { variant: 'PAST_DUE', club: 'КНТ «Столбы»', slug: 'stolby', timezone: 'Asia/Krasnoyarsk', until: '2026-10-22T17:00:00.000Z' },
  },
  {
    id: 'subscription-paid',
    template: 'SUBSCRIPTION',
    title: 'Подписка: оплачена',
    payload: { variant: 'PAID', club: 'КНТ «Столбы»', slug: 'stolby', timezone: 'Asia/Krasnoyarsk', until: '2026-11-19T17:00:00.000Z', plan: 'Месяц', amount: 290_000 },
  },
  {
    id: 'invoice',
    template: 'BILLING_DOCUMENT',
    title: 'Счёт на оплату',
    payload: { kind: 'INVOICE', club: 'КНТ «Столбы»', slug: 'stolby', documentId: 'proba', number: 'КНТ-2026-0042', amount: 290_000 },
  },
  {
    id: 'act',
    template: 'BILLING_DOCUMENT',
    title: 'Акт за месяц',
    payload: { kind: 'ACT', club: 'КНТ «Столбы»', slug: 'stolby', documentId: 'proba', number: 'КНТ-А-2026-0031', amount: 290_000, period: 'сентябрь 2026' },
  },
  {
    id: 'news',
    template: 'NEWS',
    title: 'Новость платформы',
    news: true,
    payload: {
      newsId: 'proba',
      section: 'UPDATES',
      title: 'Быстрая бронь и карточки клубов',
      body: 'Забронировать стол стало проще: над сеткой появился блок **«Быстро: когда и сколько»**.\n\n- выберите начало и длительность;\n- нажмите свободный стол;\n- если всё занято, сайт предложит ближайшее время.\n\nВ карточках клубов на стартовой теперь видно цену стола, *открыто ли сейчас* и ближайшее мероприятие.',
    },
  },
  {
    id: 'news-clubs',
    template: 'NEWS',
    title: 'Новость для клубов',
    news: true,
    payload: {
      newsId: 'proba',
      section: 'CLUBS',
      title: 'Права сотрудников: деньги — у руководства',
      body: 'Цены, процент неявки и удаление залов теперь меняют только руководитель и управляющий. Администратор правит отмеченные ему залы.',
    },
  },
];
