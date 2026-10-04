'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { hasAnyRole, type BillingView, type ClubRequisitesView, type PlatformPaymentView } from '@yenisey/types';
import { AdminShell } from '@/components/layout/AdminShell';
import { clubPath } from '@/components/layout/ClubNav';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Toggle } from '@/components/ui/Toggle';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { rolesInClub } from '@/lib/membership';
import { formatKopecks } from '@/lib/money';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Сервис недоступен';
}

/** «2 октября 2026». */
function day(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}

/**
 * «Подписка на КНТ» — руководителю клуба (ТЗ → «Монетизация платформы»,
 * решения владельца от 02.10.2026): статус, тариф, оплата картой с
 * автопродлением или по счёту для юрлица, платежи, счета и акты.
 *
 * Открыта и при приостановленном доступе — иначе заплатить нечем.
 */
export default function BillingPage() {
  const session = useSession();
  const router = useRouter();
  const slug = useClubSlug();
  const club = useClubApi();
  const roles = session.status === 'ready' ? rolesInClub(session.user, slug) : [];
  const allowed = hasAnyRole(roles, ['OWNER']);
  const [view, setView] = useState<BillingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testPayment, setTestPayment] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(clubPath(slug, '/billing'))}`);
  }, [session.status, router, slug]);

  useEffect(() => {
    if (!allowed) return;

    // Вернулись со страницы оплаты (`?payment=`) — спросить шлюз; поддельный
    // шлюз разработки вместо своей страницы шлёт сюда же с `?testPayment=`.
    const params = new URLSearchParams(window.location.search);
    const returned = params.get('payment');
    setTestPayment(params.get('testPayment'));

    (returned ? club.syncCardPayment(returned) : club.billing())
      .then(setView)
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, [allowed]);

  async function decideTest(succeed: boolean): Promise<void> {
    if (!testPayment) return;

    try {
      await api.devDecidePayment(testPayment, succeed);
      setTestPayment(null);
      window.history.replaceState(null, '', clubPath(slug, '/billing'));
      setView(await club.billing());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  return (
    <AdminShell>
      <h1 className="mb-2 text-[1.75rem]">Подписка на КНТ</h1>
      <p className="mb-7 max-w-2xl text-[0.9375rem] text-text-muted">
        Доступ клуба к платформе. Оплатить можно картой — дальше продление само — или счётом для юрлица. Видит
        страницу только руководитель клуба.
      </p>

      {session.status === 'ready' && !allowed && <Alert>Раздел доступен только руководителю клуба.</Alert>}
      {error && <Alert>{error}</Alert>}

      {testPayment && (
        <Card className="mb-6 max-w-2xl border-warning-border">
          <CardHeader
            title="Тестовая оплата"
            description="Платёжный сервис не подключён: это страница-заглушка для разработки. Настоящая оплата пройдёт на странице ЮKassa."
          />
          <CardBody className="flex flex-wrap gap-2">
            <Button onClick={() => void decideTest(true)}>Оплатить</Button>
            <Button variant="ghost" onClick={() => void decideTest(false)}>
              Отказаться от оплаты
            </Button>
          </CardBody>
        </Card>
      )}

      {allowed && !error && !view && <div className="h-64 max-w-3xl rounded-card border border-border bg-surface-raised" aria-busy="true" />}

      {view && (
        <div className="grid max-w-3xl gap-6">
          <StatusCard view={view} />
          {view.status !== 'EXEMPT' && <PayCard view={view} onView={setView} />}
          {view.status !== 'EXEMPT' && <RequisitesCard view={view} onView={setView} />}
          <PaymentsCard payments={view.payments} slug={slug} />
        </div>
      )}
    </AdminShell>
  );
}

function StatusCard({ view }: { view: BillingView }) {
  const tone = {
    TRIAL: 'border-border bg-surface-raised',
    ACTIVE: 'border-border-accent bg-surface-accent-soft',
    PAST_DUE: 'border-warning-border bg-warning-soft',
    SUSPENDED: 'border-danger-border bg-danger-soft',
    EXEMPT: 'border-border bg-surface-raised',
  }[view.status];

  const chip = {
    TRIAL: 'пробный период',
    ACTIVE: 'активна',
    PAST_DUE: 'не оплачена',
    SUSPENDED: 'приостановлена',
    EXEMPT: 'без оплаты',
  }[view.status];

  const headline = {
    TRIAL: view.trialEndsAt ? `Пробный период до ${day(view.trialEndsAt)}` : 'Пробный период',
    ACTIVE: view.paidUntil ? `Оплачено до ${day(view.paidUntil)}` : 'Подписка активна',
    PAST_DUE: view.graceUntil ? `Не оплачено — доступ закроется ${day(view.graceUntil)}` : 'Подписка не оплачена',
    SUSPENDED: 'Доступ клуба приостановлен',
    EXEMPT: 'Пилотный клуб — подписка без оплаты',
  }[view.status];

  const text = {
    TRIAL: 'Выберите тариф и оплатите до конца пробного периода — тогда клуб продолжит работать без перерыва. Неоплаченные дни пробного периода не пропадают: срок считается с его конца.',
    ACTIVE: view.nextCharge
      ? `Следующее списание — ${formatKopecks(view.nextCharge.amount)} ${day(view.nextCharge.at)} с карты ${view.paymentMethodTitle ?? ''}.`
      : 'Автопродления нет: оплатите следующий срок картой или счётом до его конца.',
    PAST_DUE:
      'Клуб работает как обычно ещё три дня. Если оплаты не будет, доступ закроется, а все будущие записи клуба отменятся с полным возвратом клиентам.',
    SUSPENDED:
      'Клиенты не могут записываться и бронировать, смена и расписание закрыты; все будущие записи отменены с полным возвратом. Оплата вернёт доступ сразу.',
    EXEMPT: 'Так решил владелец платформы. Если статус изменится, здесь появятся тарифы и способы оплаты.',
  }[view.status];

  return (
    <section className={cn('grid gap-3 rounded-card border px-6 py-5', tone)}>
      <span className="text-[0.75rem] font-semibold tracking-[0.1em] text-text-subtle uppercase">{chip}</span>
      <h2 className="font-display text-[1.375rem] leading-tight sm:text-[1.625rem]">{headline}</h2>
      <p className="text-[0.9375rem] text-text">{text}</p>
      {view.planName && view.status !== 'EXEMPT' && (
        <p className="text-[0.875rem] text-text-muted">
          Тариф «{view.planName}»{view.paymentMethodTitle ? ` · карта ${view.paymentMethodTitle}` : ''}
        </p>
      )}
    </section>
  );
}

function PayCard({ view, onView }: { view: BillingView; onView: (view: BillingView) => void }) {
  const club = useClubApi();
  const [planId, setPlanId] = useState<string | null>(view.plans.find((plan) => plan.periodMonths === 12)?.id ?? view.plans[0]?.id ?? null);
  const [method, setMethod] = useState<'CARD' | 'INVOICE'>(view.cardAvailable ? 'CARD' : 'INVOICE');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = view.plans.find((item) => item.id === planId) ?? null;
  const pendingInvoice = view.payments.find((payment) => payment.method === 'INVOICE' && payment.status === 'PENDING');

  async function pay(): Promise<void> {
    if (!plan) return;
    setPending(true);
    setError(null);

    try {
      if (method === 'CARD') {
        const start = await club.payByCard(plan.id);
        window.location.assign(start.confirmationUrl);
        return;
      }

      onView(await club.issueInvoice(plan.id));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  async function toggleRenew(autoRenew: boolean): Promise<void> {
    try {
      onView(await club.setAutoRenew(autoRenew));
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  return (
    <Card>
      <CardHeader title="Тариф и оплата" description="Цена фиксируется при покупке: изменение прайса платформы её не меняет." />
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Тариф">
          {view.plans.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={item.id === planId}
              onClick={() => setPlanId(item.id)}
              className={cn(
                'grid gap-1 rounded-card border bg-surface-raised px-4 py-4 text-left transition-colors',
                item.id === planId ? 'border-2 border-accent px-[calc(1rem-1px)] py-[calc(1rem-1px)]' : 'border-border hover:border-border-strong',
              )}
            >
              <span className="text-[0.75rem] font-semibold tracking-[0.1em] text-text-subtle uppercase">{item.name}</span>
              <span className="font-display text-[1.375rem] tabular-nums">{formatKopecks(item.price)}</span>
              <span className="text-[0.8125rem] text-text-muted tabular-nums">
                {formatKopecks(item.perMonth)} в месяц{item.savingPercent > 0 ? ` · выгода ${item.savingPercent} %` : ''}
              </span>
            </button>
          ))}
        </div>

        <div className="inline-flex flex-wrap gap-1 self-start rounded-control border border-border p-1" role="radiogroup" aria-label="Способ оплаты">
          {(['CARD', 'INVOICE'] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={method === item}
              disabled={item === 'CARD' && !view.cardAvailable}
              onClick={() => setMethod(item)}
              className={cn(
                'rounded-[0.5rem] px-3.5 py-2 text-[0.875rem] disabled:opacity-50',
                method === item ? 'bg-text text-surface' : 'text-text-muted hover:text-text',
              )}
            >
              {item === 'CARD' ? 'Картой' : 'По счёту для юрлица'}
            </button>
          ))}
        </div>

        {method === 'CARD' ? (
          <div className="grid gap-3">
            <p className="text-[0.875rem] text-text-muted">
              Оплата — на странице ЮKassa; карта сохранится там же, и следующий срок спишется с неё сам в день окончания.
              За 7 и за 1 день придёт напоминание. Чек — на почту клуба.
            </p>
            <Toggle
              label="Продлевать автоматически"
              hint="Выключите — и следующий срок вы оплатите сами, когда решите."
              checked={view.autoRenew}
              onChange={(event) => void toggleRenew(event.target.checked)}
            />
          </div>
        ) : (
          <p className="text-[0.875rem] text-text-muted">
            Счёт выставляется на реквизиты клуба ниже. Доступ продлится, когда оплата поступит и владелец платформы её
            отметит; акты — раз в месяц.
            {pendingInvoice && ` Выставлен счёт № ${pendingInvoice.invoiceNumber} на ${formatKopecks(pendingInvoice.amount)} — новый его заменит.`}
          </p>
        )}

        {!view.cardAvailable && method === 'INVOICE' && (
          <p className="text-[0.8125rem] text-text-subtle">Оплата картой пока не подключена.</p>
        )}

        {error && <Alert>{error}</Alert>}

        <div>
          <Button pending={pending} disabled={!plan} onClick={() => void pay()}>
            {plan ? (method === 'CARD' ? `Оплатить ${formatKopecks(plan.price)}` : `Выставить счёт на ${formatKopecks(plan.price)}`) : 'Выберите тариф'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function RequisitesCard({ view, onView }: { view: BillingView; onView: (view: BillingView) => void }) {
  const club = useClubApi();
  const initial: ClubRequisitesView = view.requisites ?? { legalName: '', inn: '', kpp: null, address: '', email: '' };
  const [form, setForm] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (key: keyof ClubRequisitesView, value: string) => {
    setSaved(false);
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      onView(await club.setRequisites({ ...form, kpp: form.kpp?.trim() || null }));
      setSaved(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Реквизиты клуба" description="Для счетов и актов. Карте они не нужны." />
      <CardBody>
        <form onSubmit={(event) => void save(event)} className="grid gap-x-5 sm:grid-cols-2">
          <Field label="ИНН" value={form.inn} onChange={(event) => set('inn', event.target.value)} inputMode="numeric" required />
          <Field label="КПП" hint="У ИП нет — оставьте пустым." value={form.kpp ?? ''} onChange={(event) => set('kpp', event.target.value)} inputMode="numeric" />
          <div className="sm:col-span-2">
            <Field label="Организация" value={form.legalName} onChange={(event) => set('legalName', event.target.value)} placeholder="ООО «Клуб»" required />
          </div>
          <div className="sm:col-span-2">
            <Field label="Юридический адрес" value={form.address} onChange={(event) => set('address', event.target.value)} required />
          </div>
          <Field label="Почта для счетов и актов" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} required />
          <div className="sm:col-span-2">
            {error && <Alert>{error}</Alert>}
            {saved && <Alert tone="info">Реквизиты сохранены.</Alert>}
            <Button type="submit" variant="secondary" pending={pending}>
              Сохранить реквизиты
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

const PAYMENT_STATUS: Record<PlatformPaymentView['status'], string> = {
  PENDING: 'ждёт оплаты',
  SUCCEEDED: 'оплачен',
  FAILED: 'не прошёл',
  CANCELLED: 'отменён',
};

function PaymentsCard({ payments, slug }: { payments: PlatformPaymentView[]; slug: string }) {
  return (
    <Card>
      <CardHeader title="Платежи и документы" description="Чек по карте приходит на почту клуба; счёт и акты можно открыть и распечатать." />
      <CardBody>
        {payments.length === 0 && <p className="text-[0.875rem] text-text-muted">Платежей пока нет.</p>}
        {payments.length > 0 && (
          <ul className="grid gap-3">
            {payments.map((payment) => (
              <li key={payment.id} className="grid gap-1 border-b border-border pb-3 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-[0.9375rem] text-text">
                    {payment.method === 'INVOICE' ? `Счёт № ${payment.invoiceNumber}` : payment.autoCharge ? 'Автосписание' : 'Картой'} · тариф «
                    {payment.planName}»
                  </span>
                  <span className="text-[0.9375rem] tabular-nums">{formatKopecks(payment.amount)}</span>
                </div>
                <span className="text-[0.8125rem] text-text-muted">
                  {day(payment.createdAt)} · {PAYMENT_STATUS[payment.status]}
                  {payment.periodFrom && payment.periodTo && ` · доступ ${day(payment.periodFrom)} — ${day(payment.periodTo)}`}
                  {payment.failureReason && ` · ${payment.failureReason}`}
                </span>
                {(payment.method === 'INVOICE' || payment.acts.length > 0) && (
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-[0.8125rem]">
                    {payment.method === 'INVOICE' && (
                      <Link href={clubPath(slug, `/billing/documents/INVOICE/${payment.id}`)} className="text-text-accent underline underline-offset-2">
                        Счёт
                      </Link>
                    )}
                    {payment.acts.map((act) => (
                      <Link key={act.id} href={clubPath(slug, `/billing/documents/ACT/${act.id}`)} className="text-text-accent underline underline-offset-2">
                        Акт № {act.number}
                      </Link>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
