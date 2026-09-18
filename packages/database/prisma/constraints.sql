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

-- Окончание турнира появилось с отметкой присутствия (раздел 17): по нему
-- экран смены понимает, что турнир закончился, а джоба — когда ставить неявку.
ALTER TABLE "Tournament"
  ADD CONSTRAINT "Tournament_time_order" CHECK ("endsAt" > "startsAt");

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

-- Часовой пояс должен быть настоящей зоной IANA: опечатка «Asia/Krasnayarsk»
-- тихо сломает расчёт порога отмены и границ операционного дня. Приведение к
-- зоне падает с ошибкой на неизвестном имени — этим и проверяем.
--
-- Констрейнт стоит на ЗАЛЕ, а не на клубе: пояс переехал туда вместе с
-- городом и адресом, потому что залы одной организации бывают в разных
-- регионах.
--
-- Литерал-константа здесь не случайна: в CHECK допустимы только IMMUTABLE
-- функции, а now() STABLE — с ней Postgres откажется создавать констрейнт.
-- Вариант timezone(text, timestamp) без таймзоны в аргументе — иммутабельный.
ALTER TABLE "Hall"
  ADD CONSTRAINT "Hall_timezone_valid"
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

-- Остаток визитов не уходит в минус (null = безлимитный абонемент).
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_visits_non_negative"
  CHECK ("remainingVisits" IS NULL OR "remainingVisits" >= 0);

-- Источник визита соответствует его типу: у визита по записи заполнена ровно
-- своя ссылка, у визита с порога — ни одной.
--
-- До отметки присутствия здесь проверялось только «не две ссылки сразу», и
-- визит типа TRAINING без ссылки на запись был законен — под «визит,
-- добавленный администратором задним числом». Теперь такой визит — WALK_IN
-- (ТЗ описывает один инструмент и для «с порога», и для сверки истории), а
-- визит по записи без самой записи — потерянная связь: к нему нельзя
-- привязать уникальность «одна запись — один визит» (раздел 17), и две
-- отметки одного занятия легли бы двумя визитами.
ALTER TABLE "VisitLog"
  ADD CONSTRAINT "VisitLog_source_matches_type"
  CHECK (
    CASE "sourceType"
      WHEN 'TRAINING' THEN "trainingBookingId" IS NOT NULL
                      AND "tournamentRegistrationId" IS NULL
                      AND "tableBookingId" IS NULL
      WHEN 'TOURNAMENT' THEN "tournamentRegistrationId" IS NOT NULL
                        AND "trainingBookingId" IS NULL
                        AND "tableBookingId" IS NULL
      WHEN 'TABLE' THEN "tableBookingId" IS NOT NULL
                   AND "trainingBookingId" IS NULL
                   AND "tournamentRegistrationId" IS NULL
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

-- ---------------------------------------------------------------------------
-- 12. Закрытое время столов
-- ---------------------------------------------------------------------------
--
-- Накатано отдельными миграциями *_table_closures и *_halls_and_day_schedules:
-- этот файл правится вместе со схемой, а применённую миграцию Prisma сверяет
-- по контрольной сумме и откажется работать с изменённой задним числом.

-- Границы окна: полночь как конец — это 1440, а не 0, иначе интервал
-- вывернулся бы и правило «с 23:00 до полуночи» стало бы пустым.
ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_minutes_range"
  CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");

-- День недели по ISO-8601: 1 — понедельник, 7 — воскресенье. Ноль здесь
-- запрещён намеренно: в разных языках он означает то воскресенье, то
-- понедельник, и одна такая строка тихо сдвинула бы расписание на день.
ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_weekday_range"
  CHECK ("weekday" BETWEEN 1 AND 7);

-- Одно и то же время одного стола не должно быть закрыто двумя окнами:
-- иначе снятие блокировки в сетке убирало бы одно окно, а второе оставляло
-- бы стол закрытым, и администратор не понимал бы, почему.
-- Диапазон полуоткрытый '[)': окна 15:00-17:00 и 17:00-19:00 стыкуются.
ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_no_overlap"
  EXCLUDE USING gist (
    "tableId" WITH =,
    "weekday" WITH =,
    int4range("startMinute", "endMinute", '[)') WITH &&
  );

-- То же для расписания конкретной даты: границы окна и запрет двух окон на
-- одно время одного стола — внутри одного дня.
--
-- До 12.09.2026 этих двух ограничений в файле не было, хотя миграция
-- *_halls_and_day_schedules их накатывает: рабочая база их имела, а
-- `verify` разворачивал схему отсюда — и наложение окон дня не проверял
-- никто. Нашлось сверкой имён ограничений в базе с этим файлом.
ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_minutes_range"
  CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");

ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_no_overlap"
  EXCLUDE USING gist (
    "tableId" WITH =,
    "scheduleId" WITH =,
    int4range("startMinute", "endMinute", '[)') WITH &&
  );

-- Кто и что прикрепляется к окну, зависит от назначения.
--
-- Тренировка без тренера не попадёт в его статистику, и через месяц выяснить,
-- кто её вёл, будет неоткуда, — там тренер обязателен. Обязателен и тип
-- тренировки: от него зависит цена, а «просто тренировка» в расписании не
-- говорит клиенту ничего. Спарринг всегда с тренером, но заводить его может и
-- администратор, ещё не зная, кто проведёт, поэтому там тренер необязателен.
--
-- Аренда и робот не закрепляются ни за кем: окно только закрывает стол.
-- Клиент у окна был — «закреплённый арендатор», — и это оказалось ловушкой.
-- Окно не несёт ни цены, ни статуса, ни отмены, а человек, которого
-- администратор вписал кистью «Аренда», считал себя записанным и не видел
-- записи у себя в кабинете. С 12.09.2026 время, закреплённое за человеком, —
-- это бронь (`TableBooking`), и колонки `clientId` у окон больше нет.
--
-- Турнир в шаблоне недели хранится ТИПОМ, а не конкретным проведением: у
-- турнира дата, и из повторяющегося шаблона её не взять. Конкретный турнир
-- заводится, когда администратор открывает дату и сохраняет её расписание.
--
-- Перекрёстные поля запрещены, а не просто необязательны: тренер у аренды
-- набрал бы в статистику чужие часы.
ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_attachments_match_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose"
       AND "coachId" IS NOT NULL
       AND "trainingTypeId" IS NOT NULL AND "tournamentTypeId" IS NULL)
    OR ("purpose" = 'SPARRING'::"ClosurePurpose"
       AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NULL)
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose")
       AND "coachId" IS NULL AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NULL)
    OR ("purpose" = 'TOURNAMENT'::"ClosurePurpose"
       AND "coachId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NOT NULL)
    OR ("purpose" = 'OTHER'::"ClosurePurpose"
       AND "coachId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NULL)
  );

ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_attachments_match_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose"
       AND "coachId" IS NOT NULL
       AND "trainingTypeId" IS NOT NULL AND "tournamentId" IS NULL)
    OR ("purpose" = 'SPARRING'::"ClosurePurpose"
       AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL
       AND "trainingSessionId" IS NULL)
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose")
       AND "coachId" IS NULL AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL
       AND "trainingSessionId" IS NULL)
    OR ("purpose" = 'TOURNAMENT'::"ClosurePurpose"
       AND "coachId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentId" IS NOT NULL
       AND "trainingSessionId" IS NULL)
    OR ("purpose" = 'OTHER'::"ClosurePurpose"
       AND "coachId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL
       AND "trainingSessionId" IS NULL)
  );

-- Ссылка на конкретное занятие возможна только у дня и только при
-- purpose = TRAINING (ветка TRAINING выше её не упоминает — значит, разрешает
-- и NULL, и ссылку). Необязательна намеренно: администратор закрывает стол под
-- индивидуальное занятие, у которого сессии с лимитом мест нет вовсе.
--
-- Смысл ссылки в том, что занятое время стола и запись клиента становятся
-- одним фактом. Без неё это два списка, которым ничто не мешает разойтись.

-- ---------------------------------------------------------------------------
-- 13. Цены зала
-- ---------------------------------------------------------------------------

-- Если зал включил опцию робота, у него должны быть заданы цены робота —
-- иначе расчёт стоимости упрётся в NULL уже в проде. Раньше это же правило
-- стояло на Tenant; вместе с ценами оно переехало на зал.
ALTER TABLE "Hall"
  ADD CONSTRAINT "Hall_robot_prices_present"
  CHECK (
    NOT "hasRobotOption"
    OR ("robot30MinPrice" IS NOT NULL
        AND "robot60MinPrice" IS NOT NULL
        AND "robotExtra30MinPrice" IS NOT NULL)
  );

ALTER TABLE "Hall"
  ADD CONSTRAINT "Hall_prices_non_negative"
  CHECK (
    "tableHourPrice" >= 0
    AND "tableExtra30MinPrice" >= 0
    AND ("robot30MinPrice" IS NULL OR "robot30MinPrice" >= 0)
    AND ("robot60MinPrice" IS NULL OR "robot60MinPrice" >= 0)
    AND ("robotExtra30MinPrice" IS NULL OR "robotExtra30MinPrice" >= 0)
  );

-- ---------------------------------------------------------------------------
-- 14. Контакты пользователя
-- ---------------------------------------------------------------------------
--
-- Накатано миграцией *_user_contacts_required.

-- Формат E.164 для России. Та же проверка стоит в форме регистрации; здесь она
-- закрывает остальные пути записи — скрипты, импорт клиентской базы,
-- поправленную руками строку.
ALTER TABLE "User"
  ADD CONSTRAINT "User_phone_format"
  CHECK ("phone" ~ '^\+7[0-9]{10}$');

-- Дата рождения в разумных пределах. Нижняя граница 1900 года — она же
-- заглушка, подставленная миграцией уже заведённым сотрудникам.
--
-- CURRENT_DATE в CHECK недопустим — функция не IMMUTABLE, — поэтому верхняя
-- граница задана заведомо будущей датой. Полноту это не даёт, но опечатку в
-- веке («2062» вместо «2002») ловит; точную проверку делает API.
ALTER TABLE "User"
  ADD CONSTRAINT "User_birth_date_range"
  CHECK ("birthDate" >= DATE '1900-01-01' AND "birthDate" <= DATE '2100-01-01');

-- ---------------------------------------------------------------------------
-- 15. Платформенный слой: мои клубы, оформление клуба
-- ---------------------------------------------------------------------------
--
-- Накатано миграцией *_platform_layer.

-- Своих клубов не больше трёх (ТЗ → «Мои клубы»).
--
-- Предел выражен структурой, а не триггером и не проверкой в сервисе. Слот —
-- занятое место, уникальное в пределах человека (@@unique([userId, slot]) в
-- schema.prisma), а этот CHECK ограничивает набор мест тремя. Вместе они
-- означают, что четвёртый клуб физически некуда положить.
--
-- Проверкой «а сколько у него уже есть?» в коде это не заменяется: два
-- параллельных запроса оба прочитают «два клуба» и оба вставят третий с
-- четвёртым. Арбитром должна быть база — как и с двойным бронированием стола.
ALTER TABLE "UserClub"
  ADD CONSTRAINT "UserClub_slot_range"
  CHECK ("slot" BETWEEN 1 AND 3);

-- Фирменный цвет клуба — шестизначный HEX со «#».
--
-- Значение уезжает прямо в CSS-переменную на странице клуба. Мусор в нём
-- означал бы не пустое поле, а сломанную вёрстку, поэтому формат проверяется
-- здесь, а не только в форме настроек.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_accent_color_format"
  CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9a-fA-F]{6}$');

-- ---------------------------------------------------------------------------
-- 16. Ручная запись и её автор
-- ---------------------------------------------------------------------------

-- Запись, заведённая администратором, обязана помнить, кто её завёл.
--
-- За ручной записью стоят чужие деньги, и «кто меня записал» — первый вопрос
-- при споре. Ответить на него больше нечем: AuditLog на этом этапе не
-- пишется, а когда начнёт — у записей, заведённых раньше, автора уже не
-- появится. Само поле остаётся необязательным: у самостоятельной онлайн-
-- записи автора нет по смыслу, клиент сам себе не «автор».
ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_manual_has_author"
  CHECK ("source" <> 'MANUAL'::"BookingSource" OR "createdByUserId" IS NOT NULL);

ALTER TABLE "TrainingBooking"
  ADD CONSTRAINT "TrainingBooking_manual_has_author"
  CHECK ("source" <> 'MANUAL'::"BookingSource" OR "createdByUserId" IS NOT NULL);

ALTER TABLE "TournamentRegistration"
  ADD CONSTRAINT "TournamentRegistration_manual_has_author"
  CHECK ("source" <> 'MANUAL'::"BookingSource" OR "createdByUserId" IS NOT NULL);

-- Отменённая запись обязана нести момент отмены.
--
-- От него считается процент списания по политике клуба, и запись без него
-- делает спор о деньгах неразрешимым: неизвестно, отменили за сутки или за
-- минуту. Обратное неверно — момент отмены без статуса CANCELLED тут не
-- запрещён: он законно остаётся у записи, которую после отмены восстановили.
ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_cancelled_has_time"
  CHECK ("status" <> 'CANCELLED'::"BookingStatus" OR "cancelledAt" IS NOT NULL);

ALTER TABLE "TrainingBooking"
  ADD CONSTRAINT "TrainingBooking_cancelled_has_time"
  CHECK ("status" <> 'CANCELLED'::"BookingStatus" OR "cancelledAt" IS NOT NULL);

ALTER TABLE "TournamentRegistration"
  ADD CONSTRAINT "TournamentRegistration_cancelled_has_time"
  CHECK ("status" <> 'CANCELLED'::"BookingStatus" OR "cancelledAt" IS NOT NULL);

-- Чего здесь НЕТ и почему.
--
-- Пересечение брони стола с закрытым временем расписания НЕ запрещается.
-- Закрытое расписанием время закрыто только для самостоятельной онлайн-брони
-- клиента; администратор обязан мочь посадить человека поверх — ради этого
-- рабочее место и пишется. Констрейнт запретил бы ровно тот сценарий, для
-- которого раздел существует.
--
-- А вот TableBooking_no_overlap (раздел 1) не ослабляется и не снимается:
-- два человека за одним столом одновременно не помещаются физически, и
-- «администратор может всё» на этом заканчивается.

-- ---------------------------------------------------------------------------
-- 17. Отметка присутствия
-- ---------------------------------------------------------------------------
--
-- Накатано миграцией *_attendance. За отметкой стоят деньги: неявка списывает
-- процент клуба, присутствие — всю цену. Поэтому здесь то, что должно
-- выдерживать гонку двух администраторов, джобы и повторного нажатия.

-- Одна запись — один визит.
--
-- Отметку исправляют («пришёл» → «не пришёл»), и сервис обновляет уже
-- заведённый визит, а не заводит второй. Но исправление и джоба автонеявки
-- могут прийти одновременно, и проверка «визит уже есть?» в коде от этого не
-- спасает — две строки на одно занятие дали бы в истории клиента два визита.
-- Индексы частичные: у визита с порога ссылок нет вовсе.
CREATE UNIQUE INDEX "VisitLog_training_booking_uniq"
  ON "VisitLog" ("trainingBookingId")
  WHERE "trainingBookingId" IS NOT NULL;

CREATE UNIQUE INDEX "VisitLog_tournament_registration_uniq"
  ON "VisitLog" ("tournamentRegistrationId")
  WHERE "tournamentRegistrationId" IS NOT NULL;

CREATE UNIQUE INDEX "VisitLog_table_booking_uniq"
  ON "VisitLog" ("tableBookingId")
  WHERE "tableBookingId" IS NOT NULL;

-- Визит с порога: тот же человек в тот же момент — двойное нажатие «Внести
-- визит», а не два визита. Настоящий второй визит за день идёт с другим
-- временем.
CREATE UNIQUE INDEX "VisitLog_walk_in_uniq"
  ON "VisitLog" ("tenantId", "clientId", "visitedAt")
  WHERE "sourceType" = 'WALK_IN'::"VisitSourceType";

-- Визит с порога — всегда присутствие: «человек пришёл без брони и не
-- пришёл» не означает ничего.
ALTER TABLE "VisitLog"
  ADD CONSTRAINT "VisitLog_walk_in_attended"
  CHECK ("sourceType" <> 'WALK_IN'::"VisitSourceType" OR attended);

-- Без автора — только неявка по записи: её фиксирует джоба, человека за ней
-- нет. Присутствие и визит с порога всегда отмечает администратор, и «кто
-- поставил мне визит» — вопрос, на который обязан быть ответ.
ALTER TABLE "VisitLog"
  ADD CONSTRAINT "VisitLog_author_unless_auto_no_show"
  CHECK (
    "recordedByUserId" IS NOT NULL
    OR (NOT attended AND "sourceType" <> 'WALK_IN'::"VisitSourceType")
  );

-- Отмеченная запись несёт процент списания.
--
-- Пустой процент у неявки прежде читался как «джоба ещё не отработала» и
-- считался полным, у присутствия — как полная цена. Теперь процент — снимок
-- в момент отметки (100 у присутствия, процент клуба у неявки, 0 у
-- прощённой), и без него неявку нельзя отличить от прощённой. Строки,
-- отмеченные до этого раздела, не существуют: отмечать было нечем.
ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_marked_has_ratio"
  CHECK ("status" NOT IN ('ATTENDED'::"BookingStatus", 'NO_SHOW'::"BookingStatus") OR "chargeRatio" IS NOT NULL);

ALTER TABLE "TrainingBooking"
  ADD CONSTRAINT "TrainingBooking_marked_has_ratio"
  CHECK ("status" NOT IN ('ATTENDED'::"BookingStatus", 'NO_SHOW'::"BookingStatus") OR "chargeRatio" IS NOT NULL);

ALTER TABLE "TournamentRegistration"
  ADD CONSTRAINT "TournamentRegistration_marked_has_ratio"
  CHECK ("status" NOT IN ('ATTENDED'::"BookingStatus", 'NO_SHOW'::"BookingStatus") OR "chargeRatio" IS NOT NULL);

-- Журнал аудита — только вставки.
--
-- Схема так и называла его «append-only», но держала это только словами. За
-- строкой журнала стоит спор о деньгах: «я был на тренировке» разрешается
-- тем, кто, когда и с какой причиной поставил неявку. Журнал, который можно
-- поправить, доказательной силы не имеет — поэтому UPDATE, DELETE и TRUNCATE
-- отклоняет база, с кодом 23001 (restrict_violation).
CREATE FUNCTION "AuditLog_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog — журнал только для вставок, % запрещён', TG_OP
    USING ERRCODE = '23001';
END
$$;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "AuditLog_reject_change"();

CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "AuditLog_reject_change"();

-- Чего здесь НЕТ и почему.
--
-- «Отмечать можно только начавшееся» в CHECK не выражается: сравнение с
-- now() требует STABLE-функции, а CHECK принимает только IMMUTABLE (та же
-- причина, что у Hall_timezone_valid в разделе 3). Правило живёт в
-- decideMark (apps/api/src/attendance/attendance-rules.ts) и покрыто тестами.
--
-- Соответствие VisitLog.attended статусу записи тоже не проверяется: это
-- сравнение строк двух таблиц. Их согласованность держит одна транзакция
-- AttendanceService, которая меняет обе.

-- ---------------------------------------------------------------------------
-- 18. Профиль игрока: файлы, инвентарь, достижения, разряд
-- ---------------------------------------------------------------------------
--
-- Накатано миграцией *_players. Расширение сверх ТЗ по решению владельца
-- продукта от 12.09.2026. Денег здесь нет, зато есть чужие персональные
-- данные (скан приказа — с паспортными данными и датой рождения) и подпись
-- клуба, которой верят другие клубы.

-- Размер в строке — размер байтов, а не цифра, которую прислал клиент.
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_size_matches_data"
  CHECK ("size" = octet_length("data"));

-- Лимит своего вида. Аватар хранится уже пережатым (512×512 WebP, обычно
-- десятки килобайт), и мегабайт — потолок с запасом: больше означает, что
-- пережатие не сработало. Приказ — до 10 МБ: PDF хранится как есть.
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_size_within_limit"
  CHECK (
    "size" > 0 AND
    CASE "kind"
      WHEN 'AVATAR' THEN "size" <= 1048576
      WHEN 'RANK_DOCUMENT' THEN "size" <= 10485760
      WHEN 'COACH_PHOTO' THEN "size" <= 1048576
    END
  );

-- Формат своего вида. SVG нет нигде: это исполняемый код, притворяющийся
-- картинкой. Аватар — только WebP: сервер перекодирует любую картинку в него.
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_type_matches_kind"
  CHECK (
    CASE "kind"
      WHEN 'AVATAR' THEN "contentType" = 'image/webp'
      WHEN 'RANK_DOCUMENT' THEN "contentType" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
      WHEN 'COACH_PHOTO' THEN "contentType" = 'image/webp'
    END
  );

ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_sha256_format"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- Инвентарь: пусто — это NULL, а не пустая строка или пробелы. Иначе у
-- «ничего не указано» два написания, и публичная страница рисует пустую
-- строку под заголовком «Основание».
ALTER TABLE "PlayerProfile"
  ADD CONSTRAINT "PlayerProfile_equipment_filled"
  CHECK (
    ("blade" IS NULL OR ("blade" = btrim("blade") AND char_length("blade") BETWEEN 1 AND 100))
    AND ("forehandRubber" IS NULL OR ("forehandRubber" = btrim("forehandRubber") AND char_length("forehandRubber") BETWEEN 1 AND 100))
    AND ("backhandRubber" IS NULL OR ("backhandRubber" = btrim("backhandRubber") AND char_length("backhandRubber") BETWEEN 1 AND 100))
  );

ALTER TABLE "Achievement"
  ADD CONSTRAINT "Achievement_title_filled"
  CHECK ("title" = btrim("title") AND char_length("title") BETWEEN 1 AND 200);

ALTER TABLE "Achievement"
  ADD CONSTRAINT "Achievement_note_filled"
  CHECK ("note" IS NULL OR ("note" = btrim("note") AND char_length("note") BETWEEN 1 AND 500));

-- Место — с первого. Ноль и минус не значат ничего, а «участие» — это NULL.
ALTER TABLE "Achievement"
  ADD CONSTRAINT "Achievement_place_positive"
  CHECK ("place" IS NULL OR "place" >= 1);

-- Та же нижняя граница, что у даты рождения: раньше — опечатка в годе.
ALTER TABLE "Achievement"
  ADD CONSTRAINT "Achievement_date_sane"
  CHECK ("date" >= DATE '1900-01-01');

-- Номер и дата приказа — только вместе: приказ без даты не находится в
-- реестре, дата без номера не говорит ничего.
ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_order_complete"
  CHECK (("orderNumber" IS NULL) = ("orderDate" IS NULL));

ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_order_number_filled"
  CHECK ("orderNumber" IS NULL OR ("orderNumber" = btrim("orderNumber") AND char_length("orderNumber") BETWEEN 1 AND 50));

-- Разряд обоснован: приказ реквизитами либо сканом. Подтверждать «КМС, верьте
-- на слово» администратору нечем.
ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_justified"
  CHECK ("documentFileId" IS NOT NULL OR "orderNumber" IS NOT NULL);

-- Решение несёт того, кто его принял, где и когда; отказ — ещё и причину.
-- Разряд на проверке не несёт ничего: правка игроком стирает прежнее
-- решение целиком, иначе подпись «подтвердил клуб X» осталась бы висеть над
-- разрядом, которого клуб X не видел.
--
-- Оба поля проверяющего — вместе: составной внешний ключ с одной пустой
-- половиной Postgres не проверяет вовсе (MATCH SIMPLE).
ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_review_matches_status"
  CHECK (
    CASE "status"
      WHEN 'PENDING' THEN "reviewedByUserId" IS NULL AND "reviewedInTenantId" IS NULL
                      AND "reviewedAt" IS NULL AND "rejectionReason" IS NULL
      WHEN 'VERIFIED' THEN "reviewedByUserId" IS NOT NULL AND "reviewedInTenantId" IS NOT NULL
                       AND "reviewedAt" IS NOT NULL AND "rejectionReason" IS NULL
      WHEN 'REJECTED' THEN "reviewedByUserId" IS NOT NULL AND "reviewedInTenantId" IS NOT NULL
                       AND "reviewedAt" IS NOT NULL AND "rejectionReason" IS NOT NULL
    END
  );

ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_rejection_reason_filled"
  CHECK ("rejectionReason" IS NULL OR ("rejectionReason" = btrim("rejectionReason") AND char_length("rejectionReason") BETWEEN 1 AND 500));

-- Свой разряд не подтверждает никто. Администратор клуба, который играет в
-- этом же клубе, — обычное дело, и без запрета подпись «подтвердил клуб X»
-- значила бы «подтвердил сам себе» (решение владельца от 12.09.2026).
ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_not_self_review"
  CHECK ("reviewedByUserId" IS NULL OR "reviewedByUserId" <> "userId");

-- Чего здесь НЕТ и почему.
--
-- Вид файла по ссылке (аватар ссылается на AVATAR, приказ — на
-- RANK_DOCUMENT) не проверяется: это сравнение со строкой другой таблицы.
-- Владельца база проверяет — составной ключ (файл, человек), — и перепутанный
-- вид означал бы только битую картинку, а не чужие данные. Вид выбирает
-- сервис, и выбирает по маршруту, а не по запросу.
--
-- Что проверяющий в своём клубе администратор, а игрок там состоит, — тоже
-- сравнение строк других таблиц. Это держит сервис, а база держит главное:
-- проверяющий — человек именно того клуба, что в подписи.
--
-- «Достижение не из будущего» в CHECK не выражается: now() не IMMUTABLE
-- (та же причина, что в разделе 17). Проверка — в сервисе.

-- ---------------------------------------------------------------------------
-- 19. Семья: закрепление ребёнка за родителем
-- ---------------------------------------------------------------------------
--
-- Накатано миграцией *_guardianship. Расширение сверх ТЗ по решениям
-- владельца от 12.09 и 17.09.2026. За строкой — право записывать чужого
-- человека, отменять его записи и видеть его историю и скан приказа.

-- Родитель один.
--
-- Уникальна только ДЕЙСТВУЮЩАЯ опека, а не любая строка по ребёнку: после
-- снятия ребёнка законно закрепляют заново, а заявок бывает несколько — иначе
-- посторонний, знающий почту ребёнка, первой заявкой занял бы место
-- настоящего родителя. Подтверждение одной заявки закрывает остальные, а гонку
-- двух подтверждений ловит этот индекс.
CREATE UNIQUE INDEX "Guardianship_one_active_per_child"
  ON "Guardianship" ("childUserId")
  WHERE "status" = 'ACTIVE'::"GuardianshipStatus";

-- Одна ждущая заявка от одного взрослого одному ребёнку: повторное нажатие —
-- то же намерение, а не вторая строка в кабинете ребёнка.
CREATE UNIQUE INDEX "Guardianship_one_pending_per_pair"
  ON "Guardianship" ("childUserId", "guardianUserId")
  WHERE "status" = 'PENDING'::"GuardianshipStatus";

ALTER TABLE "Guardianship"
  ADD CONSTRAINT "Guardianship_not_self"
  CHECK ("childUserId" <> "guardianUserId");

-- Состояние несёт свои отметки и не несёт чужих: подтверждённая — момент
-- подтверждения, отклонённая — момент отказа, снятая — момент и того, кто
-- снял. Заявка без ответа не несёт ничего.
ALTER TABLE "Guardianship"
  ADD CONSTRAINT "Guardianship_status_matches_times"
  CHECK (
    CASE "status"
      WHEN 'PENDING' THEN "confirmedAt" IS NULL AND "rejectedAt" IS NULL
                      AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL
      WHEN 'ACTIVE' THEN "confirmedAt" IS NOT NULL AND "rejectedAt" IS NULL
                     AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL
      WHEN 'REJECTED' THEN "rejectedAt" IS NOT NULL AND "confirmedAt" IS NULL
                       AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL
      WHEN 'REVOKED' THEN "confirmedAt" IS NOT NULL AND "revokedAt" IS NOT NULL
                      AND "revokedByUserId" IS NOT NULL
    END
  );

-- Клуб, снявший закрепление, называет того, кто снял, и объясняет почему:
-- восстановления пароля нет, и отзыв клубом — выход для ребёнка, чей родитель
-- потерял учётку, а не способ переписать семью без следа.
--
-- Клуб без человека пропускать нельзя: составной внешний ключ с одной пустой
-- половиной Postgres не проверяет вовсе (MATCH SIMPLE).
ALTER TABLE "Guardianship"
  ADD CONSTRAINT "Guardianship_club_revoke_explained"
  CHECK (
    "revokedInTenantId" IS NULL
    OR ("revokedByUserId" IS NOT NULL AND "revokeReason" IS NOT NULL)
  );

ALTER TABLE "Guardianship"
  ADD CONSTRAINT "Guardianship_revoke_reason_filled"
  CHECK ("revokeReason" IS NULL OR ("revokeReason" = btrim("revokeReason") AND char_length("revokeReason") BETWEEN 1 AND 500));

-- Чего здесь НЕТ и почему.
--
-- Возраст — «ребёнку меньше 16», «родителю 18» — в CHECK не выражается: это
-- сравнение с сегодняшним днём, а now() не IMMUTABLE (та же причина, что в
-- разделах 17 и 18). Правила — guardianship-rules.ts, под тестами, и
-- проверяются в момент каждого действия: в день шестнадцатилетия строка
-- остаётся ACTIVE как история, а права кончаются сами.
--
-- Что снимающий от имени клуба там администратор, а ребёнок в этом клубе
-- состоит, — сравнение строк других таблиц. Это держит сервис, а база держит
-- главное: снимающий — человек именно того клуба, что записан.

-- ---------------------------------------------------------------------------
-- 20. Карточка тренера
-- ---------------------------------------------------------------------------
--
-- Накатано миграцией *_coach_profile. Карточка публична: её читают, не входя,
-- и ошибка здесь видна всем, а не одному человеку.

-- Пусто — это NULL, а не пустая строка: у «не заполнено» одно написание, иначе
-- публичная страница рисует пустоту под заголовком. Границы длины — те же
-- соображения, что у инвентаря игрока, только текст здесь связный, а не
-- название модели.
ALTER TABLE "CoachProfile"
  ADD CONSTRAINT "CoachProfile_text_filled"
  CHECK (
    ("achievements" IS NULL OR ("achievements" = btrim("achievements") AND char_length("achievements") BETWEEN 1 AND 2000))
    AND ("inventory" IS NULL OR ("inventory" = btrim("inventory") AND char_length("inventory") BETWEEN 1 AND 1000))
    AND ("priceInfo" IS NULL OR ("priceInfo" = btrim("priceInfo") AND char_length("priceInfo") BETWEEN 1 AND 500))
  );

-- Чего здесь НЕТ и почему.
--
-- socialLinks — Json, и его структуру ([{ label, url }], только http(s), не
-- больше десяти) держит coach-rules.ts под тестами. CHECK по jsonb выражается,
-- но читается хуже правила и расходится с ним первым же изменением формы.
--
-- «Фото принадлежит тому же человеку» держит не CHECK, а составной внешний ключ
-- (photoFileId, userId) → StoredFile (id, ownerUserId): чужой файл в карточку
-- не положить. Размер и формат самого файла — раздел 18, ветка COACH_PHOTO.
