-- ---------------------------------------------------------------------------
-- Ограничения целостности, которые нельзя выразить в schema.prisma
-- ---------------------------------------------------------------------------
--
-- Prisma умеет описывать таблицы, связи и обычные индексы, но не умеет:
--   * exclusion-констрейнты (запрет пересечения интервалов),
--   * частичные уникальные индексы (уникальность только для части строк),
--   * check-констрейнты.
--
-- Всё это накатывается как raw-SQL миграция: создаётся пустая миграция
--     npx prisma migrate dev --create-only --name integrity_constraints
-- и содержимое этого файла копируется в её migration.sql.
--
-- ВАЖНО: это не «дополнительная перестраховка», а единственное надёжное
-- место для таких правил. Проверка в коде («свободен ли стол?») не спасает
-- от гонки: два параллельных запроса оба прочитают, что стол свободен, и
-- оба вставят бронь. Арбитром должна быть база.

-- ---------------------------------------------------------------------------
-- 1. Двойное бронирование стола
-- ---------------------------------------------------------------------------

-- btree_gist нужен, чтобы в одном GiST-индексе сочетать проверку на
-- равенство (tableId) с проверкой на пересечение диапазонов.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Один стол не может быть занят двумя бронями с пересекающимся временем.
-- Диапазон полуоткрытый '[)': бронь 18:00-19:00 и бронь 19:00-20:00 не
-- считаются пересекающимися — стык допустим.
-- Отменённые брони и неявки из проверки исключены: они время не занимают.
ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_no_overlap"
  EXCLUDE USING gist (
    "tableId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status IN ('BOOKED'::"BookingStatus", 'ATTENDED'::"BookingStatus"));

-- ---------------------------------------------------------------------------
-- 2. Повторная запись одного клиента на одно и то же событие
-- ---------------------------------------------------------------------------

-- Индексы частичные (WHERE status = 'BOOKED') намеренно: обычный UNIQUE
-- запретил бы клиенту записаться заново после того, как он сам же отменил
-- запись, — а это законный сценарий.

CREATE UNIQUE INDEX "TrainingBooking_active_client_uniq"
  ON "TrainingBooking" ("sessionId", "clientId")
  WHERE status = 'BOOKED'::"BookingStatus";

CREATE UNIQUE INDEX "TournamentRegistration_active_client_uniq"
  ON "TournamentRegistration" ("tournamentId", "clientId")
  WHERE status = 'BOOKED'::"BookingStatus";

-- ---------------------------------------------------------------------------
-- 3. Инварианты, описанные в комментариях схемы
-- ---------------------------------------------------------------------------

-- Бронь стола принадлежит либо клиенту, либо тренеру (спарринг), но не обоим
-- сразу и не «никому».
ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_client_xor_coach"
  CHECK (("clientId" IS NOT NULL)::int + ("coachId" IS NOT NULL)::int = 1);

-- Спарринг всегда инициирован тренером.
ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_sparring_has_coach"
  CHECK (NOT "isSparring" OR "coachId" IS NOT NULL);

-- Время идёт вперёд. Без этого exclusion-констрейнт выше принял бы
-- вывернутый диапазон и молча перестал ловить пересечения.
ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_time_order" CHECK ("endsAt" > "startsAt");

ALTER TABLE "TrainingSession"
  ADD CONSTRAINT "TrainingSession_time_order" CHECK ("endsAt" > "startsAt");

-- Доля списания по политике отмены — процент от 0 до 100.
--
-- Раньше здесь стояло IN (0, 50, 100) по значениям «Енисея». После того как
-- политика отмены стала настройкой клуба (CancellationTier), это правило
-- превратилось бы в мину: стоит клубу выставить ступень с любым другим
-- процентом — и запись брони упадёт с ошибкой констрейнта. Границы
-- диапазона проверять можно, набор конкретных значений — нет.
ALTER TABLE "TrainingBooking"
  ADD CONSTRAINT "TrainingBooking_charge_ratio"
  CHECK ("chargeRatio" IS NULL OR "chargeRatio" BETWEEN 0 AND 100);

ALTER TABLE "TournamentRegistration"
  ADD CONSTRAINT "TournamentRegistration_charge_ratio"
  CHECK ("chargeRatio" IS NULL OR "chargeRatio" BETWEEN 0 AND 100);

ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_charge_ratio"
  CHECK ("chargeRatio" IS NULL OR "chargeRatio" BETWEEN 0 AND 100);

-- Ступени политики отмены и процент за неявку — тоже проценты.
ALTER TABLE "CancellationTier"
  ADD CONSTRAINT "CancellationTier_percent_range"
  CHECK ("chargePercent" BETWEEN 0 AND 100);

ALTER TABLE "CancellationTier"
  ADD CONSTRAINT "CancellationTier_threshold_non_negative"
  CHECK ("minMinutesBeforeStart" >= 0);

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_no_show_percent_range"
  CHECK ("noShowChargePercent" BETWEEN 0 AND 100);

-- Напоминание об неотмеченном присутствии должно приходить РАНЬШЕ, чем
-- система сама зафиксирует неявку, иначе эскалация теряет смысл.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_escalation_order"
  CHECK ("attendanceAutoNoShowAfterMinutes" > "attendanceReminderAfterMinutes");

-- Часовой пояс клуба должен быть настоящей зоной IANA: опечатка «Asia/
-- Krasnayarsk» тихо сломает расчёт порога отмены и границ операционного дня.
-- Приведение к зоне падает с ошибкой на неизвестном имени — этим и проверяем.
--
-- Литерал-константа здесь не случайна: в CHECK допустимы только IMMUTABLE
-- функции, а now() STABLE — с ней Postgres откажется создавать констрейнт.
-- Вариант timezone(text, timestamp) без таймзоны в аргументе — иммутабельный.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_timezone_valid"
  CHECK ((TIMESTAMP '2000-01-01 00:00:00' AT TIME ZONE timezone) IS NOT NULL);

-- Деньги не бывают отрицательными, а списать больше, чем захолдировано,
-- нельзя ни при какой политике отмены.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amounts_sane"
  CHECK (
    ("holdAmount" IS NULL OR "holdAmount" >= 0)
    AND ("capturedAmount" IS NULL OR "capturedAmount" >= 0)
    AND ("holdAmount" IS NULL OR "capturedAmount" IS NULL OR "capturedAmount" <= "holdAmount")
  );

-- Если клуб включил опцию робота, у него должны быть заданы цены робота —
-- иначе расчёт стоимости упрётся в NULL уже в проде.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_robot_prices_present"
  CHECK (
    NOT "hasRobotOption"
    OR ("robot30MinPrice" IS NOT NULL
        AND "robot60MinPrice" IS NOT NULL
        AND "robotExtra30MinPrice" IS NOT NULL)
  );

-- Остаток визитов не уходит в минус (null = безлимитный абонемент).
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_visits_non_negative"
  CHECK ("remainingVisits" IS NULL OR "remainingVisits" >= 0);

-- У визита не может быть двух источников сразу, и заполненный источник
-- обязан соответствовать заявленному типу. Пустые ссылки при этом законны:
-- визит «с порога» и визит, добавленный администратором задним числом при
-- сверке истории, брони не имеют вовсе.
ALTER TABLE "VisitLog"
  ADD CONSTRAINT "VisitLog_source_matches_type"
  CHECK (
    CASE "sourceType"
      WHEN 'TRAINING' THEN "tournamentRegistrationId" IS NULL AND "tableBookingId" IS NULL
      WHEN 'TOURNAMENT' THEN "trainingBookingId" IS NULL AND "tableBookingId" IS NULL
      WHEN 'TABLE' THEN "trainingBookingId" IS NULL AND "tournamentRegistrationId" IS NULL
      WHEN 'WALK_IN' THEN "trainingBookingId" IS NULL
                     AND "tournamentRegistrationId" IS NULL
                     AND "tableBookingId" IS NULL
    END
  );

-- То же для движений по балансу абонемента: максимум один источник.
ALTER TABLE "SubscriptionLedger"
  ADD CONSTRAINT "SubscriptionLedger_single_source"
  CHECK (
    ("trainingBookingId" IS NOT NULL)::int
    + ("tournamentRegistrationId" IS NOT NULL)::int
    + ("tableBookingId" IS NOT NULL)::int <= 1
  );

-- Абонемент либо лимитирован по визитам, либо безлимитный. Аренда стола
-- «только в безлимитных тарифах» бессмысленна там, где аренда вообще не
-- входит в покрытие.
ALTER TABLE "SubscriptionPlan"
  ADD CONSTRAINT "SubscriptionPlan_table_rental_flags"
  CHECK (NOT "tableRentalUnlimitedOnly" OR "coversTableRental");

-- Срок жизни refresh-токена всегда в будущем относительно момента выдачи.
ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_expiry_after_issue"
  CHECK ("expiresAt" > "createdAt");

-- Платящая подписка клуба обязана иметь тариф и зафиксированную цену.
-- Без тарифа остаётся только EXEMPT — статус «Енисея» как пилотного клуба.
-- Иначе джоба биллинга однажды получит подписку, по которой неизвестно,
-- сколько списывать.
ALTER TABLE "TenantSubscription"
  ADD CONSTRAINT "TenantSubscription_plan_required_unless_exempt"
  CHECK (
    status = 'EXEMPT'::"PlatformSubscriptionStatus"
    OR ("planId" IS NOT NULL AND "priceAtPurchase" IS NOT NULL)
  );

-- Цена тарифа платформы неотрицательна, срок — хотя бы месяц.
ALTER TABLE "PlatformPlan"
  ADD CONSTRAINT "PlatformPlan_sane"
  CHECK (price >= 0 AND "periodMonths" >= 1);

-- ---------------------------------------------------------------------------
-- 4. Переполнение группы — то, что констрейнтом не решается
-- ---------------------------------------------------------------------------
--
-- Лимит мест нельзя выразить ни check-констрейнтом, ни уникальным индексом:
-- проверка требует подсчёта строк в другой таблице. Гонка здесь реальна —
-- два запроса читают «занято 9 из 10» и оба вставляют бронь.
--
-- Решение на уровне приложения: сериализовать запись через блокировку строки
-- самой сессии. Обе транзакции пойдут по очереди, вторая увидит уже
-- обновлённое количество.
--
--   BEGIN;
--     SELECT "capacity" FROM "TrainingSession" WHERE id = $1 FOR UPDATE;
--     SELECT count(*) FROM "TrainingBooking"
--       WHERE "sessionId" = $1 AND status = 'BOOKED';
--     -- если count >= capacity → откат с ошибкой «мест нет»
--     INSERT INTO "TrainingBooking" ...;
--   COMMIT;
--
-- В Prisma это $transaction + $queryRaw для строки с FOR UPDATE.
--
-- Альтернатива, если захочется гарантии на уровне БД: денормализованный
-- счётчик "bookedCount" на TrainingSession с CHECK ("bookedCount" <=
-- "capacity"), обновляемый в той же транзакции. Даёт защиту от любого
-- клиента БД, но требует держать счётчик в согласии с реальностью.
