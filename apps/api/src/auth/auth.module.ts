import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AttemptLimiter } from './attempt-limiter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { parseDuration } from './tokens';
import { UsersModule } from '../users/users.module';
import type { Env } from '../config/env';

@Module({
  // Секрет задаётся на каждый signAsync/verifyAsync отдельно: у access- и
  // refresh-токенов он разный, и общий секрет модуля здесь только мешал бы.
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Ограничитель собирается фабрикой, а не декоратором: класс намеренно
    // оставлен без метаданных Nest, чтобы его можно было импортировать в
    // `node --test` (см. attempt-limiter.ts).
    {
      provide: AttemptLimiter,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new AttemptLimiter({
          maxAttempts: config.get('AUTH_MAX_FAILED_ATTEMPTS', { infer: true }),
          windowMs: parseDuration(config.get('AUTH_ATTEMPT_WINDOW', { infer: true })),
        }),
    },
    // Оба guard'а глобальные, и порядок регистрации = порядок выполнения:
    // сначала проверяется токен, только потом роль. Обратный порядок дал бы
    // RolesGuard пустой request.user и «Недостаточно прав» вместо 401.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
