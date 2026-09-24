-- ---------------------------------------------------------------------------
-- Проверка, что ограничения из schema-constraints.sql реально ловят то,
-- ради чего заведены.
-- ---------------------------------------------------------------------------
--
-- СТАТУС: прогнано на PostgreSQL 18 (19.09.2026) — 105 из 105 сценариев прошли.
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

-- D. Отменённая бронь время не занимает — 18:30-19:30 со статусом CANCELLED.
--    Момент отмены обязателен (TableBooking_cancelled_has_time): от него
--    считается процент списания, см. сценарий AO.
DO $$ BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking",status,"cancelledAt","updatedAt")
  VALUES ('bk4','t1','tb1','u1','2026-09-01 18:30+07','2026-09-01 19:30+07',40000,'CANCELLED',now(),now());
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
  UPDATE "TrainingBooking" SET status='CANCELLED', "cancelledAt"=now(), "chargeRatio"=25 WHERE id='tb_3';
  RAISE NOTICE 'L. Процент вне набора Енисея принят........ OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'L. ПРОВАЛ: %', SQLERRM; END $$;

-- L2. Процент за пределами 0..100 — должен быть отклонён
DO $$ BEGIN
  UPDATE "TrainingBooking" SET "chargeRatio"=150 WHERE id='tb_3';
  RAISE NOTICE 'L2. ПРОВАЛ: списание 150%% прошло!';
EXCEPTION WHEN others THEN RAISE NOTICE 'L2. Списание вне 0..100 отклонено.......... OK (ожидалось)'; END $$;

-- M. Опечатка в часовом поясе зала — должна быть отклонена.
--    До 11.09.2026 сценарий писал пояс в Tenant, где его нет с переезда пояса
--    в зал: падал на несуществующей колонке, и это засчитывалось успехом.
--    Приведение к неизвестной зоне падает с 22023 (invalid_parameter_value)
--    ещё до того, как CHECK вернёт false, — поэтому ждём именно его.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "Hall" (id,"tenantId",name,"tableHourPrice","tableExtra30MinPrice","hasRobotOption",timezone,"createdAt","updatedAt")
  VALUES ('h4','t1','Зал с опечаткой',40000,20000,false,'Asia/Krasnayarsk',now(),now());
  RAISE NOTICE 'M. ПРОВАЛ: несуществующая таймзона принята!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '22023' THEN
    RAISE NOTICE 'M. Опечатка в таймзоне отклонена........... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'M. ПРОВАЛ: отказ пришёл не от проверки зоны, а от %: %', code, SQLERRM;
  END IF;
END $$;

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
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType","trainingBookingId",attended,"recordedByUserId","visitedAt")
  VALUES ('v1','t1','u1','WALK_IN','tb_3',true,'u1','2026-09-01 18:00+07');
  RAISE NOTICE 'P. ПРОВАЛ: визит с порога с бронью принят!';
EXCEPTION WHEN others THEN RAISE NOTICE 'P. Противоречивый источник визита отклонён. OK (ожидалось)'; END $$;

-- Q. Визит без брони (админ добавил задним числом) — должен пройти
DO $$ BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType",attended,"recordedByUserId","visitedAt")
  VALUES ('v2','t1','u1','WALK_IN',true,'u1','2026-09-01 12:00+07');
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

-- ---------------------------------------------------------------------------
-- Занятие в расписании дня
-- ---------------------------------------------------------------------------

-- Расписание дня в обоих клубах и второй стол — фикстуры, а не проверки.
-- Заводятся ОТДЕЛЬНЫМИ операторами, а не внутри блоков ниже: блок DO
-- откатывается целиком, и вставка, сделанная в нём перед ожидаемым отказом,
-- пропадает вместе с ним — контрольный сценарий потом падает на пустоте.
INSERT INTO "HallDaySchedule" (id,"tenantId","hallId",date,"updatedAt")
VALUES ('ds1','t1','h1',DATE '2026-09-01',now()),
       ('ds2','t2','h2',DATE '2026-09-01',now());

INSERT INTO "Table" (id,"tenantId","hallId",label,"createdAt")
VALUES ('tb2','t2','h2','Стол 1',now());

-- AI. Ссылка на занятие возможна только у окна с purpose = TRAINING. Без этого
--     правила аренда стола могла бы «принадлежать» тренировочной сессии, и
--     расписание перестало бы отвечать на вопрос, чем стол занят на самом деле.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "DayClosure" (id,"tenantId","scheduleId","tableId","startMinute","endMinute",purpose,"trainingSessionId","updatedAt")
  VALUES ('dc1','t1','ds1','tb1',1080,1170,'RENT','ts1',now());

  RAISE NOTICE 'AI. ПРОВАЛ: аренда стола сослалась на занятие!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23514' THEN
    RAISE NOTICE 'AI. Занятие у аренды отклонено............ OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AI. ПРОВАЛ: отказ пришёл не от CHECK, а от %', code;
  END IF;
END $$;

-- AJ. Занятие ЧУЖОГО клуба в расписании — то же ключевое правило изоляции, что
--     у брони: ссылка составная, и одним лишь идентификатором сессии клуб не
--     обойти. Клуб t2 подставляет сессию клуба t1.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "DayClosure" (id,"tenantId","scheduleId","tableId","startMinute","endMinute",purpose,"coachId","trainingTypeId","trainingSessionId","updatedAt")
  VALUES ('dc2','t2','ds2','tb2',1080,1170,'TRAINING','c1','tt1','ts1',now());

  RAISE NOTICE 'AJ. ПРОВАЛ: чужое занятие попало в расписание!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23503' THEN
    RAISE NOTICE 'AJ. Занятие чужого клуба отклонено........ OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AJ. ПРОВАЛ: отказ пришёл не от внешнего ключа, а от %', code;
  END IF;
END $$;

-- AK. Своё занятие в своём расписании — проходит. Сценарий-контроль к двум
--     предыдущим: без него отказ мог бы приходить по любой причине.
DO $$ BEGIN
  INSERT INTO "DayClosure" (id,"tenantId","scheduleId","tableId","startMinute","endMinute",purpose,"coachId","trainingTypeId","trainingSessionId","updatedAt")
  VALUES ('dc3','t1','ds1','tb1',1080,1170,'TRAINING','c1','tt1','ts1',now());
  RAISE NOTICE 'AK. Занятие в своём расписании............. OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'AK. ПРОВАЛ: %', SQLERRM; END $$;

-- ---------------------------------------------------------------------------
-- Ручная запись и её автор (раздел 16 constraints.sql)
-- ---------------------------------------------------------------------------

-- AL. Ручная бронь без автора. За админской бронью стоят чужие деньги, и
--     «кто меня записал» — первый вопрос при споре. Ответить больше нечем:
--     AuditLog на этом этапе не пишется.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking",source,"updatedAt")
  VALUES ('bk10','t1','tb1','u1','2026-09-20 10:00+07','2026-09-20 11:00+07',40000,'MANUAL',now());

  RAISE NOTICE 'AL. ПРОВАЛ: ручная бронь без автора прошла!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23514' THEN
    RAISE NOTICE 'AL. Ручная бронь без автора отклонена...... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AL. ПРОВАЛ: отказ пришёл не от check, а от %', code;
  END IF;
END $$;

-- AM. Ручная бронь с автором своего клуба — проходит. Сценарий-контроль:
--     без него отказ в AL мог бы приходить по любой другой причине.
DO $$ BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking",source,"createdByUserId","updatedAt")
  VALUES ('bk11','t1','tb1','u1','2026-09-20 10:00+07','2026-09-20 11:00+07',40000,'MANUAL','c1',now());
  RAISE NOTICE 'AM. Ручная бронь с автором создана......... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'AM. ПРОВАЛ: %', SQLERRM; END $$;

-- AN. Автор из ЧУЖОГО клуба. Ключ составной и целится в TenantMembership —
--     та же мишень, что у VisitLog.recordedBy. Клуб t1 подставляет u2,
--     который состоит только в t2.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking",source,"createdByUserId","updatedAt")
  VALUES ('bk12','t1','tb1','u1','2026-09-21 10:00+07','2026-09-21 11:00+07',40000,'MANUAL','u2',now());

  RAISE NOTICE 'AN. ПРОВАЛ: автор из чужого клуба прошёл!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23503' THEN
    RAISE NOTICE 'AN. Автор из чужого клуба отклонён........ OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AN. ПРОВАЛ: отказ пришёл не от внешнего ключа, а от %', code;
  END IF;
END $$;

-- AO. Отмена без момента отмены. От него считается процент списания по
--     политике клуба, и запись без него делает спор о деньгах неразрешимым:
--     неизвестно, отменили за сутки или за минуту.
DO $$
DECLARE code text;
BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking",status,"updatedAt")
  VALUES ('bk13','t1','tb1','u1','2026-09-22 10:00+07','2026-09-22 11:00+07',40000,'CANCELLED',now());

  RAISE NOTICE 'AO. ПРОВАЛ: отмена без момента отмены прошла!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23514' THEN
    RAISE NOTICE 'AO. Отмена без момента отмены отклонена.... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AO. ПРОВАЛ: отказ пришёл не от check, а от %', code;
  END IF;
END $$;

-- AP. Онлайн-бронь автора не требует: клиент сам себе не «автор», и поле
--     остаётся пустым. Контроль к AL — он не должен запрещать обычную бронь.
DO $$ BEGIN
  INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking","updatedAt")
  VALUES ('bk14','t1','tb1','u1','2026-09-23 10:00+07','2026-09-23 11:00+07',40000,now());
  RAISE NOTICE 'AP. Онлайн-бронь без автора создана....... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'AP. ПРОВАЛ: %', SQLERRM; END $$;

-- ---------------------------------------------------------------------------
-- Отметка присутствия (раздел 17 constraints.sql)
-- ---------------------------------------------------------------------------
--
-- Своя пара броней, чтобы не зависеть от того, что сделали сценарии выше:
-- bk20 отмечается присутствием, bk21 — неявкой от джобы.

INSERT INTO "TableBooking" (id,"tenantId","tableId","clientId","startsAt","endsAt","priceAtBooking","updatedAt")
VALUES ('bk20','t1','tb1','u1','2026-09-24 10:00+07','2026-09-24 11:00+07',40000,now()),
       ('bk21','t1','tb1','u1','2026-09-24 12:00+07','2026-09-24 13:00+07',40000,now());

INSERT INTO "AuditLog" (id,"tenantId",action,"actorUserId","entityType","entityId",before,after,reason)
VALUES ('al1','t1','NO_SHOW_MARKED','c1','TableBooking','bk21',
        '{"status":"BOOKED"}','{"status":"NO_SHOW","chargeRatio":100}',NULL);

-- AQ. Визит по записи без самой записи. Раньше это был законный «визит,
--     добавленный задним числом», теперь такой визит — WALK_IN, а TRAINING
--     без ссылки — потерянная связь, к которой не привязать «одна запись —
--     один визит».
DO $$
DECLARE code text; cname text;
BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType",attended,"recordedByUserId","visitedAt")
  VALUES ('v10','t1','u1','TRAINING',true,'c1','2026-09-01 18:00+07');
  RAISE NOTICE 'AQ. ПРОВАЛ: визит по записи без записи прошёл!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
  IF code = '23514' AND cname = 'VisitLog_source_matches_type' THEN
    RAISE NOTICE 'AQ. Визит по записи без записи отклонён... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AQ. ПРОВАЛ: отказ пришёл от % (%)', code, cname;
  END IF;
END $$;

-- AR. Первый визит по брони с автором — проходит. Контроль к AS и AT.
DO $$ BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType","tableBookingId",attended,"recordedByUserId","visitedAt")
  VALUES ('v11','t1','u1','TABLE','bk20',true,'c1','2026-09-24 10:00+07');
  RAISE NOTICE 'AR. Визит по брони создан.................. OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'AR. ПРОВАЛ: %', SQLERRM; END $$;

-- AS. Второй визит на ту же бронь. Исправление отметки и джоба могут прийти
--     одновременно, и проверка «визит уже есть?» в коде от гонки не спасает.
DO $$
DECLARE code text; cname text;
BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType","tableBookingId",attended,"recordedByUserId","visitedAt")
  VALUES ('v12','t1','u1','TABLE','bk20',false,'c1','2026-09-24 10:00+07');
  RAISE NOTICE 'AS. ПРОВАЛ: второй визит на одну бронь прошёл!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
  IF code = '23505' AND cname = 'VisitLog_table_booking_uniq' THEN
    RAISE NOTICE 'AS. Второй визит на бронь отклонён......... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AS. ПРОВАЛ: отказ пришёл от % (%)', code, cname;
  END IF;
END $$;

-- AT. Присутствие без автора. Пустой автор законен только у неявки, которую
--     поставила джоба; «кто поставил мне визит» — вопрос с обязательным ответом.
DO $$
DECLARE code text; cname text;
BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType","tableBookingId",attended,"visitedAt")
  VALUES ('v13','t1','u1','TABLE','bk21',true,'2026-09-24 12:00+07');
  RAISE NOTICE 'AT. ПРОВАЛ: присутствие без автора прошло!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
  IF code = '23514' AND cname = 'VisitLog_author_unless_auto_no_show' THEN
    RAISE NOTICE 'AT. Присутствие без автора отклонено....... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AT. ПРОВАЛ: отказ пришёл от % (%)', code, cname;
  END IF;
END $$;

-- AU. Неявка без автора — проходит: так её пишет джоба автонеявки.
DO $$ BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType","tableBookingId",attended,"visitedAt")
  VALUES ('v14','t1','u1','TABLE','bk21',false,'2026-09-24 12:00+07');
  RAISE NOTICE 'AU. Неявка от джобы без автора............. OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'AU. ПРОВАЛ: %', SQLERRM; END $$;

-- AV. Визит с порога дважды в один момент — двойное нажатие, а не два визита.
DO $$
DECLARE code text; cname text;
BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType",attended,"recordedByUserId","visitedAt")
  VALUES ('v15','t1','u1','WALK_IN',true,'c1','2026-09-01 12:00+07');
  RAISE NOTICE 'AV. ПРОВАЛ: дубль визита с порога прошёл!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
  IF code = '23505' AND cname = 'VisitLog_walk_in_uniq' THEN
    RAISE NOTICE 'AV. Дубль визита с порога отклонён......... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AV. ПРОВАЛ: отказ пришёл от % (%)', code, cname;
  END IF;
END $$;

-- AW. Визит с порога в другое время того же дня — проходит: это второй
--     визит, а не повтор. Контроль к AV.
DO $$ BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType",attended,"recordedByUserId","visitedAt")
  VALUES ('v16','t1','u1','WALK_IN',true,'c1','2026-09-01 19:00+07');
  RAISE NOTICE 'AW. Второй визит с порога за день.......... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'AW. ПРОВАЛ: %', SQLERRM; END $$;

-- AX. «Пришёл с порога и не пришёл» не означает ничего.
DO $$
DECLARE code text; cname text;
BEGIN
  INSERT INTO "VisitLog" (id,"tenantId","clientId","sourceType",attended,"recordedByUserId","visitedAt")
  VALUES ('v17','t1','u1','WALK_IN',false,'c1','2026-09-02 12:00+07');
  RAISE NOTICE 'AX. ПРОВАЛ: неявка с порога прошла!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
  IF code = '23514' AND cname = 'VisitLog_walk_in_attended' THEN
    RAISE NOTICE 'AX. Неявка с порога отклонена.............. OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AX. ПРОВАЛ: отказ пришёл от % (%)', code, cname;
  END IF;
END $$;

-- AY. Неявка без процента. Процент — снимок в момент отметки, и без него
--     неявку не отличить от прощённой.
DO $$
DECLARE code text; cname text;
BEGIN
  UPDATE "TableBooking" SET status='NO_SHOW' WHERE id='bk21';
  RAISE NOTICE 'AY. ПРОВАЛ: неявка без процента прошла!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
  IF code = '23514' AND cname = 'TableBooking_marked_has_ratio' THEN
    RAISE NOTICE 'AY. Неявка без процента отклонена.......... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'AY. ПРОВАЛ: отказ пришёл от % (%)', code, cname;
  END IF;
END $$;

-- AZ. Прощённая неявка — процент 0 — проходит. Контроль к AY: правило
--     требует процент, а не ненулевой процент.
DO $$ BEGIN
  UPDATE "TableBooking" SET status='NO_SHOW', "chargeRatio"=0 WHERE id='bk21';
  RAISE NOTICE 'AZ. Прощённая неявка с процентом 0......... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'AZ. ПРОВАЛ: %', SQLERRM; END $$;

-- BA. Турнир, кончающийся раньше начала. По окончанию экран смены понимает,
--     что турнир закончился, а джоба — когда ставить неявку.
DO $$
DECLARE code text; cname text;
BEGIN
  INSERT INTO "TournamentType" (id,"tenantId",name,price,"updatedAt")
  VALUES ('tt_x','t1','Абсолют',50000,now());
  INSERT INTO "Tournament" (id,"tenantId","tournamentTypeId","startsAt","endsAt","updatedAt")
  VALUES ('tn_x','t1','tt_x','2026-09-26 12:00+07','2026-09-26 10:00+07',now());
  RAISE NOTICE 'BA. ПРОВАЛ: турнир кончается раньше начала!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
  IF code = '23514' AND cname = 'Tournament_time_order' THEN
    RAISE NOTICE 'BA. Турнир с концом до начала отклонён..... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'BA. ПРОВАЛ: отказ пришёл от % (%)', code, cname;
  END IF;
END $$;

-- BB. Правка строки журнала аудита. Журнал, который можно поправить, в споре
--     о деньгах ничего не доказывает.
DO $$
DECLARE code text;
BEGIN
  UPDATE "AuditLog" SET reason = 'задним числом' WHERE id = 'al1';
  RAISE NOTICE 'BB. ПРОВАЛ: строку аудита переписали!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23001' THEN
    RAISE NOTICE 'BB. Правка строки аудита отклонена......... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'BB. ПРОВАЛ: отказ пришёл от %', code;
  END IF;
END $$;

-- BC. Удаление строки журнала аудита.
DO $$
DECLARE code text;
BEGIN
  DELETE FROM "AuditLog" WHERE id = 'al1';
  RAISE NOTICE 'BC. ПРОВАЛ: строку аудита удалили!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23001' THEN
    RAISE NOTICE 'BC. Удаление строки аудита отклонено....... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'BC. ПРОВАЛ: отказ пришёл от %', code;
  END IF;
END $$;

-- BD. Очистка журнала целиком — TRUNCATE мимо построчных триггеров.
DO $$
DECLARE code text;
BEGIN
  TRUNCATE "AuditLog";
  RAISE NOTICE 'BD. ПРОВАЛ: журнал аудита очищен!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23001' THEN
    RAISE NOTICE 'BD. Очистка журнала аудита отклонена....... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'BD. ПРОВАЛ: отказ пришёл от %', code;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Расписание дня (раздел 12 constraints.sql)
-- ---------------------------------------------------------------------------
--
-- Ограничения окон дня были в миграции, но не в constraints.sql, и этот файл
-- их не видел. Окно dc3 из AK занимает стол tb1 в дне ds1 с 18:00 до 19:30.

-- BE. Второе окно поверх первого на том же столе в тот же день.
DO $$
DECLARE code text; cname text;
BEGIN
  INSERT INTO "DayClosure" (id,"tenantId","scheduleId","tableId","startMinute","endMinute",purpose,"updatedAt")
  VALUES ('dc4','t1','ds1','tb1',1140,1200,'OTHER',now());
  RAISE NOTICE 'BE. ПРОВАЛ: наложение окон дня прошло!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
  IF code = '23P01' AND cname = 'DayClosure_no_overlap' THEN
    RAISE NOTICE 'BE. Наложение окон дня отклонено........... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'BE. ПРОВАЛ: отказ пришёл от % (%)', code, cname;
  END IF;
END $$;

-- BF. Встык — проходит: полуоткрытый диапазон, 19:30 уже свободно.
DO $$ BEGIN
  INSERT INTO "DayClosure" (id,"tenantId","scheduleId","tableId","startMinute","endMinute",purpose,"updatedAt")
  VALUES ('dc5','t1','ds1','tb1',1170,1200,'OTHER',now());
  RAISE NOTICE 'BF. Окно дня встык принято................ OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'BF. ПРОВАЛ: %', SQLERRM; END $$;

-- ---------------------------------------------------------------------------
-- Профиль игрока (раздел 18 constraints.sql)
-- ---------------------------------------------------------------------------
--
-- Файлы игроков: у u1 — аватар и скан приказа, у u2 — аватар. Байты
-- условные: база проверяет размер, вид и владельца, а не содержимое.

INSERT INTO "StoredFile" (id,"ownerUserId",kind,"contentType",size,sha256,data)
VALUES ('f1','u1','AVATAR','image/webp',4,repeat('a',64),'\x52494646'::bytea),
       ('f2','u1','RANK_DOCUMENT','application/pdf',5,repeat('b',64),'\x255044462d'::bytea),
       ('f3','u2','AVATAR','image/webp',4,repeat('c',64),'\x52494646'::bytea);

-- Общая проверка «отказ пришёл от нужного правила» для сценариев ниже:
-- код ошибки и имя ограничения, а не просто факт отказа (см. оговорку в
-- начале файла).
CREATE FUNCTION pg_temp.expect(label text, statement text, want_code text, want_name text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE code text; cname text;
BEGIN
  EXECUTE statement;
  RAISE NOTICE '%. ПРОВАЛ: база приняла то, что должна была отклонить', label;
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
  IF code = want_code AND cname = want_name THEN
    RAISE NOTICE '%. Отклонено правилом % ... OK (ожидалось)', label, want_name;
  ELSE
    RAISE NOTICE '%. ПРОВАЛ: отказ пришёл от % (%), ждали % (%)', label, code, cname, want_code, want_name;
  END IF;
END
$fn$;

-- BG. Размер в строке не совпадает с байтами: клиент прислал «4», а их пять.
SELECT pg_temp.expect('BG',
  $q$INSERT INTO "StoredFile" (id,"ownerUserId",kind,"contentType",size,sha256,data)
     VALUES ('fx','u1','AVATAR','image/webp',4,repeat('a',64),'\x5249464600'::bytea)$q$,
  '23514', 'StoredFile_size_matches_data');

-- BH. SVG вместо скана приказа — исполняемый код в картинке.
SELECT pg_temp.expect('BH',
  $q$INSERT INTO "StoredFile" (id,"ownerUserId",kind,"contentType",size,sha256,data)
     VALUES ('fx','u1','RANK_DOCUMENT','image/svg+xml',4,repeat('a',64),'\x3c737667'::bytea)$q$,
  '23514', 'StoredFile_type_matches_kind');

-- BI. Аватар больше мегабайта — значит, пережатие не сработало.
SELECT pg_temp.expect('BI',
  $q$INSERT INTO "StoredFile" (id,"ownerUserId",kind,"contentType",size,sha256,data)
     VALUES ('fx','u1','AVATAR','image/webp',1048577,repeat('a',64),convert_to(repeat('a',1048577),'UTF8'))$q$,
  '23514', 'StoredFile_size_within_limit');

-- BJ. Чужой файл аватаром: составной ключ (файл, человек).
SELECT pg_temp.expect('BJ',
  $q$INSERT INTO "PlayerProfile" ("userId","avatarFileId","updatedAt") VALUES ('u1','f3',now())$q$,
  '23503', 'PlayerProfile_avatarFileId_userId_fkey');

-- BK. Свой файл аватаром — проходит.
DO $$ BEGIN
  INSERT INTO "PlayerProfile" ("userId","avatarFileId",blade,"updatedAt") VALUES ('u1','f1','Butterfly Viscaria',now());
  RAISE NOTICE 'BK. Свой аватар принят....................... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'BK. ПРОВАЛ: %', SQLERRM; END $$;

-- BL. Удалить файл из-под живого профиля.
SELECT pg_temp.expect('BL',
  $q$DELETE FROM "StoredFile" WHERE id = 'f1'$q$,
  '23503', 'PlayerProfile_avatarFileId_userId_fkey');

-- BM. Пробелы вместо основания: пусто — это NULL.
SELECT pg_temp.expect('BM',
  $q$UPDATE "PlayerProfile" SET blade = '   ' WHERE "userId" = 'u1'$q$,
  '23514', 'PlayerProfile_equipment_filled');

-- BN. Нулевое место в достижении.
SELECT pg_temp.expect('BN',
  $q$INSERT INTO "Achievement" (id,"userId",title,date,level,place,"updatedAt")
     VALUES ('a0','u1','Первенство края',DATE '2025-04-12','REGIONAL',0,now())$q$,
  '23514', 'Achievement_place_positive');

-- BO. Разряд без обоснования — ни приказа, ни скана.
SELECT pg_temp.expect('BO',
  $q$INSERT INTO "SportRank" ("userId",rank,"updatedAt") VALUES ('u1','KMS',now())$q$,
  '23514', 'SportRank_justified');

-- BP. Номер приказа без даты.
SELECT pg_temp.expect('BP',
  $q$INSERT INTO "SportRank" ("userId",rank,"orderNumber","updatedAt") VALUES ('u1','KMS','12-нг',now())$q$,
  '23514', 'SportRank_order_complete');

-- Разряды для сценариев проверки: у u1 — по скану, у тренера c1 — по приказу.
INSERT INTO "SportRank" ("userId",rank,"documentFileId","updatedAt") VALUES ('u1','KMS','f2',now());
INSERT INTO "SportRank" ("userId",rank,"orderNumber","orderDate","updatedAt")
VALUES ('c1','SPORT_1','45-р',DATE '2024-11-01',now());

-- BQ. «Подтверждён» без проверяющего.
SELECT pg_temp.expect('BQ',
  $q$UPDATE "SportRank" SET status = 'VERIFIED' WHERE "userId" = 'u1'$q$,
  '23514', 'SportRank_review_matches_status');

-- BR. Отказ без причины.
SELECT pg_temp.expect('BR',
  $q$UPDATE "SportRank" SET status = 'REJECTED', "reviewedByUserId" = 'c1', "reviewedInTenantId" = 't1',
       "reviewedAt" = now() WHERE "userId" = 'u1'$q$,
  '23514', 'SportRank_review_matches_status');

-- BS. Проверяющий «из клуба», где его нет: u2 в клубе t1 не состоит (c1
--     не годится — сценарий Y сделал его тренером и во втором клубе).
SELECT pg_temp.expect('BS',
  $q$UPDATE "SportRank" SET status = 'VERIFIED', "reviewedByUserId" = 'u2', "reviewedInTenantId" = 't1',
       "reviewedAt" = now() WHERE "userId" = 'u1'$q$,
  '23503', 'SportRank_reviewedByUserId_reviewedInTenantId_fkey');

-- BT. Свой разряд: c1 подтверждает сам себе.
SELECT pg_temp.expect('BT',
  $q$UPDATE "SportRank" SET status = 'VERIFIED', "reviewedByUserId" = 'c1', "reviewedInTenantId" = 't1',
       "reviewedAt" = now() WHERE "userId" = 'c1'$q$,
  '23514', 'SportRank_not_self_review');

-- BU. Разряд u1 подтверждает человек клуба t1 — проходит.
DO $$ BEGIN
  UPDATE "SportRank" SET status = 'VERIFIED', "reviewedByUserId" = 'c1', "reviewedInTenantId" = 't1',
    "reviewedAt" = now() WHERE "userId" = 'u1';
  RAISE NOTICE 'BU. Подтверждение разряда принято............ OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'BU. ПРОВАЛ: %', SQLERRM; END $$;

-- BV. Удаление учётки уносит профиль, разряд и файлы одним оператором.
--     Ради этого связи с файлом — NO ACTION, а не RESTRICT: RESTRICT
--     остановил бы каскад, если бы файл удалялся раньше профиля.
DO $$ BEGIN
  INSERT INTO "User" (id,email,phone,"birthDate","passwordHash","fullName","createdAt","updatedAt")
  VALUES ('p1','p1@a.ru','+79990000009',DATE '2000-01-01','x','Удаляемый Игрок',now(),now());
  INSERT INTO "StoredFile" (id,"ownerUserId",kind,"contentType",size,sha256,data)
  VALUES ('pf1','p1','AVATAR','image/webp',4,repeat('d',64),'\x52494646'::bytea),
         ('pf2','p1','RANK_DOCUMENT','application/pdf',5,repeat('e',64),'\x255044462d'::bytea);
  INSERT INTO "PlayerProfile" ("userId","avatarFileId","updatedAt") VALUES ('p1','pf1',now());
  INSERT INTO "SportRank" ("userId",rank,"documentFileId","updatedAt") VALUES ('p1','MS','pf2',now());
  INSERT INTO "Achievement" (id,"userId",title,date,level,"updatedAt")
  VALUES ('pa1','p1','Кубок города',DATE '2024-05-01','CITY',now());
  DELETE FROM "User" WHERE id = 'p1';
  IF EXISTS (SELECT 1 FROM "StoredFile" WHERE "ownerUserId" = 'p1') THEN
    RAISE NOTICE 'BV. ПРОВАЛ: файлы пережили учётку';
  ELSE
    RAISE NOTICE 'BV. Учётка ушла вместе с профилем и файлами.. OK (ожидалось)';
  END IF;
EXCEPTION WHEN others THEN RAISE NOTICE 'BV. ПРОВАЛ: %', SQLERRM; END $$;

-- ---------------------------------------------------------------------------
-- Семья (раздел 19 constraints.sql)
-- ---------------------------------------------------------------------------
--
-- Дети k1 и k2. Взрослые — u1 (клиент t1 и t2), c1 (тренер t1 и t2), u2
-- (только t2). Возраст база не проверяет — это правило сервиса.

INSERT INTO "User" (id,email,phone,"birthDate","passwordHash","fullName","createdAt","updatedAt")
VALUES ('k1','k1@a.ru','+79990000011',DATE '2015-06-01','x','Мячиков Петя',now(),now()),
       ('k2','k2@a.ru','+79990000012',DATE '2014-02-02','x','Ракеткина Оля',now(),now());

-- BW. Ребёнок сам себе родитель.
SELECT pg_temp.expect('BW',
  $q$INSERT INTO "Guardianship" (id,"childUserId","guardianUserId",status,"createdByUserId","confirmedAt","updatedAt")
     VALUES ('g0','k1','k1','ACTIVE','k1',now(),now())$q$,
  '23514', 'Guardianship_not_self');

-- BX. Родитель u1 ведёт k1 — проходит.
DO $$ BEGIN
  INSERT INTO "Guardianship" (id,"childUserId","guardianUserId",status,"createdByUserId","confirmedAt","updatedAt")
  VALUES ('g1','k1','u1','ACTIVE','u1',now(),now());
  RAISE NOTICE 'BX. Действующая опека принята............... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'BX. ПРОВАЛ: %', SQLERRM; END $$;

-- BY. Второй действующий родитель у того же ребёнка.
SELECT pg_temp.expect('BY',
  $q$INSERT INTO "Guardianship" (id,"childUserId","guardianUserId",status,"createdByUserId","confirmedAt","updatedAt")
     VALUES ('gx','k1','c1','ACTIVE','c1',now(),now())$q$,
  '23505', 'Guardianship_one_active_per_child');

-- BZ. Вторая ждущая заявка от того же взрослого тому же ребёнку.
DO $$ BEGIN
  INSERT INTO "Guardianship" (id,"childUserId","guardianUserId",status,"createdByUserId","updatedAt")
  VALUES ('g2','k2','u1','PENDING','u1',now());
EXCEPTION WHEN others THEN RAISE NOTICE 'BZ. ПРОВАЛ подготовки: %', SQLERRM; END $$;
SELECT pg_temp.expect('BZ',
  $q$INSERT INTO "Guardianship" (id,"childUserId","guardianUserId",status,"createdByUserId","updatedAt")
     VALUES ('gx','k2','u1','PENDING','u1',now())$q$,
  '23505', 'Guardianship_one_pending_per_pair');

-- CA. Заявки от разных взрослых одному ребёнку — законны: иначе посторонний
--     первой заявкой занял бы место настоящего родителя.
DO $$ BEGIN
  INSERT INTO "Guardianship" (id,"childUserId","guardianUserId",status,"createdByUserId","updatedAt")
  VALUES ('g3','k2','c1','PENDING','c1',now());
  RAISE NOTICE 'CA. Заявки от двух взрослых приняты.......... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'CA. ПРОВАЛ: %', SQLERRM; END $$;

-- CB. Действующая опека без момента подтверждения.
SELECT pg_temp.expect('CB',
  $q$UPDATE "Guardianship" SET status = 'ACTIVE' WHERE id = 'g3'$q$,
  '23514', 'Guardianship_status_matches_times');

-- CC. Снятая опека без того, кто снял.
SELECT pg_temp.expect('CC',
  $q$UPDATE "Guardianship" SET status = 'REVOKED', "revokedAt" = now() WHERE id = 'g1'$q$,
  '23514', 'Guardianship_status_matches_times');

-- CD. Клуб снял закрепление без причины.
SELECT pg_temp.expect('CD',
  $q$UPDATE "Guardianship" SET status = 'REVOKED', "revokedAt" = now(), "revokedByUserId" = 'c1',
       "revokedInTenantId" = 't1' WHERE id = 'g1'$q$,
  '23514', 'Guardianship_club_revoke_explained');

-- CE. Снимает «от имени клуба» человек, которого в этом клубе нет: u2 в t1.
SELECT pg_temp.expect('CE',
  $q$UPDATE "Guardianship" SET status = 'REVOKED', "revokedAt" = now(), "revokedByUserId" = 'u2',
       "revokedInTenantId" = 't1', "revokeReason" = 'Родитель потерял учётку' WHERE id = 'g1'$q$,
  '23503', 'Guardianship_revokedByUserId_revokedInTenantId_fkey');

-- CF. Завёл «у стойки» человек, которого в этом клубе нет.
SELECT pg_temp.expect('CF',
  $q$INSERT INTO "Guardianship" (id,"childUserId","guardianUserId",status,"createdByUserId","createdInTenantId","confirmedAt","updatedAt")
     VALUES ('gx','k2','u2','ACTIVE','u2','t1',now(),now())$q$,
  '23503', 'Guardianship_createdByUserId_createdInTenantId_fkey');

-- CG. Клуб снимает закрепление с причиной — проходит; после этого ребёнка
--     законно закрепляют заново.
DO $$ BEGIN
  UPDATE "Guardianship" SET status = 'REVOKED', "revokedAt" = now(), "revokedByUserId" = 'c1',
    "revokedInTenantId" = 't1', "revokeReason" = 'Родитель потерял учётку' WHERE id = 'g1';
  INSERT INTO "Guardianship" (id,"childUserId","guardianUserId",status,"createdByUserId","confirmedAt","updatedAt")
  VALUES ('g4','k1','c1','ACTIVE','c1',now(),now());
  RAISE NOTICE 'CG. Снято клубом и закреплено заново........ OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'CG. ПРОВАЛ: %', SQLERRM; END $$;

-- ---------------------------------------------------------------------------
-- Карточка тренера (раздел 20 constraints.sql)
-- ---------------------------------------------------------------------------
--
-- Тренер c1 в клубе t1. Карточка публична, и ошибка здесь видна всем.

-- CH. Фотография тренера в PDF: карточку рисует браузер, и сервер приводит
--     любую картинку к WebP.
SELECT pg_temp.expect('CH',
  $q$INSERT INTO "StoredFile" (id,"ownerUserId",kind,"contentType",size,sha256,data)
     VALUES ('fx','c1','COACH_PHOTO','application/pdf',5,repeat('f',64),'\x255044462d'::bytea)$q$,
  '23514', 'StoredFile_type_matches_kind');

-- CI. Чужой файл фотографией тренера: составной ключ (файл, человек).
--
--     Карточка теперь одна на человека (CoachCard), а не на пару с клубом.
INSERT INTO "CoachCard" ("userId","updatedAt") VALUES ('c1', now());

INSERT INTO "StoredFile" (id,"ownerUserId",kind,"contentType",size,sha256,data)
VALUES ('cf1','c1','COACH_PHOTO','image/webp',4,repeat('9',64),'\x52494646'::bytea);

SELECT pg_temp.expect('CI',
  $q$UPDATE "CoachCard" SET "photoFileId" = 'f3' WHERE "userId" = 'c1'$q$,
  '23503', 'CoachCard_photoFileId_userId_fkey');

-- CJ. Своя фотография — проходит.
DO $$ BEGIN
  UPDATE "CoachCard" SET "photoFileId" = 'cf1' WHERE "userId" = 'c1';
  RAISE NOTICE 'CJ. Своя фотография тренера принята........ OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'CJ. ПРОВАЛ: %', SQLERRM; END $$;

-- CK. Пробелы вместо достижений: пусто — это NULL.
SELECT pg_temp.expect('CK',
  $q$UPDATE "CoachCard" SET achievements = '   ' WHERE "userId" = 'c1'$q$,
  '23514', 'CoachCard_text_filled');

-- CK2. Отрицательная цена тренера в клубе.
SELECT pg_temp.expect('CK2',
  $q$UPDATE "CoachProfile" SET "groupPrice" = -1 WHERE "userId" = 'c1' AND "tenantId" = 't1'$q$,
  '23514', 'CoachProfile_prices_sane');

-- CL. Удаление учётки уносит карточку тренера вместе с фотографией.
--
--     То же, что BV у игрока, и теперь ровно тем же способом: карточка —
--     прямой потомок учётки, и NO ACTION хватает без отложенной проверки.
DO $$ BEGIN
  INSERT INTO "User" (id,email,phone,"birthDate","passwordHash","fullName","createdAt","updatedAt")
  VALUES ('c9','c9@a.ru','+79990000098',DATE '1990-01-01','x','Удаляемый Тренер',now(),now());
  INSERT INTO "CoachCard" ("userId","updatedAt") VALUES ('c9', now());
  INSERT INTO "StoredFile" (id,"ownerUserId",kind,"contentType",size,sha256,data)
  VALUES ('c9f','c9','COACH_PHOTO','image/webp',4,repeat('1',64),'\x52494646'::bytea);
  UPDATE "CoachCard" SET "photoFileId" = 'c9f' WHERE "userId" = 'c9';
  DELETE FROM "User" WHERE id = 'c9';
  IF EXISTS (SELECT 1 FROM "StoredFile" WHERE "ownerUserId" = 'c9') THEN
    RAISE NOTICE 'CL. ПРОВАЛ: фото пережило учётку';
  ELSE
    RAISE NOTICE 'CL. Учётка ушла вместе с карточкой и фото.. OK (ожидалось)';
  END IF;
EXCEPTION WHEN others THEN RAISE NOTICE 'CL. ПРОВАЛ: %', SQLERRM; END $$;

-- ---------------------------------------------------------------------------
-- Абонементы (раздел 21 constraints.sql)
-- ---------------------------------------------------------------------------
--
-- Клиенты u1 и u3 клуба t1, продаёт c1 (членство t1 — роли FK не проверяет).
-- Тариф sp1 — клуба t1, sp2 — клуба t2.

INSERT INTO "User" (id,email,phone,"birthDate","passwordHash","fullName","createdAt","updatedAt")
VALUES ('u3','u3@a.ru','+79990000013',DATE '1995-01-01','x','Сидоров Семён',now(),now());
INSERT INTO "TenantMembership" ("userId","tenantId",role,"createdAt","updatedAt")
VALUES ('u3','t1','CLIENT',now(),now());
INSERT INTO "ClientProfile" ("userId","tenantId","createdAt","updatedAt") VALUES ('u3','t1',now(),now());

INSERT INTO "SubscriptionPlan" (id,"tenantId",name,"visitsCount","durationDays",price,"updatedAt")
VALUES ('sp1','t1','Первая подача',5,30,500000,now()),
       ('sp2','t2','Чужой тариф',5,30,500000,now());

INSERT INTO "Subscription" (id,"tenantId","clientId","planId","remainingVisits","priceAtPurchase","issuedByUserId","expiresAt")
VALUES ('s1','t1','u1','sp1',5,500000,'c1',now() + interval '30 days');

-- CM. Безлимит без срока: вечный абонемент клуб не продаёт, а опечатка — продаёт.
SELECT pg_temp.expect('CM',
  $q$INSERT INTO "SubscriptionPlan" (id,"tenantId",name,"visitsCount","durationDays",price,"updatedAt")
     VALUES ('spx','t1','Вечный',NULL,NULL,100,now())$q$,
  '23514', 'SubscriptionPlan_terms_sane');

-- CN. Абонемент клуба t1 на тариф клуба t2.
SELECT pg_temp.expect('CN',
  $q$INSERT INTO "Subscription" (id,"tenantId","clientId","planId","remainingVisits","priceAtPurchase","issuedByUserId")
     VALUES ('sx','t1','u1','sp2',5,500000,'c1')$q$,
  '23503', 'Subscription_planId_tenantId_fkey');

-- CN2. Абонемент клуба t1 продан «в зале» клуба t2. По залу продажи считается
--      срок и раскладывается выручка дня, и чужой зал увёл бы и то и другое.
SELECT pg_temp.expect('CN2',
  $q$INSERT INTO "Subscription" (id,"tenantId","clientId","planId","remainingVisits","priceAtPurchase","issuedByUserId","soldAtHallId")
     VALUES ('sx','t1','u1','sp1',5,500000,'c1','h2')$q$,
  '23503', 'Subscription_soldAtHallId_tenantId_fkey');

-- CO. Абонемент ниоткуда: ни продавца, ни онлайн-платежа.
SELECT pg_temp.expect('CO',
  $q$INSERT INTO "Subscription" (id,"tenantId","clientId","planId","remainingVisits","priceAtPurchase")
     VALUES ('sx','t1','u1','sp1',5,500000)$q$,
  '23514', 'Subscription_has_origin');

-- CP. Остаток ниже нуля.
SELECT pg_temp.expect('CP',
  $q$UPDATE "Subscription" SET "remainingVisits" = -1 WHERE id = 's1'$q$,
  '23514', 'Subscription_visits_non_negative');

-- CQ. Запись u3 оплачена абонементом u1 — то, от чего составной ключ и
--     заведён: родитель платит за ребёнка ЕГО абонементом, а не своим.
SELECT pg_temp.expect('CQ',
  $q$INSERT INTO "TrainingBooking" (id,"tenantId","sessionId","clientId","priceAtBooking","subscriptionId","updatedAt")
     VALUES ('tbx','t1','ts1','u3',70000,'s1',now())$q$,
  '23503', 'TrainingBooking_subscriptionId_clientId_tenantId_fkey');

-- CR. Своя запись своим абонементом и списание визита — проходят.
DO $$ BEGIN
  INSERT INTO "TrainingBooking" (id,"tenantId","sessionId","clientId","priceAtBooking","subscriptionId","updatedAt")
  VALUES ('tbs1','t1','ts1','u1',70000,'s1',now());
  INSERT INTO "SubscriptionLedger" (id,"tenantId","subscriptionId",delta,"balanceAfter",reason,"trainingBookingId")
  VALUES ('lg1','t1','s1',-1,4,'VISIT_CHARGED','tbs1');
  RAISE NOTICE 'CR. Запись абонементом и списание приняты.. OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'CR. ПРОВАЛ: %', SQLERRM; END $$;

-- CS. Половина визита: у записи по абонементу процент — только 0 или 100.
SELECT pg_temp.expect('CS',
  $q$UPDATE "TrainingBooking" SET status = 'CANCELLED', "cancelledAt" = now(), "chargeRatio" = 50 WHERE id = 'tbs1'$q$,
  '23514', 'TrainingBooking_subscription_ratio');

-- CT. Возврат с минусом.
SELECT pg_temp.expect('CT',
  $q$INSERT INTO "SubscriptionLedger" (id,"tenantId","subscriptionId",delta,"balanceAfter",reason,"trainingBookingId")
     VALUES ('lgx','t1','s1',-1,3,'VISIT_REFUNDED','tbs1')$q$,
  '23514', 'SubscriptionLedger_delta_matches_reason');

-- CU. Сгорание строкой журнала: «сгорел» выводится из статуса записи, а
--     строка осталась бы ложью, стоило клубу исправить неявку.
SELECT pg_temp.expect('CU',
  $q$INSERT INTO "SubscriptionLedger" (id,"tenantId","subscriptionId",delta,"balanceAfter",reason,"trainingBookingId")
     VALUES ('lgx','t1','s1',0,4,'VISIT_BURNED','tbs1')$q$,
  '23514', 'SubscriptionLedger_delta_matches_reason');

-- CV. Корректировка без причины.
SELECT pg_temp.expect('CV',
  $q$INSERT INTO "SubscriptionLedger" (id,"tenantId","subscriptionId",delta,"balanceAfter",reason,"createdByUserId")
     VALUES ('lgx','t1','s1',-4,0,'ADMIN_ADJUSTMENT','c1')$q$,
  '23514', 'SubscriptionLedger_adjustment_explained');

-- CW. Правка строки журнала абонементов.
DO $$
DECLARE code text;
BEGIN
  UPDATE "SubscriptionLedger" SET delta = 0 WHERE id = 'lg1';
  RAISE NOTICE 'CW. ПРОВАЛ: строку журнала абонементов переписали!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23001' THEN
    RAISE NOTICE 'CW. Правка журнала абонементов отклонена... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'CW. ПРОВАЛ: отказ пришёл от %', code;
  END IF;
END $$;

-- CX. Удаление строки журнала — запрещено всем и всегда.
DO $$
DECLARE code text;
BEGIN
  DELETE FROM "SubscriptionLedger" WHERE id = 'lg1';
  RAISE NOTICE 'CX. ПРОВАЛ: строку журнала абонементов удалили!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23001' THEN
    RAISE NOTICE 'CX. Удаление строки журнала отклонено...... OK (ожидалось)';
  ELSE
    RAISE NOTICE 'CX. ПРОВАЛ: отказ пришёл от %', code;
  END IF;
END $$;

-- CY. Настройка сессии журналу не указ: лазейка для уборки смоука была и
--     снята по решению владельца от 20.09.2026.
DO $$
DECLARE code text;
BEGIN
  PERFORM set_config('yenisey.purge_probes', 'on', true);
  DELETE FROM "SubscriptionLedger" WHERE id = 'lg1';
  RAISE NOTICE 'CY. ПРОВАЛ: настройка сессии открыла журнал!';
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
  IF code = '23001' THEN
    RAISE NOTICE 'CY. Журнал закрыт и для уборки............. OK (ожидалось)';
  ELSE
    RAISE NOTICE 'CY. ПРОВАЛ: отказ пришёл от %', code;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 24. Контакты клуба
-- ---------------------------------------------------------------------------

-- CZ. Телефон клуба в человеческом написании. Номер уходит в ссылку `tel:`, и
--     «8 (391) 200-00-00» из неё дозванивается не везде — формат один на
--     платформу, как у телефона человека.
SELECT pg_temp.expect('CZ',
  $q$UPDATE "Tenant" SET phone = '8 (391) 200-00-00' WHERE id = 't1'$q$,
  '23514', 'Tenant_phone_format');

-- DA. Почта без собаки.
SELECT pg_temp.expect('DA',
  $q$UPDATE "Tenant" SET email = 'club.example.ru' WHERE id = 't1'$q$,
  '23514', 'Tenant_email_format');

-- DB. Годные контакты принимаются, а пустые остаются законными: клуб может
--     работать без общего номера.
DO $$ BEGIN
  UPDATE "Tenant" SET phone = '+73912000000', email = 'info@example.ru' WHERE id = 't1';
  UPDATE "Tenant" SET phone = NULL, email = NULL WHERE id = 't1';
  RAISE NOTICE 'DB. Контакты клуба приняты и снова сняты.. OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'DB. ПРОВАЛ: %', SQLERRM; END $$;

-- ---------------------------------------------------------------------------
-- 25. Уведомления
-- ---------------------------------------------------------------------------

-- Проверочное сообщение u1 и сводка платформы без клуба — законны: адресат
-- уведомления — человек, а не членство в клубе.
DO $$ BEGIN
  INSERT INTO "Notification" (id,"userId","tenantId",channel,type,"dedupeKey")
  VALUES ('n1','u1','t1','MAX','TEST','test:1'),
         ('n2','u2',NULL,'MAX','TEST','test:1');
  RAISE NOTICE 'DC. Уведомление с клубом и без клуба...... OK (ожидалось)';
EXCEPTION WHEN others THEN RAISE NOTICE 'DC. ПРОВАЛ: %', SQLERRM; END $$;

-- DD. То же сообщение тому же человеку второй раз — то, от чего ключ
--     идемпотентности и заведён: повторный проход планировщика не должен
--     прислать второе напоминание.
SELECT pg_temp.expect('DD',
  $q$INSERT INTO "Notification" (id,"userId",channel,type,"dedupeKey")
     VALUES ('n3','u1','MAX','TEST','test:1')$q$,
  '23505', 'Notification_userId_channel_dedupeKey_key');

-- DE. «Отправлено», но неизвестно когда.
SELECT pg_temp.expect('DE',
  $q$UPDATE "Notification" SET status = 'SENT' WHERE id = 'n1'$q$,
  '23514', 'Notification_sent_has_time');

-- DF. Пустой ключ идемпотентности склеил бы все сообщения человека в одно.
SELECT pg_temp.expect('DF',
  $q$INSERT INTO "Notification" (id,"userId",channel,type,"dedupeKey")
     VALUES ('n4','u1','MAX','TEST','')$q$,
  '23514', 'Notification_text_sane');

-- DG. Вторая учётка на того же пользователя MAX: её сообщения уходили бы
--     первому.
DO $$ BEGIN
  INSERT INTO "MaxLink" ("userId","maxUserId") VALUES ('u1', 1001);
EXCEPTION WHEN others THEN RAISE NOTICE 'DG. ПРОВАЛ подготовки: %', SQLERRM; END $$;

SELECT pg_temp.expect('DG',
  $q$INSERT INTO "MaxLink" ("userId","maxUserId") VALUES ('u2', 1001)$q$,
  '23505', 'MaxLink_maxUserId_key');

-- DH. Токен привязки, использованный после истечения.
SELECT pg_temp.expect('DH',
  $q$INSERT INTO "MaxLinkToken" (id,"userId","tokenHash","expiresAt","usedAt","createdAt")
     VALUES ('tl1','u1',repeat('a',64),now() + interval '15 minutes',now() + interval '1 hour',now())$q$,
  '23514', 'MaxLinkToken_times_sane');

-- ---------------------------------------------------------------------------
-- 26. Уведомления в браузер
-- ---------------------------------------------------------------------------

-- DI. Подписка на http-адрес — это не служба push, а запрос сервера внутрь сети.
SELECT pg_temp.expect('DI',
  $q$INSERT INTO "PushSubscription" (id,"userId",endpoint,p256dh,auth)
     VALUES ('ps1','u1','http://10.0.0.1/admin','k','a')$q$,
  '23514', 'PushSubscription_endpoint_https');

-- DJ. Одна подписка браузера — одна строка: тот же адрес второй раз не встанет.
DO $$ BEGIN
  INSERT INTO "PushSubscription" (id,"userId",endpoint,p256dh,auth)
  VALUES ('ps2','u1','https://push.example/abc','k','a');
EXCEPTION WHEN others THEN RAISE NOTICE 'DJ. ПРОВАЛ подготовки: %', SQLERRM; END $$;

SELECT pg_temp.expect('DJ',
  $q$INSERT INTO "PushSubscription" (id,"userId",endpoint,p256dh,auth)
     VALUES ('ps3','u2','https://push.example/abc','k','a')$q$,
  '23505', 'PushSubscription_endpoint_key');

-- ---------------------------------------------------------------------------
-- 27. Описание мероприятия
-- ---------------------------------------------------------------------------

-- DK. Описание из одних пробелов — мусор формы, окно показало бы пустой абзац.
SELECT pg_temp.expect('DK',
  $q$UPDATE "TrainingType" SET description = '   ' WHERE id = 'tt1'$q$,
  '23514', 'TrainingType_description_sane');

-- DL. Описание турнира длиннее потолка формы.
SELECT pg_temp.expect('DL',
  $q$INSERT INTO "TournamentType" (id,"tenantId",name,price,description,"updatedAt")
     VALUES ('trt-long','t1','Длинное описание',50000,repeat('я',2001),now())$q$,
  '23514', 'TournamentType_description_sane');

-- ---------------------------------------------------------------------------
-- 28. Справочник городов
-- ---------------------------------------------------------------------------

-- DM. Население ноль — опечатка в данных, а не самый маленький город.
SELECT pg_temp.expect('DM',
  $q$INSERT INTO "City" (id,name,region,population) VALUES ('city-zero','Нульград',NULL,0)$q$,
  '23514', 'City_population_sane');
