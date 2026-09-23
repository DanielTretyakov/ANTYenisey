import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { shortName } from '@yenisey/types';
import { webOrigin, type Env } from '../config/env';
import { MaxLinkService } from './max-link.service';
import { isLinkToken, parseCommand, parseUpdate } from './max-rules';
import { MaxTransport } from './max.transport';

/**
 * Что бот делает с событиями MAX.
 *
 * Бот только сообщает (решение владельца от 23.09.2026): здесь нет ни записи,
 * ни отметки, ни денег — только привязка, остановка и подсказка, где что
 * настраивается. Ответы уходят сразу, мимо очереди: это реакция на действие
 * самого человека, и ждать её десять секунд было бы странно.
 *
 * События приходят двумя путями — вебхуком на стенде и опросом в разработке,
 * — и оба ведут сюда.
 */
@Injectable()
export class MaxBotService {
  private readonly logger = new Logger(MaxBotService.name);

  constructor(
    private readonly links: MaxLinkService,
    private readonly transport: MaxTransport,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async handle(raw: unknown): Promise<void> {
    const event = parseUpdate(raw);

    if (!event) {
      return;
    }

    switch (event.kind) {
      case 'started': {
        if (event.payload && isLinkToken(event.payload)) {
          const result = await this.links.consume(event.payload, event.maxUserId);

          await this.reply(
            event.maxUserId,
            result.ok
              ? [
                  result.replaced ? 'Этот MAX был привязан к другой учётке — теперь он привязан к вашей.' : null,
                  `Готово: уведомления «Енисея» для учётки ${shortName(result.fullName)} будут приходить сюда.`,
                  'Что присылать, настраивается в личном кабинете. Отключить — команда /stop.',
                ]
                  .filter(Boolean)
                  .join('\n\n')
              : 'Ссылка устарела или уже использована. Откройте личный кабинет и нажмите «Подключить MAX» ещё раз.',
            !result.ok,
          );
          return;
        }

        // Запуск без ссылки: вернулся тот, кто останавливал бота, — или новый
        // человек, которому нужно объяснить, откуда берётся привязка.
        const link = await this.links.findByMaxUser(event.maxUserId);

        if (link) {
          await this.links.markStarted(event.maxUserId);
          await this.reply(event.maxUserId, `Уведомления для учётки ${shortName(link.fullName)} снова включены.`);
        } else {
          await this.reply(event.maxUserId, this.helpText(false), true);
        }
        return;
      }

      case 'stopped':
        // Ответить некуда: человек бота остановил. Привязка остаётся и оживёт,
        // когда он запустит бота снова.
        await this.links.markStopped(event.maxUserId);
        return;

      case 'message': {
        const command = parseCommand(event.text);

        if (command.name === 'stop') {
          const removed = await this.links.unlinkMaxUser(event.maxUserId);

          await this.reply(
            event.maxUserId,
            removed
              ? 'Уведомления отключены, привязка к учётке снята. Подключить снова можно в личном кабинете.'
              : 'Этот MAX ни к какой учётке не привязан.',
          );
          return;
        }

        const link = await this.links.findByMaxUser(event.maxUserId);
        await this.reply(event.maxUserId, this.helpText(link !== null), true);
        return;
      }
    }
  }

  private helpText(linked: boolean): string {
    return linked
      ? 'Это бот уведомлений «Енисея»: сюда приходят напоминания и новости клуба. Настроить, что присылать, — в личном кабинете. Отключить — команда /stop.'
      : 'Это бот уведомлений «Енисея». Чтобы получать напоминания о записях, откройте личный кабинет на сайте и нажмите «Подключить MAX».';
  }

  private async reply(maxUserId: bigint, text: string, withCabinetLink = false): Promise<void> {
    const origin = webOrigin({
      WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
      CORS_ORIGINS: this.config.get('CORS_ORIGINS', { infer: true }),
    });

    const outcome = await this.transport.send({
      maxUserId,
      text,
      link: withCabinetLink ? { label: 'Личный кабинет', url: `${origin}/cabinet#notifications` } : undefined,
    });

    if (outcome.kind !== 'sent') {
      this.logger.warn(`Ответ бота не ушёл: ${outcome.error}`);
    }
  }
}
