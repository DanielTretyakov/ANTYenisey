import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { validateEnv } from './config/env';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // .env лежит в корне монорепозитория: одна копия секретов на api и web,
      // а не две расходящиеся.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    TenantsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
