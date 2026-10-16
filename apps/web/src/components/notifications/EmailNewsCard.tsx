'use client';

import { useState } from 'react';
import { EmailVerifyNotice } from '@/components/auth/EmailVerifyNotice';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { api, ApiError } from '@/lib/api';
import { useMailEnabled } from '@/lib/mailStatus';
import { useSession } from '@/lib/useSession';

/**
 * Почта в уведомлениях кабинета (решения владельца от 12.10.2026): согласие
 * на новости КНТ — переключателем (38-ФЗ), отписка — и здесь, и в каждом
 * письме. Письма о самой учётке и о деньгах клуба выключить нельзя. Пока почта
 * сервиса не подключена — блока нет.
 */
export function EmailNewsCard() {
  const enabled = useMailEnabled();
  const session = useSession();
  const [news, setNews] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled || session.status !== 'ready') {
    return null;
  }

  const user = session.user;
  const checked = news ?? user.newsEmail;

  async function toggle(next: boolean): Promise<void> {
    setPending(true);
    setError(null);

    try {
      await api.setEmailNews(next);
      setNews(next);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader
        title="Почта"
        description={`Письма приходят на ${user.email}. Письма о вашем аккаунте и об оплатах в клубе приходят всегда, их выключить нельзя.`}
      />
      <CardBody>
        <EmailVerifyNotice user={user} className="mb-4" />
        {error && <Alert>{error}</Alert>}
        <Toggle
          label="Новости КНТ на почту"
          hint={
            user.emailVerified
              ? 'Новые возможности и клубы — не чаще пары писем в месяц.'
              : 'Придут, когда почта будет подтверждена.'
          }
          checked={checked}
          disabled={pending}
          onChange={(event) => void toggle(event.target.checked)}
        />
      </CardBody>
    </Card>
  );
}
