'use client';

import { useState } from 'react';
import type { PublicUser } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { useMailEnabled } from '@/lib/mailStatus';

/**
 * «Подтвердите почту» (решение владельца от 12.10.2026, мягкое
 * подтверждение): учётка работает и так, но счета клуба, новости и
 * восстановление пароля по делу приходят только на подтверждённую почту.
 * Пока почта сервиса не подключена — плашки нет.
 */
export function EmailVerifyNotice({ user, className }: { user: PublicUser; className?: string }) {
  const enabled = useMailEnabled();
  const [state, setState] = useState<'idle' | 'pending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!enabled || user.emailVerified) {
    return null;
  }

  async function resend(): Promise<void> {
    setState('pending');
    setError(null);

    try {
      await api.resendVerification();
      setState('sent');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
      setState('idle');
    }
  }

  return (
    <div className={className}>
      <Alert tone="info">
        <span className="block">
          Подтвердите почту <b>{user.email}</b> — ссылка пришла письмом после регистрации. На подтверждённую почту
          приходят счета клуба и новости.
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-3">
          {state === 'sent' ? (
            <span>Письмо отправлено — проверьте почту и папку «Спам».</span>
          ) : (
            <Button size="sm" variant="secondary" pending={state === 'pending'} onClick={() => void resend()}>
              Отправить письмо ещё раз
            </Button>
          )}
          {error && <span className="text-danger">{error}</span>}
        </span>
      </Alert>
    </div>
  );
}
