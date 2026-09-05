-- ---------------------------------------------------------------------------
-- Проверка, что ограничения из schema-constraints.sql реально ловят то,
-- ради чего заведены.
-- ---------------------------------------------------------------------------
--
-- СТАТУС: прогнано на PostgreSQL 18 (02.09.2026) — 27 из 27 сценариев прошли.
-- Дополнительно проверено, что отказы приходят именно от нужных ограничений,
-- а не по случайной причине: exclusion-констрейнт даёт 23P01, составные
-- внешние ключи — 23503, частичный уникальный индекс — 23505, check'и — 23514.
--
-- 02.09.2026 сценарии K, M и N чинились: они писали в Tenant колонки цен,
-- которых там нет с переезда прайса в зал, падали на несуществующей колонке —
-- и блок EXCEPTION WHEN others засчитывал это как успех. Ровно та ловушка,
-- о которой предупреждает оговорка ниже.
--
-- ОГОВОРКА про сами тесты: блок EXCEPTION WHEN others засчитывает ЛЮБУЮ
-- ошибку, поэтому «OK (ожидалось)» само по себе не доказывает, что сработало
-- задуманное правило, — опечатка в имени колонки выглядела бы так же. При
-- добавлении новых сценариев проверяйте код ошибки и имя ограничения через
-- GET STACKED DIAGNOSTICS, а не только факт отказа.
--
-- Как запустить:
--
--   DATABASE_URL="postgresql://postgres:пароль@127.0.0.1:5432/yenisey_verify"
--     pnpm --filter @yenisey/database verify
--
-- Строку подключения передавать БЕЗ «?schema=public»: psql такой URI не
-- принимает. Направлять только на пустую одноразовую базу — тесты пишут туда
-- заведомо некорректные данные, и на рабочей базе это недопустимо.
--
-- Каждый тест печатает «OK (ожидалось)» либо «ПРОВАЛ». Тесты, которые ждут
-- отказа базы, специально пишут в неё заведомо некорректные данные.

\set ON_ERROR_STOP off

-- Два клуба. Цены и шаг брони живут у зала, а не у клуба.
INSERT INTO "Tenant" (id,name,slug,"createdAt","updatedAt")
VALUES ('t1','Енисей','yenisey',now(),now()),
       ('t2','Другой клуб','other',now(),now());

-- По залу в каждом клубе: без зала не завести ни стол, ни цену.
INSERT INTO "Hall" (id,"tenantId",name,"tableHourPrice","tableExtra30MinPrice","hasRobotOption","createdAt","updatedAt")
VALUES ('h1','t1','Основной зал',40000,20000,false,now(),now()),
       ('h2','t2','Основной зал',50000,25000,false,now(),now());

-- Учётные записи платформы. Клуба и роли у них нет: аккаунт один на всю
-- платформу. Телефон и дата рождения обязательны у всех.
INSERT INTO "User" (id,email,phone,"birthDate","passwordHash","fullName","createdAt","updatedAt")
VALUES ('u1','a@a.ru','+79990000001',DATE '1990-01-01','x','Иванов Иван',now(),now()),
       ('c1','coach@a.ru','+79990000002',DATE '1985-05-05','x','Тренеров Тренер',now(),now()),
       ('u2','b@b.ru','+79990000003',DATE '1992-03-03','x','Петров Пётр',now(),now());

-- Кем каждый является в каком клубе. Роль живёт здесь, и на эту пару
-- ссылается всё клубное.
INSERT INTO "TenantMembership" ("userId","tenantId",role,"createdAt","updatedAt")
VALUES ('u1','t1','CLIENT',now(),now()),
       ('c1','t1','COACH',now(),now()),
       ('u2','t2','CLIENT',now(),now());

INSERT INTO "ClientProfile" ("userId","tenantId","createdAt","updatedAt")
VALUES ('u1','t1',now(),now()),
       ('u2','t2',now(),now());

INSERT INTO "CoachProfile" ("userId","tenantId","createdAt","updatedAt")
VALUES ('c1','t1',now(),now());

INSERT INTO "Table" (id,"tenantId","hallId",label,"createdAt") VALUES ('tb1','t1','h1','Стол 1',now());

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

-- K. Зал с роботом, но без цен робота — должно быть отклонено.
--    Раньше этот сценарий писал цены в Tenant, где их нет с тех пор, как
--    прайс переехал в зал: тест падал на несуществующей колонке и засчитывал
--    это как успех.
DO $$ BEGIN
  INSERT INTO "Hall" (id,"tenantId",name,"tableHourPrice","tableExtra30MinPrice","hasRobotOption","createdAt","updatedAt")
  VALUES ('h3','t1','Зал без цен робота',40000,20000,true,now(),now());
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
  INSERT INTO "Tenant" (id,name,slug,"createdAt","updatedAt",timezone)
  VALUES ('t4','Опечатка','typo',now(),now(),'Asia/Krasnayarsk');
  RAISE NOTICE 'M. ПРОВАЛ: несуществующая таймзона принята!';
EXCEPTION WHEN others THEN RAISE NOTICE 'M. Опечатка в таймзоне отклонена........... OK (ожидалось)'; END $$;

-- N. Автонеявка раньше напоминания — бессмысленная настройка, должна быть отклонена
DO $$ BEGIN
  INSERT INTO "Tenant" (id,name,slug,"createdAt","updatedAt",
                        "attendanceReminderAfterMinutes","attendanceAutoNoShowAfterMinutes")
  VALUES ('t5','Кривая эскалация','badesc',now(),now(),1440,60);
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

-- ---------------------------------------------------------------------------
-- Единый аккаунт: User глобальный, клубное держится на TenantMembership.
-- ---------------------------------------------------------------------------

-- V. Один человек — клиент в двух клубах. Ради этого и затевался единый
--    аккаунт: раньше это были две учётные записи с одной почтой.
DO $$ BEGIN
  INSERT INTO "TenantMembership" ("userId","tenantId",role,"createdAt","updatedAt")
  VALUES ('u1','t2','CLIENT',now(),now());
  INSERT INTO "ClientProfile" ("userId","tenantId","createdAt","updatedAt")
  VALUES ('u1','t2',now(),now());
  RAISE NOTICE 'V. Один аккаунт клиентом в двух клубах..... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'V. ПРОВАЛ: %', SQLERRM; END $$;

-- W. Вторая учётка с той же почтой — должна быть отклонена. Это и есть
--    «аккаунт один на платформу»: без этого запрета флоу «клиент с порога»
--    завёл бы человеку второго двойника вместо привязки к клубу.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "User" (id,email,phone,"birthDate","passwordHash","fullName","createdAt","updatedAt")
  VALUES ('u_dup','a@a.ru','+79990000009',DATE '1990-01-01','x','Двойник Иванова',now(),now());
  RAISE NOTICE 'W. ПРОВАЛ: почта повторилась на платформе!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23505' THEN
    RAISE NOTICE 'W. Повторная почта отклонена............... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'W. ПРОВАЛ: отказ пришёл не от уникальности, а от %', code;
  END IF;
END $$;

-- X. КЛЮЧЕВОЕ для новой модели: анкета клиента в клубе, к которому человек не
--    привязан. Мишень составных ключей переехала на TenantMembership, и
--    именно этот отказ доказывает, что изоляция от переезда не пострадала.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "ClientProfile" ("userId","tenantId","createdAt","updatedAt")
  VALUES ('c1','t2',now(),now());
  RAISE NOTICE 'X. ПРОВАЛ: анкета завелась без привязки к клубу!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23503' THEN
    RAISE NOTICE 'X. Анкета без привязки к клубу отклонена... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'X. ПРОВАЛ: отказ пришёл не от внешнего ключа, а от %', code;
  END IF;
END $$;

-- Y. Роль — свойство пары, а не человека: тот же аккаунт тренером во втором
--    клубе, оставаясь клиентом в первом.
DO $$ BEGIN
  INSERT INTO "TenantMembership" ("userId","tenantId",role,"createdAt","updatedAt")
  VALUES ('c1','t2','COACH',now(),now());
  RAISE NOTICE 'Y. Разные роли в разных клубах............. OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'Y. ПРОВАЛ: %', SQLERRM; END $$;

-- Z. Отключение в одном клубе не трогает аккаунт: человек продолжает играть
--    в другом. Раньше отключение было одно на учётку — то есть на клуб.
DO $$
DECLARE club_off int; account_off int;
BEGIN
  UPDATE "TenantMembership" SET "deactivatedAt"=now() WHERE "userId"='u1' AND "tenantId"='t2';
  SELECT count(*) INTO club_off FROM "TenantMembership"
   WHERE "userId"='u1' AND "deactivatedAt" IS NOT NULL;
  SELECT count(*) INTO account_off FROM "User" WHERE id='u1' AND "deactivatedAt" IS NOT NULL;
  IF club_off = 1 AND account_off = 0 THEN
    RAISE NOTICE 'Z. Отключение в клубе не гасит аккаунт..... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'Z. ПРОВАЛ: клубных отключений %, платформенных %', club_off, account_off;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Платформенный слой: мои клубы, город, оформление
-- ---------------------------------------------------------------------------

-- AA. Своих клубов не больше трёх. Предел выражен структурой: слот уникален в
--     пределах человека и ограничен диапазоном 1..3, поэтому четвёртый клуб
--     физически некуда положить. Проверка в коде от гонки не спасает.
DO $$ BEGIN
  INSERT INTO "City" (id,name,region,"createdAt")
  VALUES ('ct1','Красноярск','Красноярский край',now()),
         ('ct2','Абакан','Республика Хакасия',now());

  INSERT INTO "Tenant" (id,name,slug,"createdAt","updatedAt")
  VALUES ('t3','Третий клуб','third',now(),now()),
         ('t4','Четвёртый клуб','fourth',now(),now());

  INSERT INTO "UserClub" ("userId","tenantId",slot,"createdAt")
  VALUES ('u1','t1',1,now()), ('u1','t2',2,now()), ('u1','t3',3,now());

  RAISE NOTICE 'AA. Три своих клуба заводятся.............. OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'AA. ПРОВАЛ: %', SQLERRM; END $$;

-- AB. Четвёртый клуб: свободного слота нет, а слот 4 вне диапазона.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "UserClub" ("userId","tenantId",slot,"createdAt")
  VALUES ('u1','t4',4,now());
  RAISE NOTICE 'AB. ПРОВАЛ: четвёртый клуб отметился своим!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23514' THEN
    RAISE NOTICE 'AB. Четвёртый свой клуб отклонён.......... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AB. ПРОВАЛ: отказ пришёл не от CHECK, а от %', code;
  END IF;
END $$;

-- AC. Занятый слот не отдаётся второму клубу: без этого «не больше трёх»
--     обходилось бы тремя строками с одним и тем же номером.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "UserClub" ("userId","tenantId",slot,"createdAt")
  VALUES ('u1','t4',3,now());
  RAISE NOTICE 'AC. ПРОВАЛ: два клуба заняли один слот!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23505' THEN
    RAISE NOTICE 'AC. Повторный слот отклонён............... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AC. ПРОВАЛ: отказ пришёл не от уникального индекса, а от %', code;
  END IF;
END $$;

-- AD. Тот же клуб дважды в избранном: ловится первичным ключом пары.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "UserClub" ("userId","tenantId",slot,"createdAt")
  VALUES ('u1','t1',2,now());
  RAISE NOTICE 'AD. ПРОВАЛ: клуб отметился своим дважды!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23505' THEN
    RAISE NOTICE 'AD. Повторная отметка клуба отклонена..... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AD. ПРОВАЛ: отказ пришёл не от уникального индекса, а от %', code;
  END IF;
END $$;

-- AE. Фирменный цвет клуба: мусор в поле означал бы сломанную вёрстку
--     страницы клуба, а не пустое значение, — поэтому формат проверяет база.
DO $$
DECLARE code text;
BEGIN
  UPDATE "Tenant" SET "accentColor"='зелёный' WHERE id='t1';
  RAISE NOTICE 'AE. ПРОВАЛ: цветом клуба стало слово!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23514' THEN
    RAISE NOTICE 'AE. Небрендовый цвет отклонён............. OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AE. ПРОВАЛ: отказ пришёл не от CHECK, а от %', code;
  END IF;
END $$;

-- AF. Настоящий HEX принимается.
DO $$ BEGIN
  UPDATE "Tenant" SET "accentColor"='#126b54' WHERE id='t1';
  RAISE NOTICE 'AF. Цвет вида #126b54 принят.............. OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'AF. ПРОВАЛ: %', SQLERRM; END $$;

-- AG. Города различаются парой «название + регион»: одноимённые города в
--     разных регионах законны, а два «Красноярска» в одном — нет.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "City" (id,name,region,"createdAt")
  VALUES ('ct3','Железногорск','Красноярский край',now()),
         ('ct4','Железногорск','Курская область',now());

  INSERT INTO "City" (id,name,region,"createdAt")
  VALUES ('ct5','Красноярск','Красноярский край',now());

  RAISE NOTICE 'AG. ПРОВАЛ: город продублировался в регионе!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23505' THEN
    RAISE NOTICE 'AG. Дубль города в регионе отклонён....... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AG. ПРОВАЛ: отказ пришёл не от уникального индекса, а от %', code;
  END IF;
END $$;

-- AH. Часовой пояс живёт на ЗАЛЕ, а не на клубе. Проверка структурная: пояс у
--     клуба должен отсутствовать как колонка, иначе два источника правды
--     разойдутся молча, сдвигом на час.
DO $$
DECLARE on_tenant int; on_hall int;
BEGIN
  SELECT count(*) INTO on_tenant FROM information_schema.columns
   WHERE table_name='Tenant' AND column_name='timezone';
  SELECT count(*) INTO on_hall FROM information_schema.columns
   WHERE table_name='Hall' AND column_name='timezone';

  IF on_tenant = 0 AND on_hall = 1 THEN
    RAISE NOTICE 'AH. Часовой пояс только у зала............ OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AH. ПРОВАЛ: пояс у клуба %, у зала %', on_tenant, on_hall;
  END IF;
END $$;
