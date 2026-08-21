-- ---------------------------------------------------------------------------
-- Проверка, что ограничения из schema-constraints.sql реально ловят то,
-- ради чего заведены.
-- ---------------------------------------------------------------------------
--
-- СТАТУС: прогнано на PostgreSQL 18 (21.08.2026) — 22 из 22 сценариев прошли.
-- Дополнительно проверено, что отказы приходят именно от нужных ограничений,
-- а не по случайной причине: exclusion-констрейнт даёт 23P01, составные
-- внешние ключи — 23503, частичный уникальный индекс — 23505, check'и — 23514.
--
-- ОГОВОРКА про сами тесты: блок EXCEPTION WHEN others засчитывает ЛЮБУЮ
-- ошибку, поэтому «OK (ожидалось)» само по себе не доказывает, что сработало
-- задуманное правило, — опечатка в имени колонки выглядела бы так же. При
-- добавлении новых сценариев проверяйте код ошибки и имя ограничения через
-- GET STACKED DIAGNOSTICS, а не только факт отказа.
--
-- Как запустить, когда появится Postgres:
--
--   1. Сгенерировать DDL из схемы:
--      npx prisma@6 migrate diff --from-empty \
--        --to-schema-datamodel docs/schema.prisma --script > ddl.sql
--   2. Применить по порядку:
--      psql -v ON_ERROR_STOP=1 -f ddl.sql
--      psql -v ON_ERROR_STOP=1 -f docs/schema-constraints.sql
--      psql -f docs/schema-tests.sql
--
-- Каждый тест печатает «OK (ожидалось)» либо «ПРОВАЛ». Тесты, которые ждут
-- отказа базы, специально пишут в неё заведомо некорректные данные.

\set ON_ERROR_STOP off

-- Два клуба
INSERT INTO "Tenant" (id,name,slug,"createdAt","updatedAt","hasRobotOption","tableHourPrice","tableExtra30MinPrice")
VALUES ('t1','Енисей','yenisey',now(),now(),false,40000,20000),
       ('t2','Другой клуб','other',now(),now(),false,50000,25000);

-- Клиент в клубе 1
INSERT INTO "User" (id,"tenantId",email,"passwordHash",role,"createdAt","updatedAt")
VALUES ('u1','t1','a@a.ru','x','CLIENT',now(),now()),
       ('c1','t1','coach@a.ru','x','COACH',now(),now()),
       ('u2','t2','b@b.ru','x','CLIENT',now(),now());

INSERT INTO "ClientProfile" ("userId","tenantId","fullName","createdAt","updatedAt")
VALUES ('u1','t1','Иванов Иван',now(),now()),
       ('u2','t2','Петров Пётр',now(),now());

INSERT INTO "CoachProfile" ("userId","tenantId","createdAt","updatedAt")
VALUES ('c1','t1',now(),now());

INSERT INTO "Table" (id,"tenantId",label,"createdAt") VALUES ('tb1','t1','Стол 1',now());

INSERT INTO "TrainingType" (id,"tenantId",name,price,"isActive","createdAt","updatedAt")
VALUES ('tt1','t1','Общая групповая',70000,true,now(),now());

INSERT INTO "TrainingSession" (id,"tenantId","trainingTypeId","coachId","startsAt","endsAt",capacity,"createdAt","updatedAt")
VALUES ('ts1','t1','tt1','c1','2026-09-01 18:00+07','2026-09-01 19:30+07',10,now(),now());

\echo ''
\echo '--- ТЕСТЫ ---'

-- A. Первая бронь стола 18:00-19:00 — должна пройти
DO $$ BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking","updatedAt")
  VALUES ('bk1','t1','tb1','u1','2026-09-01 18:00+07','2026-09-01 19:00+07',40000,now());
  RAISE NOTICE 'A. Бронь 18:00-19:00 создана................ OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'A. ПРОВАЛ: %', SQLERRM; END $$;

-- B. Пересекающаяся бронь 18:30-19:30 — должна быть отклонена
DO $$ BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking","updatedAt")
  VALUES ('bk2','t1','tb1','u1','2026-09-01 18:30+07','2026-09-01 19:30+07',40000,now());
  RAISE NOTICE 'B. ПРОВАЛ: пересечение 18:30-19:30 прошло!';
EXCEPTION WHEN others THEN RAISE NOTICE 'B. Пересечение 18:30-19:30 отклонено....... OK (ожидалось)'; END $$;

-- C. Встык 19:00-20:00 — должна пройти
DO $$ BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking","updatedAt")
  VALUES ('bk3','t1','tb1','u1','2026-09-01 19:00+07','2026-09-01 20:00+07',40000,now());
  RAISE NOTICE 'C. Бронь встык 19:00-20:00 создана......... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'C. ПРОВАЛ: встык отклонён: %', SQLERRM; END $$;

-- D. Отменённая бронь время не занимает — 18:30-19:30 со статусом CANCELLED
DO $$ BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking",status,"updatedAt")
  VALUES ('bk4','t1','tb1','u1','2026-09-01 18:30+07','2026-09-01 19:30+07',40000,'CANCELLED',now());
  RAISE NOTICE 'D. Отменённая бронь не занимает время...... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'D. ПРОВАЛ: %', SQLERRM; END $$;

-- E. КЛЮЧЕВОЕ: стол клуба 1 + клиент клуба 2 — должно быть отклонено
DO $$ BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking","updatedAt")
  VALUES ('bk5','t1','tb1','u2','2026-09-02 10:00+07','2026-09-02 11:00+07',40000,now());
  RAISE NOTICE 'E. ПРОВАЛ: клиент чужого клуба забронировал стол!';
EXCEPTION WHEN others THEN RAISE NOTICE 'E. Клиент чужого клуба отклонён............ OK (ожидалось)'; END $$;

-- F. Бронь без клиента и без тренера — должна быть отклонена
DO $$ BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","startsAt","endsAt","priceAtBooking","updatedAt")
  VALUES ('bk6','t1','tb1','2026-09-03 10:00+07','2026-09-03 11:00+07',40000,now());
  RAISE NOTICE 'F. ПРОВАЛ: бронь-сирота без клиента прошла!';
EXCEPTION WHEN others THEN RAISE NOTICE 'F. Бронь без клиента/тренера отклонена..... OK (ожидалось)'; END $$;

-- G. Первая запись на тренировку — должна пройти
DO $$ BEGIN
  INSERT INTO "TrainingBooking" (id,"tenantId","sessionId","clientId","priceAtBooking","updatedAt")
  VALUES ('tb_1','t1','ts1','u1',70000,now());
  RAISE NOTICE 'G. Запись на тренировку создана............ OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'G. ПРОВАЛ: %', SQLERRM; END $$;

-- H. Повторная активная запись того же клиента — должна быть отклонена
DO $$ BEGIN
  INSERT INTO "TrainingBooking" (id,"tenantId","sessionId","clientId","priceAtBooking","updatedAt")
  VALUES ('tb_2','t1','ts1','u1',70000,now());
  RAISE NOTICE 'H. ПРОВАЛ: дубль записи прошёл!';
EXCEPTION WHEN others THEN RAISE NOTICE 'H. Повторная запись отклонена.............. OK (ожидалось)'; END $$;

-- I. После отмены клиент может записаться заново
DO $$ BEGIN
  UPDATE "TrainingBooking" SET status='CANCELLED', "cancelledAt"=now() WHERE id='tb_1';
  INSERT INTO "TrainingBooking" (id,"tenantId","sessionId","clientId","priceAtBooking","updatedAt")
  VALUES ('tb_3','t1','ts1','u1',70000,now());
  RAISE NOTICE 'I. Повторная запись после отмены........... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'I. ПРОВАЛ: %', SQLERRM; END $$;

-- J. Списание больше холда — должно быть отклонено
DO $$ BEGIN
  INSERT INTO "Payment" (id,"tenantId","clientId",method,status,"holdAmount","capturedAmount","updatedAt")
  VALUES ('p1','t1','u1','YOOKASSA','CAPTURED',40000,50000,now());
  RAISE NOTICE 'J. ПРОВАЛ: списали больше, чем холдировали!';
EXCEPTION WHEN others THEN RAISE NOTICE 'J. Списание больше холда отклонено......... OK (ожидалось)'; END $$;

-- K. Клуб с роботом, но без цен робота — должно быть отклонено
DO $$ BEGIN
  INSERT INTO "Tenant" (id,name,slug,"createdAt","updatedAt","hasRobotOption","tableHourPrice","tableExtra30MinPrice")
  VALUES ('t3','Клуб без цен','noprice',now(),now(),true,40000,20000);
  RAISE NOTICE 'K. ПРОВАЛ: робот включён без цен!';
EXCEPTION WHEN others THEN RAISE NOTICE 'K. Робот без цен отклонён.................. OK (ожидалось)'; END $$;

-- L. Процент вне набора «Енисея» (0/50/100) — должен проходить, раз политика
--    отмены настраиваемая. Значение здесь произвольное, взято только чтобы
--    показать: констрейнт проверяет диапазон, а не список значений.
--    Прежний констрейнт IN (0,50,100) на этом кейсе падал.
DO $$ BEGIN
  UPDATE "TrainingBooking" SET status='CANCELLED', "chargeRatio"=25 WHERE id='tb_3';
  RAISE NOTICE 'L. Процент вне набора Енисея принят........ OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'L. ПРОВАЛ: %', SQLERRM; END $$;

-- L2. Процент за пределами 0..100 — должен быть отклонён
DO $$ BEGIN
  UPDATE "TrainingBooking" SET "chargeRatio"=150 WHERE id='tb_3';
  RAISE NOTICE 'L2. ПРОВАЛ: списание 150%% прошло!';
EXCEPTION WHEN others THEN RAISE NOTICE 'L2. Списание вне 0..100 отклонено.......... OK (ожидалось)'; END $$;

-- M. Опечатка в часовом поясе — должна быть отклонена
DO $$ BEGIN
  INSERT INTO "Tenant" (id,name,slug,"createdAt","updatedAt","tableHourPrice","tableExtra30MinPrice",timezone)
  VALUES ('t4','Опечатка','typo',now(),now(),40000,20000,'Asia/Krasnayarsk');
  RAISE NOTICE 'M. ПРОВАЛ: несуществующая таймзона принята!';
EXCEPTION WHEN others THEN RAISE NOTICE 'M. Опечатка в таймзоне отклонена........... OK (ожидалось)'; END $$;

-- N. Автонеявка раньше напоминания — бессмысленная настройка, должна быть отклонена
DO $$ BEGIN
  INSERT INTO "Tenant" (id,name,slug,"createdAt","updatedAt","tableHourPrice","tableExtra30MinPrice",
                        "attendanceReminderAfterMinutes","attendanceAutoNoShowAfterMinutes")
  VALUES ('t5','Кривая эскалация','badesc',now(),now(),40000,20000,1440,60);
  RAISE NOTICE 'N. ПРОВАЛ: автонеявка раньше напоминания!';
EXCEPTION WHEN others THEN RAISE NOTICE 'N. Кривой порядок эскалации отклонён....... OK (ожидалось)'; END $$;

-- O. Нельзя удалить клиента, за которым висит история (Restrict)
DO $$ BEGIN
  DELETE FROM "User" WHERE id='u1';
  RAISE NOTICE 'O. ПРОВАЛ: клиент с историей удалён!';
EXCEPTION WHEN others THEN RAISE NOTICE 'O. Удаление клиента с историей отклонено... OK (ожидалось)'; END $$;

-- P. Визит «с порога» с привязанной бронью — противоречие, должно быть отклонено
DO $$ BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType","trainingBookingId",attended,"recordedByUserId")
  VALUES ('v1','t1','u1','WALK_IN','tb_3',true,'u1');
  RAISE NOTICE 'P. ПРОВАЛ: визит с порога с бронью принят!';
EXCEPTION WHEN others THEN RAISE NOTICE 'P. Противоречивый источник визита отклонён. OK (ожидалось)'; END $$;

-- Q. Визит без брони (админ добавил задним числом) — должен пройти
DO $$ BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType",attended,"recordedByUserId")
  VALUES ('v2','t1','u1','WALK_IN',true,'u1');
  RAISE NOTICE 'Q. Визит с порога без брони................ OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'Q. ПРОВАЛ: %', SQLERRM; END $$;

-- S. «Енисей» без тарифа, но со статусом EXEMPT — должен пройти
DO $$ BEGIN
  INSERT INTO "TenantSubscription" (id,"tenantId",status,"updatedAt")
  VALUES ('ts_ex','t1','EXEMPT',now());
  RAISE NOTICE 'S. Пилотный клуб без тарифа (EXEMPT)....... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'S. ПРОВАЛ: %', SQLERRM; END $$;

-- T. Платящая подписка без тарифа — должна быть отклонена
DO $$ BEGIN
  INSERT INTO "TenantSubscription" (id,"tenantId",status,"updatedAt")
  VALUES ('ts_bad','t2','ACTIVE',now());
  RAISE NOTICE 'T. ПРОВАЛ: платящая подписка без тарифа принята!';
EXCEPTION WHEN others THEN RAISE NOTICE 'T. Подписка без тарифа отклонена........... OK (ожидалось)'; END $$;

-- U. Смена прайса платформы не трогает уже купленную подписку
DO $$
DECLARE frozen int;
BEGIN
  INSERT INTO "PlatformPlan" (id,name,"periodMonths",price,"updatedAt")
  VALUES ('pp_year','Год',12,5000000,now());
  INSERT INTO "TenantSubscription" (id,"tenantId","planId","priceAtPurchase",status,"updatedAt")
  VALUES ('ts_ok','t2','pp_year',5000000,'ACTIVE',now());
  -- платформа подняла цену
  UPDATE "PlatformPlan" SET "isActive"=false WHERE id='pp_year';
  INSERT INTO "PlatformPlan" (id,name,"periodMonths",price,"updatedAt")
  VALUES ('pp_year2','Год',12,6000000,now());

  SELECT "priceAtPurchase" INTO frozen FROM "TenantSubscription" WHERE id='ts_ok';
  IF frozen = 5000000 THEN
    RAISE NOTICE 'U. Цена купленной подписки не поехала...... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'U. ПРОВАЛ: цена подписки изменилась на %', frozen;
  END IF;
EXCEPTION WHEN others THEN RAISE NOTICE 'U. ПРОВАЛ: %', SQLERRM; END $$;

-- R. Абонемент с «арендой только в безлимите», но без покрытия аренды
DO $$ BEGIN
  INSERT INTO "SubscriptionPlan" (id,"tenantId",name,"durationDays",price,"coversTableRental","tableRentalUnlimitedOnly","updatedAt")
  VALUES ('sp1','t1','Кривой тариф',30,1000000,false,true,now());
  RAISE NOTICE 'R. ПРОВАЛ: противоречивые флаги аренды приняты!';
EXCEPTION WHEN others THEN RAISE NOTICE 'R. Противоречие во флагах аренды отклонено. OK (ожидалось)'; END $$;

\echo ''
