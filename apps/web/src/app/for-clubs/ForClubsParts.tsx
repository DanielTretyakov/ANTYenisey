'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { City, PlatformPlanView } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CityCombobox } from '@/components/ui/CityCombobox';
import { ConsentCheckbox } from '@/components/ui/ConsentCheckbox';
import { Field, inputClassName } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';

/** Тарифы КНТ — открытым `GET /platform/plans`, те же, что на странице подписки клуба. */
export function PlanCards() {
  const [plans, setPlans] = useState<PlatformPlanView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .platformPlans()
      .then(setPlans)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return <p className="mt-6 text-[0.9375rem] text-text-muted">Тарифы не загрузились — обновите страницу.</p>;
  }

  if (!plans) {
    return <div className="mt-6 h-40 animate-pulse rounded-card border border-border bg-surface-raised" aria-busy="true" />;
  }

  const best = plans.reduce<PlatformPlanView | null>(
    (top, plan) => (plan.savingPercent > (top?.savingPercent ?? 0) ? plan : top),
    null,
  );

  return (
    <ul className="mt-6 grid gap-4 md:grid-cols-3">
      {plans.map((plan) => (
        <li
          key={plan.id}
          className={cn(
            'relative flex flex-col rounded-card border bg-surface-raised px-5 py-5',
            plan.id === best?.id ? 'border-accent shadow-sm' : 'border-border',
          )}
        >
          {plan.id === best?.id && (
            <span className="absolute -top-3 left-5 rounded-full bg-accent px-2.5 py-0.5 text-[0.75rem] font-semibold text-accent-text">
              выгоднее всего
            </span>
          )}
          <h3 className="text-[1rem] font-semibold">{plan.name}</h3>
          <p className="mt-3 font-display text-[1.75rem] leading-none">{formatKopecks(plan.price)}</p>
          <p className="mt-2 text-[0.875rem] text-text-muted">
            {plan.periodMonths > 1 ? `${formatKopecks(plan.perMonth)} в месяц` : 'помесячно'}
            {plan.savingPercent > 0 && <span className="text-text-accent"> · выгода {plan.savingPercent} %</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Целое из поля «залов / столов»: пусто — не указано. */
function count(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();

  return text === '' ? null : Number(text);
}

/**
 * Заявка на подключение — открытая форма. Телефон или почта — хотя бы одно;
 * спрятанное поле `website` — ловушка для ботов: человек его не видит и не
 * заполняет (`isBotSubmission` на сервере).
 */
export function ApplicationForm() {
  const [city, setCity] = useState<City | null>(null);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const phone = String(form.get('phone') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();

    if (!phone && !email) {
      setError('Оставьте телефон или почту — иначе нам не с кем связаться');
      return;
    }

    setPending(true);
    setError(null);

    try {
      await api.submitClubApplication({
        contactName: String(form.get('contactName')),
        clubName: String(form.get('clubName')),
        cityId: city?.id ?? null,
        phone: phone || null,
        email: email || null,
        halls: count(form.get('halls')),
        tables: count(form.get('tables')),
        comment: String(form.get('comment') ?? '').trim() || null,
        consent: true,
        website: String(form.get('website') ?? ''),
      });
      setSent(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-card border border-border-accent bg-surface-accent-soft px-6 py-6" role="status">
        <h3 className="font-display text-[1.25rem]">Заявка отправлена</h3>
        <p className="mt-2 text-[0.9375rem] text-text-muted">
          Спасибо! Мы свяжемся с вами по телефону или почте, которые вы оставили, и договоримся о показе.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => {
            setSent(false);
            setConsent(false);
            setCity(null);
          }}
        >
          Отправить ещё одну
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="rounded-card border border-border bg-surface-raised px-5 pt-5 pb-4 sm:px-6">
      <h3 className="mb-1 text-[1rem] font-semibold">Заявка на подключение</h3>
      <p className="mb-4 text-[0.875rem] text-text-muted">Расскажите о клубе — остальное обсудим, когда свяжемся.</p>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Как к вам обращаться" name="contactName" autoComplete="name" required minLength={2} maxLength={100} />
        <Field label="Название клуба" name="clubName" autoComplete="organization" required minLength={2} maxLength={120} />
      </div>

      <div className="mb-4">
        <CityCombobox label="Город" value={city?.id ?? null} onChange={setCity} placeholder="Начните вводить город" />
      </div>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Телефон" name="phone" type="tel" autoComplete="tel" placeholder="+7 999 123-45-67" />
        <Field label="Почта" name="email" type="email" autoComplete="email" hint="Телефон или почта — хотя бы одно." />
      </div>

      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Залов" name="halls" type="number" min={1} max={100} inputMode="numeric" />
        <Field label="Столов всего" name="tables" type="number" min={1} max={1000} inputMode="numeric" />
      </div>

      <div className="mb-4">
        <label htmlFor="application-comment" className="mb-1.5 block text-[0.8125rem] font-medium text-text-muted">
          Комментарий
        </label>
        <textarea
          id="application-comment"
          name="comment"
          rows={3}
          maxLength={2000}
          placeholder="Что важно для вас: группы, турниры, абонементы, несколько залов…"
          className={cn(inputClassName, 'resize-y')}
        />
      </div>

      {/* Ловушка для ботов: вне экрана, без фокуса и без подсказок браузера. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Сайт
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <ConsentCheckbox checked={consent} onChange={setConsent} by="application" />

      <Button type="submit" pending={pending} disabled={!consent} size="lg">
        {pending ? 'Отправляю…' : 'Отправить заявку'}
      </Button>
    </form>
  );
}
