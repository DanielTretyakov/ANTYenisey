'use client';

import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { ClubPerson, PlatformPersonLookup } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { inputClassName } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';

/**
 * Новичок «с порога».
 *
 * Учётку за человека администратор НЕ заводит, и это не упрощение, а решение
 * (ТЗ → «Оплата и политика отмены»): пароля чужой учётки клуб знать не должен,
 * а восстановления пароля в продукте пока нет — забытый администратором пароль
 * человек не вернул бы никогда.
 *
 * Поэтому у стойки стоит QR: человек регистрируется сам, с телефона, за
 * полминуты. Дальше администратор находит его по точной почте или телефону и
 * привязывает к клубу — и может внести визит.
 *
 * Тот же путь работает и для того, кто давно зарегистрирован в соседнем клубе
 * платформы: вторая учётка ему не нужна, привязывается существующая.
 */
export function NewClientDialog({
  onClose,
  onAttached,
}: {
  onClose: () => void;
  onAttached: (person: ClubPerson) => void;
}) {
  const club = useClubApi();
  const slug = useClubSlug();

  const [qr, setQr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<PlatformPersonLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Адрес берётся у самой страницы: на планшете за стойкой это может быть и
  // localhost, и адрес в сети клуба, и вписывать его в код нельзя.
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/register?club=${slug}`;

  useEffect(() => {
    if (!link) return;

    QRCode.toDataURL(link, { margin: 1, width: 320 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [link]);

  async function search(): Promise<void> {
    const value = query.trim();

    if (!value) return;

    setPending(true);
    setError(null);
    setFound(null);

    try {
      // Что искать, решает сама строка: собачка — почта, всё прочее — телефон.
      // Спрашивать это отдельным переключателем у стойки значит добавить
      // лишнее движение к каждому новичку.
      setFound(
        await club.lookupPerson(value.includes('@') ? { email: value } : { phone: value }),
      );
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  async function attach(id: string): Promise<void> {
    setPending(true);
    setError(null);

    try {
      onAttached(await club.attachPerson(id));
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Новый клиент"
      onClose={onClose}
      description={
        <>
          Учётку человек заводит сам — пароль знает только он. Дайте отсканировать код, потом
          найдите его по почте или телефону и привяжите к клубу.
        </>
      }
    >
      <div className="grid gap-5 px-6 py-5">
        {error && <Alert>{error}</Alert>}

        <div className="flex flex-wrap items-center gap-4">
          {qr ? (
            // Белая подложка обязательна: по тёмной теме чёрный код не
            // читается камерой.
            <img
              src={qr}
              alt="QR-код на регистрацию в клубе"
              className="h-40 w-40 rounded-control bg-white p-2"
            />
          ) : (
            <div className="h-40 w-40 animate-pulse rounded-control bg-surface-sunken" />
          )}

          <div className="min-w-[12rem] flex-1 text-[0.875rem]">
            <p className="text-text-muted">Или продиктуйте ссылку:</p>
            <p className="mt-1 break-all text-text">{link}</p>
            <p className="mt-2 text-[0.8125rem] text-text-subtle">
              Регистрация по этой ссылке сразу привязывает человека к клубу — искать его после
              неё не нужно.
            </p>
          </div>
        </div>

        <div className="border-t border-border pt-5">
          <label className="grid gap-1.5 text-[0.875rem]">
            <span className="font-medium text-text">Уже зарегистрирован?</span>
            <span className="flex flex-wrap gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void search();
                }}
                placeholder="почта целиком или +79991234567"
                className={cn(inputClassName, 'w-auto min-w-[16rem] flex-1')}
              />
              <Button variant="secondary" pending={pending} onClick={() => void search()}>
                Найти
              </Button>
            </span>
          </label>

          <p className="mt-2 text-[0.8125rem] text-text-subtle">
            Только целиком: по куску почты поиск ничего не найдёт — это чужие данные.
          </p>

          {found && !found.found && (
            <p className="mt-3 text-[0.875rem] text-text-muted">
              Такого человека на платформе нет. Пусть зарегистрируется по коду — после этого он
              уже будет в клубе.
            </p>
          )}

          {found?.ambiguous && (
            <p className="mt-3 text-[0.875rem] text-warning">
              С таким телефоном на платформе несколько человек — так бывает у семьи с одним
              номером. Спросите почту: она у каждого своя.
            </p>
          )}

          {found?.person && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-control border border-border bg-surface-sunken px-4 py-3 text-[0.875rem]">
              <span className="flex-1">
                Нашёлся: <b>{found.person.name}</b>
                {found.person.member && (
                  <span className="text-text-muted"> — уже в этом клубе</span>
                )}
              </span>

              {found.person.member ? (
                <Link
                  href={`/clubs/${slug}/people/${found.person.id}`}
                  className="text-text-accent underline-offset-2 hover:underline"
                >
                  Открыть карточку
                </Link>
              ) : (
                <Button
                  size="sm"
                  pending={pending}
                  onClick={() => void attach(found.person!.id)}
                >
                  Привязать к клубу
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Закрыть
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
