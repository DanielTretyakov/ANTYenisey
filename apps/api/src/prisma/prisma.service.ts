import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@yenisey/database';

/**
 * Единственный экземпляр Prisma-клиента на всё приложение.
 *
 * Отдельный сервис, а не `new PrismaClient()` по месту: клиент держит пул
 * соединений, и создание его в каждом модуле исчерпало бы лимит подключений
 * Postgres задолго до реальной нагрузки.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Соединение с базой установлено');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
