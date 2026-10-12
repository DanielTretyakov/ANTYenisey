import { Controller, Get, Header, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/decorators/public.decorator';
import { webOrigin, type Env } from '../config/env';
import { escapeHtml, renderLetter, type LetterTemplate } from './letters';
import { normalizeEmail } from './mail-rules';
import { MailDispatcher } from './mail-dispatcher.job';
import { FakeMailTransport, MailTransport, type FakeSentEmail } from './mail.transport';

/** Пробные данные каждого письма — для просмотра вёрстки. */
const SAMPLES: { id: string; template: LetterTemplate; title: string; payload: unknown; news?: boolean }[] = [
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

/**
 * Отладочные маршруты поддельной почты — для смоука и просмотра вёрстки.
 * Существуют, только пока транспорт поддельный (вне production без
 * `SMTP_URL`), иначе — 404, как `dev-max`.
 */
@Public()
@Controller('dev/mail')
export class DevMailController {
  constructor(
    private readonly transport: MailTransport,
    private readonly dispatcher: MailDispatcher,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Что ушло на этот адрес, по порядку. */
  @Get('sent')
  sent(@Query('to') to = ''): FakeSentEmail[] {
    const address = normalizeEmail(to);

    return this.fake().sent.filter((email) => email.to === address);
  }

  /** Отправить очередь сейчас, не дожидаясь прохода. */
  @Post('dispatch')
  dispatch(): Promise<{ claimed: number; sent: number }> {
    this.fake();

    return this.dispatcher.runOnce();
  }

  /** Все письма на пробных данных — для владельца и для глаз. */
  @Get('preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  previewIndex(): string {
    this.fake();

    const links = SAMPLES.map(
      (sample) => `<li><a href="preview/${sample.id}">${escapeHtml(sample.title)}</a> <small>${sample.template}</small></li>`,
    ).join('');

    return `<!doctype html><meta charset="utf-8"><title>Письма КНТ</title><body style="font:16px/1.6 system-ui;padding:32px;max-width:640px;margin:auto"><h1>Письма КНТ</h1><p>Пробные данные; тёмная тема — по теме системы.</p><ul>${links}</ul></body>`;
  }

  @Get('preview/:id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  preview(@Param('id') id: string): string {
    this.fake();

    const sample = SAMPLES.find((item) => item.id === id);

    if (!sample) throw new NotFoundException();

    const origin = webOrigin({
      WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
      CORS_ORIGINS: this.config.get('CORS_ORIGINS', { infer: true }),
    });

    return renderLetter(sample.template, sample.payload, {
      webOrigin: origin,
      operator: null,
      ...(sample.news ? { unsubscribeUrl: `${origin}/unsubscribe?t=proba` } : {}),
    }).html;
  }

  private fake(): FakeMailTransport {
    if (!(this.transport instanceof FakeMailTransport)) {
      throw new NotFoundException();
    }

    return this.transport;
  }
}
