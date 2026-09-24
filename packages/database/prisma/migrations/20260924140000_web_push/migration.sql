-- Уведомления в браузер (Web Push, фаза 5): подписки устройств. Сообщения
-- идут через ту же очередь Notification, каналом WEB_PUSH.

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMPTZ(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ограничения — те же, что в разделе 23 constraints.sql.
ALTER TABLE "PushSubscription"
  ADD CONSTRAINT "PushSubscription_endpoint_https"
  CHECK ("endpoint" ~ '^https://' AND char_length("endpoint") <= 1000);

ALTER TABLE "PushSubscription"
  ADD CONSTRAINT "PushSubscription_keys_sane"
  CHECK (
    char_length("p256dh") BETWEEN 1 AND 200
    AND char_length("auth") BETWEEN 1 AND 100
    AND ("userAgent" IS NULL OR char_length("userAgent") <= 300)
  );
