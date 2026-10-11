'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ClubApplicationView } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CityCombobox } from '@/components/ui/CityCombobox';
import { Dialog } from '@/components/ui/Dialog';
import { inputClassName } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { suggestSlug } from '@/lib/slug';

/**
 * «Завести клуб» (решения владельца от 11.10.2026) — из заявки или руками.
 *
 * Клуб появляется черновиком: в поиске его нет, видят его только руководитель
 * и владелец платформы. Руководитель — уже зарегистрированная учётка по почте:
 * учёток за людей мы не заводим, поэтому заявителя сначала просят
 * зарегистрироваться. Код клуба подсказывается по названию — он станет
 * адресом /clubs/код и потом не меняется.
 */
export function CreateClubDialog({
  application,
  onClose,
  onCreated,
}: {
  application: ClubApplicationView | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState(application?.clubName ?? '');
  const [slug, setSlug] = useState(application ? suggestSlug(application.clubName) : '');
  const [slugTouched, setSlugTouched] = useState(false);
  const [cityId, setCityId] = useState<string | null>(application?.cityId ?? null);
  const [email, setEmail] = useState(application?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const ready = name.trim().length >= 2 && slug.length >= 3 && cityId !== null && email.includes('@');

  async function submit(): Promise<void> {
    if (!cityId) return;

    setPending(true);
    setError(null);

    try {
      const result = await api.createClub({
        name: name.trim(),
        slug,
        cityId,
        ownerEmail: email.trim(),
        ...(application ? { applicationId: application.id } : {}),
      });
      setCreated(result.slug);
      onCreated();
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title={created ? 'Клуб заведён' : 'Завести клуб'}
      onClose={onClose}
      description={
        created
          ? undefined
          : 'Клуб появится черновиком: в поиске его нет, пока руководитель не настроит зал и не откроет клуб. Настройки черновика применяются сразу, пробные 7 дней подписки — с открытия.'
      }
    >
      <div className="grid gap-4 px-6 py-5">
        {created ? (
          <>
            <p className="text-[0.9375rem]">
              Черновик готов:{' '}
              <Link href={`/clubs/${created}`} className="text-text-accent underline-offset-2 hover:underline">
                /clubs/{created}
              </Link>
              . Руководитель видит его в меню аккаунта: «Рабочее место» → «Настройки» — зал с адресом и столами, — затем
              «Открыть клуб».
            </p>
            <div>
              <Button onClick={onClose}>Готово</Button>
            </div>
          </>
        ) : (
          <>
            {error && <Alert>{error}</Alert>}

            <label className="grid gap-1.5 text-[0.875rem]">
              <span className="font-medium text-text">Название клуба</span>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slugTouched) setSlug(suggestSlug(event.target.value));
                }}
                maxLength={120}
                placeholder="КНТ «Столбы»"
                className={inputClassName}
              />
            </label>

            <label className="grid gap-1.5 text-[0.875rem]">
              <span className="font-medium text-text">Код для адреса</span>
              <span className="flex items-center gap-1 text-text-subtle">
                /clubs/
                <input
                  value={slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                  }}
                  maxLength={40}
                  placeholder="stolby"
                  className={inputClassName}
                />
              </span>
              <span className="text-[0.8125rem] text-text-subtle">Строчная латиница и цифры через дефис. Потом не меняется.</span>
            </label>

            <CityCombobox label="Город клуба" value={cityId} onChange={(city) => setCityId(city?.id ?? null)} />

            <label className="grid gap-1.5 text-[0.875rem]">
              <span className="font-medium text-text">Почта руководителя</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                placeholder="director@club.ru"
                className={inputClassName}
              />
              <span className="text-[0.8125rem] text-text-subtle">
                Учётка с этой почтой уже должна быть — пусть руководитель сначала зарегистрируется на сайте.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button onClick={() => void submit()} pending={pending} disabled={!ready}>
                Завести черновик
              </Button>
              <Button variant="secondary" onClick={onClose} disabled={pending}>
                Отмена
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
