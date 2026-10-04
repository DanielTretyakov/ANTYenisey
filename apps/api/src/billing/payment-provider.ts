import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Платёжный шлюз подписки клуба на КНТ.
 *
 * Сейчас за ним ЮKassa (ТЗ: «автоплатежи ЮKassa по сохранённому способу
 * оплаты клуба»). Как и с MAX и DaData, вне production без ключей работает
 * поддельный шлюз с открытыми маршрутами `/api/dev/payments/*`, а в
 * production без ключей оплата картой выключена — по счёту работает.
 */

export interface ProviderPayment {
  id: string;
  /** `succeeded` — деньги пришли; `canceled` — банк отказал или человек ушёл со страницы оплаты. */
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  /** Куда отправить человека подтвердить оплату. Есть только у первой оплаты. */
  confirmationUrl: string | null;
  /** Сохранённый способ оплаты — по нему пойдут автосписания. */
  paymentMethodId: string | null;
  /** «Visa •• 4242». */
  paymentMethodTitle: string | null;
  cancellationReason: string | null;
}

export interface CreatePayment {
  /** Копейки. */
  amount: number;
  description: string;
  returnUrl: string;
  /** Ключ идемпотентности: повтор того же запроса не создаст второй платёж. */
  idempotenceKey: string;
  metadata: Record<string, string>;
}

export interface ChargeSaved {
  amount: number;
  description: string;
  paymentMethodId: string;
  idempotenceKey: string;
  metadata: Record<string, string>;
}

export abstract class PaymentProvider {
  /** Оплата картой вообще возможна — показывать ли кнопку. */
  abstract readonly available: boolean;
  /** Первая оплата: человек подтверждает её на странице шлюза, карта сохраняется. */
  abstract create(input: CreatePayment): Promise<ProviderPayment>;
  /** Автосписание по сохранённой карте — без человека. */
  abstract chargeSaved(input: ChargeSaved): Promise<ProviderPayment>;
  /** Состояние платежа у шлюза. Вебхуку не верим на слово — перечитываем отсюда. */
  abstract get(id: string): Promise<ProviderPayment>;
}

/** Копейки → «5000.00», как ждёт ЮKassa. */
function rubles(amount: number): string {
  return (amount / 100).toFixed(2);
}

/** ЮKassa, API v3: https://yookassa.ru/developers/api */
export class YooKassaPaymentProvider extends PaymentProvider {
  readonly available = true;

  constructor(
    private readonly shopId: string,
    private readonly secretKey: string,
  ) {
    super();
  }

  async create(input: CreatePayment): Promise<ProviderPayment> {
    return this.request('POST', '/payments', input.idempotenceKey, {
      amount: { value: rubles(input.amount), currency: 'RUB' },
      capture: true,
      save_payment_method: true,
      confirmation: { type: 'redirect', return_url: input.returnUrl },
      description: input.description.slice(0, 128),
      metadata: input.metadata,
    });
  }

  async chargeSaved(input: ChargeSaved): Promise<ProviderPayment> {
    return this.request('POST', '/payments', input.idempotenceKey, {
      amount: { value: rubles(input.amount), currency: 'RUB' },
      capture: true,
      payment_method_id: input.paymentMethodId,
      description: input.description.slice(0, 128),
      metadata: input.metadata,
    });
  }

  async get(id: string): Promise<ProviderPayment> {
    return this.request('GET', `/payments/${encodeURIComponent(id)}`, null, null);
  }

  private async request(method: 'GET' | 'POST', path: string, idempotenceKey: string | null, body: unknown): Promise<ProviderPayment> {
    const response = await fetch(`https://api.yookassa.ru/v3${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...(idempotenceKey ? { 'Idempotence-Key': idempotenceKey } : {}),
      },
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (!response || !response.ok) {
      throw new ServiceUnavailableException('Платёжный сервис не ответил. Попробуйте ещё раз через минуту');
    }

    return toPayment((await response.json()) as YooKassaPayment);
  }
}

interface YooKassaPayment {
  id: string;
  status: ProviderPayment['status'];
  confirmation?: { confirmation_url?: string };
  payment_method?: { id?: string; saved?: boolean; title?: string; card?: { last4?: string; card_type?: string } };
  cancellation_details?: { reason?: string };
}

function toPayment(raw: YooKassaPayment): ProviderPayment {
  const card = raw.payment_method?.card;

  return {
    id: raw.id,
    status: raw.status,
    confirmationUrl: raw.confirmation?.confirmation_url ?? null,
    paymentMethodId: raw.payment_method?.saved ? (raw.payment_method.id ?? null) : null,
    paymentMethodTitle: card?.last4 ? `${card.card_type ?? 'Карта'} •• ${card.last4}` : (raw.payment_method?.title ?? null),
    cancellationReason: raw.cancellation_details?.reason ?? null,
  };
}

/**
 * Поддельный шлюз для разработки и смоука. Первая оплата ждёт решения
 * (`/api/dev/payments/:id/succeed|fail`), автосписание проходит сразу — или
 * отказывает, если так попросили (`/api/dev/payments/next-charge`).
 */
export class FakePaymentProvider extends PaymentProvider {
  readonly available = true;
  private readonly payments = new Map<string, ProviderPayment>();
  /** Чем кончится следующее автосписание. */
  nextCharge: 'succeeded' | 'canceled' = 'succeeded';

  async create(input: CreatePayment): Promise<ProviderPayment> {
    const id = `fake-${randomUUID()}`;
    const url = new URL(input.returnUrl);
    url.searchParams.set('testPayment', id);
    const payment: ProviderPayment = {
      id,
      status: 'pending',
      confirmationUrl: url.toString(),
      paymentMethodId: null,
      paymentMethodTitle: null,
      cancellationReason: null,
    };
    this.payments.set(id, payment);

    return payment;
  }

  async chargeSaved(input: ChargeSaved): Promise<ProviderPayment> {
    const succeeded = this.nextCharge === 'succeeded';
    this.nextCharge = 'succeeded';
    const payment: ProviderPayment = {
      id: `fake-${randomUUID()}`,
      status: succeeded ? 'succeeded' : 'canceled',
      confirmationUrl: null,
      paymentMethodId: input.paymentMethodId,
      paymentMethodTitle: 'Тестовая карта •• 4242',
      cancellationReason: succeeded ? null : 'insufficient_funds',
    };
    this.payments.set(payment.id, payment);

    return payment;
  }

  async get(id: string): Promise<ProviderPayment> {
    const payment = this.payments.get(id);

    if (!payment) {
      throw new ServiceUnavailableException('Тестовый платёж не найден: сервер перезапускался?');
    }

    return payment;
  }

  /** Решение «человека на странице оплаты» — для `/api/dev/payments`. */
  decide(id: string, succeeded: boolean): ProviderPayment | null {
    const payment = this.payments.get(id);

    if (!payment) return null;

    payment.status = succeeded ? 'succeeded' : 'canceled';
    payment.paymentMethodId = succeeded ? `fake-card-${id}` : null;
    payment.paymentMethodTitle = succeeded ? 'Тестовая карта •• 4242' : null;
    payment.cancellationReason = succeeded ? null : 'canceled_by_user';

    return payment;
  }
}

/** Production без ключей: оплаты картой нет, по счёту работает. */
export class DisabledPaymentProvider extends PaymentProvider {
  readonly available = false;

  private refuse(): never {
    throw new ServiceUnavailableException('Оплата картой пока не подключена — выставьте счёт для юрлица');
  }

  create(): Promise<ProviderPayment> {
    this.refuse();
  }

  chargeSaved(): Promise<ProviderPayment> {
    this.refuse();
  }

  get(): Promise<ProviderPayment> {
    this.refuse();
  }
}
