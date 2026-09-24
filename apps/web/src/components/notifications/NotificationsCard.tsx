'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MaxLinkResponse, NotificationCategoryName, NotificationSettingsView } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { api, ApiError } from '@/lib/api';
import { currentSubscription, PushSetupError, pushSupport, subscribe, subscriptionBody, type PushSupport } from '@/lib/push';

/**
 * Что присылать. Категория появляется здесь в тот день, когда сервер начинает
 * по ней что-то слать: переключатель без единого сообщения за ним обещал бы
 * несуществующее. Сервер отдаёт все категории по ролям человека — показываются
 * только описанные.
 */
const CATEGORY_TEXT: Partial<Record<NotificationCategoryName, { label: string; hint: string }>> = {
  MY_BOOKINGS: {
    label: 'Мои записи',
    hint: 'Подтверждение и отмена записи, напоминание за три часа до начала, отмеченная неявка.',
  },
  MY_SUBSCRIPTION: {
    label: 'Мой абонемент',
    hint: 'За три дня до конца срока, когда остался последний визит и когда визиты кончились.',
  },
  COACH_GROUPS: {
    label: 'Мои группы',
    hint: 'Каждая запись и отмена в ваших группах, утром — занятия на день.',
  },
  CLUB_ALERTS: {
    label: 'Дела клуба',
    hint: 'Присутствие не отмечено через час после окончания, итог автоматических неявок, разряд на проверку.',
  },
  CLUB_DIGEST: {
    label: 'Сводка клуба',
    hint: 'В 9:00: вчерашние цифры и деньги, новые люди, у кого кончаются абонементы, план на сегодня.',
  },
  PLATFORM_DIGEST: {
    label: 'Сводка платформы',
    hint: 'В 9:00: новые учётки и клубы, кто выбрал клубы своими, записи и состояние уведомлений.',
  },
};

/** Как часто спрашивать, привязался ли MAX, пока ссылка открыта. */
const POLL_MS = 3_000;

/**
 * Уведомления: MAX, браузер на этом устройстве, что присылать и проверка.
 *
 * Привязка MAX идёт через бота: сайт выдаёт ссылку с одноразовым токеном,
 * человек открывает её в MAX и нажимает «Начать». Сайт узнаёт о привязке,
 * спрашивая сервер раз в три секунды, пока ссылка действует.
 *
 * Браузер подписывается сам (lib/push.ts), а сервер хранит подписку. Что
 * присылать — одно на оба канала: подключил оба — получит в оба.
 */
export function NotificationsCard() {
  const [view, setView] = useState<NotificationSettingsView | null>(null);
  const [link, setLink] = useState<MaxLinkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // Подписано ли ЭТО устройство — знает только браузер. null — ещё не узнали.
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [deviceSubscribed, setDeviceSubscribed] = useState<boolean | null>(null);
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

    setSupport(pushSupport());
    void currentSubscription()
      .then((subscription) => {
        if (mounted.current) {
          setDeviceSubscribed(subscription !== null);
        }
      })
      .catch(() => {
        if (mounted.current) {
          setDeviceSubscribed(false);
        }
      });

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
  const push = view?.push;
  const categories = view?.categories.filter((item) => CATEGORY_TEXT[item.category]) ?? [];
  // Настройки и проверка нужны, когда хоть один канал доставляет.
  const connected = Boolean((max?.linked && !max.blocked) || (push && push.devices > 0));

  async function enablePush(publicKey: string): Promise<void> {
    try {
      const subscription = await subscribe(publicKey);
      setView(await api.subscribePush(subscriptionBody(subscription)));
      setDeviceSubscribed(true);
      setNotice('Уведомления на этом устройстве включены. Проверьте — отправьте проверочное.');
    } finally {
      // Человек мог запретить уведомления в запросе — блок должен это показать.
      setSupport(pushSupport());
    }
  }

  async function disablePush(): Promise<void> {
    const subscription = await currentSubscription();

    if (subscription) {
      setView(await api.unsubscribePush(subscription.endpoint));
      await subscription.unsubscribe();
    }

    setDeviceSubscribed(false);
  }

  return (
    <div id="notifications" className="scroll-mt-24">
      <Card className="mt-6 max-w-2xl">
        <CardHeader
          title="Уведомления"
          description="Напоминания о записях и новости клуба — в мессенджере MAX и в браузере."
        />
        <CardBody>
          {error && <Alert>{error}</Alert>}
          {notice && <Alert tone="info">{notice}</Alert>}

          {!view && !error && <p className="text-[0.875rem] text-text-muted">Загружаю…</p>}

          {max && (
            <section aria-labelledby="notify-max">
              <h3 id="notify-max" className="mb-2 text-[0.9375rem] font-medium text-text">
                Мессенджер MAX
              </h3>

              {!max.available && (
                <p className="text-[0.875rem] text-text-muted">
                  Бот пока не подключён к сайту. Как только он заработает, здесь появится кнопка подключения.
                </p>
              )}

              {max.available && !max.linked && (
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

              {max.linked && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {max.blocked ? (
                    <Alert tone="warning">
                      Бот остановлен в MAX, и сообщения не доходят. Откройте чат с ботом «Енисея» и нажмите «Начать» —
                      подключать заново не нужно.
                    </Alert>
                  ) : (
                    <p className="text-[0.9375rem] text-text">
                      MAX подключён{max.linkedAt ? ` ${formatDate(max.linkedAt)}` : ''}.
                    </p>
                  )}
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    pending={pending === 'unlink'}
                    onClick={() => void run('unlink', async () => setView(await api.unlinkMax()))}
                  >
                    Отключить MAX
                  </Button>
                </div>
              )}
            </section>
          )}

          {push?.available && (
            <section aria-labelledby="notify-push" className="mt-6 border-t border-border pt-5">
              <h3 id="notify-push" className="mb-2 text-[0.9375rem] font-medium text-text">
                В браузере на этом устройстве
              </h3>

              {support === 'unsupported' && (
                <p className="text-[0.875rem] text-text-muted">
                  Этот браузер уведомления не показывает. На iPhone они работают, только если сайт добавлен на экран
                  «Домой»: «Поделиться» → «На экран „Домой“».
                </p>
              )}

              {support === 'denied' && (
                <p className="text-[0.875rem] text-text-muted">
                  Уведомления для этого сайта запрещены в настройках браузера. Разрешите их там — и включите здесь.
                </p>
              )}

              {support === 'supported' && deviceSubscribed === false && push.publicKey && (
                <div>
                  <p className="mb-4 text-[0.9375rem] text-text-muted">
                    Браузер покажет уведомление, даже когда сайт закрыт. Включается на каждом устройстве отдельно.
                  </p>
                  <Button
                    variant={max?.linked ? 'secondary' : 'primary'}
                    pending={pending === 'push-on'}
                    onClick={() => void run('push-on', () => enablePush(push.publicKey!))}
                  >
                    Включить на этом устройстве
                  </Button>
                </div>
              )}

              {support === 'supported' && deviceSubscribed === true && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p className="text-[0.9375rem] text-text">Уведомления на этом устройстве включены.</p>
                  <Button variant="danger-ghost" size="sm" pending={pending === 'push-off'} onClick={() => void run('push-off', disablePush)}>
                    Выключить здесь
                  </Button>
                </div>
              )}

              {push.devices > 0 && (
                <p className="mt-2 text-[0.8125rem] text-text-subtle">Устройств с уведомлениями: {push.devices}.</p>
              )}
            </section>
          )}

          {connected && (
            <section className="mt-6 border-t border-border pt-5">
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

              <Button
                variant="secondary"
                pending={pending === 'test'}
                onClick={() =>
                  void run('test', async () => {
                    await api.sendTestNotification();
                    setNotice('Проверочное сообщение отправлено во все подключённые каналы — оно придёт в течение минуты.');
                  })
                }
              >
                Отправить проверочное
              </Button>
            </section>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError || cause instanceof PushSetupError ? cause.message : 'Сервис недоступен';
}

/** «23 сентября». */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
