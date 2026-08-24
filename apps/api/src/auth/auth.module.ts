import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { UsersModule } from '../users/users.module';

@Module({
  // Секрет задаётся на каждый signAsync/verifyAsync отдельно: у access- и
  // refresh-токенов он разный, и общий секрет модуля здесь только мешал бы.
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Оба guard'а глобальные, и порядок регистрации = порядок выполнения:
    // сначала проверяется токен, только потом роль. Обратный порядок дал бы
    // RolesGuard пустой request.user и «Недостаточно прав» вместо 401.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
