import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { parseCorsOrigins, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('api');

  // Потолок тела — 2 МБ вместо 100 КБ по умолчанию у Express. Шаблон недели
  // уходит одним запросом, и у зала на восемь столов с почасовыми окнами это
  // уже шестьсот окон и 130 КБ: сохранение отвечало 413, а сетка — «Сервис
  // недоступен» (поймано 05.10.2026). Число окон ограничивает сам DTO.
  app.useBodyParser('json', { limit: '2mb' });

  // Refresh-токен приезжает в httpOnly-куке, и без разбора заголовка Cookie
  // request.cookies остаётся undefined — обновление сессии молча ломается.
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      // Отрезает поля, которых нет в DTO. Без этого клиент может дослать
      // `role: "OWNER"` в форму регистрации, и оно доедет до Prisma.
      whitelist: true,
      forbidNonWhitelisted: true,
      // Тело запроса приходит как plain object; без transform декораторы
      // @Transform в DTO не применяются и email не приводится к нижнему
      // регистру.
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableCors({
    origin: parseCorsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
  });

  // Доверяем одному прокси перед приложением (nginx на VPS). Без этого
  // request.ip у всех запросов равен адресу прокси; с `true` вместо `1` —
  // наоборот, X-Forwarded-For начинает подделываться клиентом.
  app.set('trust proxy', 1);

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);

  Logger.log(`API слушает http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
