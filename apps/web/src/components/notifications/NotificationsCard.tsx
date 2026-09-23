'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MaxLinkResponse, NotificationCategoryName, NotificationSettingsView } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { api, ApiError } from '@/lib/api';

/**
 * Что присылать. Категория появляется здесь в тот день, когда сервер начинает
 * по ней что-то слать: переключатель без единого сообщения за ним обещал бы
 * несуществующее. Сервер отдаёт все категории по ролям человека — показываются
 * только описанные.
 */
const CATEGORY_TEXT: Partial<Record<NotificationCategoryName, { label: string; hint: string }>> = {};

/** Как часто спрашивать, привязался ли MAX, пока ссылка открыта. */
const POLL_MS = 3_000;

/**
 * Уведомления в MAX: привязка, проверочное сообщение и что присылать.
 *
 * Привязка идёт через бота: сайт выдаёт ссылку с одноразовым токеном, человек
 * открывает её в MAX и нажимает «Начать». Сайт узнаёт о привязке, спрашивая
 * сервер раз в три секунды, пока ссылка действует.
 */
export function NotificationsCard() {
  const [view, setView] = useState<NotificationSettingsView | null>(null);
  const [link, setLink] = useState<MaxLinkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await api.notificationSettings();

      if (mounted.current) {
        setView(next);
      }

      return next;
    } catch (cause) {
      if (mounted.current) {
        setError(messageOf(cause));
      }

      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();

    return () => {
      mounted.current = false;
    };
  }, [load]);

  // Ссылка открыта — ждём, пока человек нажмёт «Начать» в MAX.
  useEffect(() => {
    if (!link) {
      return;
    }

    const expires = new Date(link.expiresAt).getTime();
    const timer = window.setInterval(() => {
      if (Date.now() > expires) {
        setLink(null);
        return;
      }

      void load().then((next) => {
        if (next?.max.linked && !next.max.blocked) {
          setLink(null);
          setNotice('MAX подключён. Бот уже прислал подтверждение.');
        }
      });
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [link, load]);

  async function run(key: string, action: () => Promise<void>): Promise<void> {
    setPending(key);
    setError(null);
    setNotice(null);

    try {
      await action();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(null);
    }
  }

  const max = view?.max;
  const categories = view?.categories.filter((item) => CATEGORY_TEXT[item.category]) ?? [];

  return (
    <div id="notifications" className="scroll-mt-24">
      <Card className="mt-6 max-w-2xl">
        <CardHeader
          title="Уведомления в MAX"
          description="Напоминания о записях и новости клуба — сообщениями от бота «Енисея» в мессенджере MAX."
        />
        <CardBody>
          {error && <Alert>{error}</Alert>}
          {notice && <Alert tone="info">{notice}</Alert>}

          {!view && !error && <p className="text-[0.875rem] text-text-muted">Загружаю…</p>}

          {max && !max.available && (
            <p className="text-[0.875rem] text-text-muted">
              Бот пока не подключён к сайту. Как только он заработает, здесь появится кнопка подключения.
            </p>
          )}

          {max?.available && !max.linked && (
            <div>
              {link ? (
                <>
                  <p className="mb-4 text-[0.9375rem] text-text">
                    Откройте ссылку и нажмите «Начать» в чате с ботом. Ссылка действует 15 минут.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 items-center rounded-control bg-accent px-5 text-[0.9375rem] font-medium text-accent-text shadow-sm hover:bg-accent-hover"
                    >
                      Открыть MAX
                    </a>
                    <Button variant="ghost" onClick={() => setLink(null)}>
                      Отмена
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mb-4 text-[0.9375rem] text-text-muted">
                    Подключите MAX, и бот будет присылать напоминания о записях.
                  </p>
                  <Button pending={pending === 'link'} onClick={() => void run('link', async () => setLink(await api.linkMax()))}>
                    Подключить MAX
                  </Button>
                </>
              )}
            </div>
          )}

          {max?.linked && (
            <div>
              {max.blocked ? (
                <Alert tone="warning">
                  Бот остановлен в MAX, и сообщения не доходят. Откройте чат с ботом «Енисея» и нажмите «Начать» —
                  подключать заново не нужно.
                </Alert>
              ) : (
                <p className="mb-4 text-[0.9375rem] text-text">
                  MAX подключён{max.linkedAt ? ` ${formatDate(max.linkedAt)}` : ''}.
                </p>
              )}

              {categories.length > 0 && (
                <fieldset className="mb-4">
                  <legend className="mb-3 text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">Что присылать</legend>
                  {categories.map((item) => {
                    const text = CATEGORY_TEXT[item.category]!;

                    return (
                      <Toggle
                        key={item.category}
                        label={text.label}
                        hint={text.hint}
                        checked={item.enabled}
                        disabled={pending !== null}
                        onChange={(event) => {
                          const enabled = event.currentTarget.checked;
                          void run(item.category, async () =>
                            setView(await api.setNotificationCategory(item.category, enabled)),
                          );
                        }}
                      />
                    );
                  })}
                </fieldset>
              )}

              <div className="flex flex-wrap gap-3">
                {!max.blocked && (
                  <Button
                    variant="secondary"
                    pending={pending === 'test'}
                    onClick={() =>
                      void run('test', async () => {
                        await api.sendTestNotification();
                        setNotice('Проверочное сообщение отправлено — оно придёт в течение минуты.');
                      })
                    }
                  >
                    Отправить проверочное
                  </Button>
                )}
                <Button
                  variant="danger-ghost"
                  pending={pending === 'unlink'}
                  onClick={() => void run('unlink', async () => setView(await api.unlinkMax()))}
                >
                  Отключить
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Сервис недоступен';
}

/** «23 сентября». */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
