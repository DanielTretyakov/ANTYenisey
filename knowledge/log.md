# Build Log

## [2026-08-26T12:23:53+07:00] compile | 2026-08-25.md
- Source: daily/2026-08-25.md
- Articles created: (none)
- Articles updated: (none)
- Note: Daily log contained no session content (only memory flush entries — errors and "nothing worth saving")

## [2026-08-25T22:05:11+07:00] compile | 2026-08-21.md (re-compile)
- Source: daily/2026-08-21.md
- Articles created: (none — all existed on disk)
- Articles indexed: [[concepts/database-schema-conventions]], [[concepts/tenant-isolation-composite-keys]], [[connections/tenant-isolation-booking-integrity]]
- Note: Three articles from Session 2 (19:13) were created in a prior compile but missing from index.md. No content changes needed — articles already fully cover both sessions.

## [2026-08-21T15:19:50+07:00] compile | 2026-08-21.md
- Source: daily/2026-08-21.md
- Articles created: [[concepts/yenisey-platform-overview]], [[concepts/booking-payment-engine]], [[concepts/club-subscription-billing]], [[concepts/cancellation-hold-policy]], [[concepts/tournament-module]], [[concepts/cash-payment-flow]], [[connections/payment-hold-legal-dependency]]
- Articles updated: (none)

## [2026-08-13T22:21:00+07:00] compile | 2026-08-13.md
- Source: daily/2026-08-13.md
- Articles created: (none)
- Articles updated: (none)
- Note: Daily log contained no session content (FLUSH_OK — nothing worth saving)

## [2026-08-13T19:15:00] setup | Инициализация автоматической knowledge base

Перенесён claude-memory-compiler в корень проекта ANTYenisey, установлен uv, подключены hooks (SessionStart/PreCompact/SessionEnd). Ручная схема (raw/wiki/CLAUDE.md) удалена в пользу автоматического компилятора.
