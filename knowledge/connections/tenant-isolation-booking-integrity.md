---
title: "Connection: Tenant Isolation and Booking Integrity"
connects:
  - "concepts/tenant-isolation-composite-keys"
  - "concepts/booking-payment-engine"
sources:
  - "daily/2026-08-21.md"
created: 2026-08-21
updated: 2026-08-21
---

# Connection: Tenant Isolation and Booking Integrity

## The Connection

Составные внешние ключи по паре `(id, tenantId)` — это не абстрактная забота о мультиарендности, а конкретная защита целостности бронирований: СУБД физически не допустит создание записи, в которой клиент принадлежит одному клубу, а сессия/тренер/стол — другому.

## Key Insight

Без составных FK кросс-тенантная коррупция данных бронирований возможна даже при корректном коде: достаточно бага в middleware, неправильного `tenantId` в JWT или race condition при переключении контекста. Проверка `WHERE tenantId = ?` в ORM ловит чтение, но не ловит запись с чужим FK. Составные ключи превращают эту ошибку из логической (тихая коррупция данных) в физическую (FK violation — ошибка сразу).

## Evidence

При проектировании схемы БД (сессия 2026-08-21) сформулировано: «Postgres физически не принимает бронь с сессией одного клуба и клиентом другого» — это прямое следствие решения дублировать `tenantId` и строить FK по парам. Решение принято именно для защиты критичных путей (бронирование + оплата), где ошибка имеет финансовые последствия.

## Related Concepts

- [[concepts/tenant-isolation-composite-keys]] — архитектурное решение по изоляции
- [[concepts/booking-payment-engine]] — движок, где изоляция критична для корректности транзакций
- [[concepts/database-schema-conventions]] — общие конвенции схемы
