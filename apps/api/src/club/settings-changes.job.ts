import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { SettingsChangesService } from './settings-changes.service';

/** Раз в минуту: полночь зала наступает в своё время, и опоздать больше чем на минуту незачем. */
const INTERVAL = 60_000;

/** Первый проход — когда приложение уже отвечает. */
const FIRST_RUN_DELAY = 5_000;

/**
 * Применяет отложенные правки настроек, у которых наступила полночь
 * (решение владельца от 26.09.2026).
 *
 * Включена всегда, и в разработке тоже: в отличие от автонеявки, она не
 * трогает чужие записи — пишет только то, что администратор сам сохранил и
 * чему пришёл срок. Цепочка `setTimeout`, как у `AutoNoShowJob`: проходы не
 * накладываются, а второй экземпляр API пропустит строку, которую держит
 * первый (`FOR UPDATE SKIP LOCKED`).
 */
@Injectable()
export class SettingsChangesJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SettingsChangesJob.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly changes: SettingsChangesService) {}

  onApplicationBootstrap(): void {
    this.schedule(FIRST_RUN_DELAY);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    await this.running;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.running = this.changes
        .applyDue()
        .then(({ applied, failed }) => {
          if (applied + failed > 0) {
            this.logger.log(`Правки настроек: применено ${applied}, не применилось ${failed}`);
          }
        })
        .catch((error: unknown) => {
          this.logger.error(`Проход правок настроек упал: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          if (!this.stopped) {
            this.schedule(INTERVAL);
          }
        });
    }, delay);
  }
}
