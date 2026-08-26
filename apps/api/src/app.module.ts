import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { ClubModule } from './club/club.module';
import { parseDuration } from './auth/tokens';
import { isLoopback } from './common/network';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { validateEnv, type Env } from './config/env';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // .env лежит в корне монорепозитория: одна копия секретов на api и web,
      // а не две расходящиеся.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    /**
     * Грубое ограничение частоты на весь API: защита от заваливания запросами.
     * Подбор пароля оно не ловит — этим занимается AttemptLimiter, который
     * считает провалы по учётке, а не запросы по адресу.
     */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl: parseDuration(config.get('RATE_LIMIT_WINDOW', { infer: true })),
            limit: config.get('RATE_LIMIT', { infer: true }),
          },
        ],
        errorMessage: 'Слишком много запросов, попробуйте позже',
        skipIf: (context: ExecutionContext) => {
          if (config.get('NODE_ENV', { infer: true }) === 'production') {
            return false;
          }

          const request = context.switchToHttp().getRequest<Request>();
          return isLoopback(request.ip);
        },
      }),
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    ClubModule,
    TenantsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
