'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PlatformDocument } from '@yenisey/types';
import { clubPath } from '@/components/layout/ClubNav';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { formatKopecks } from '@/lib/money';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';

/**
 * Счёт или акт подписки на КНТ — страницей для печати (решения владельца от
 * 02.10.2026: счёт для юрлица, акты раз в месяц). Без шапки сайта и в
 * чёрно-белом: её печатают или сохраняют в PDF из браузера.
 */
export default function BillingDocumentPage() {
  const params = useParams<{ kind: string; id: string }>();
  const slug = useClubSlug();
  const club = useClubApi();
  const [doc, setDoc] = useState<PlatformDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = params.kind === 'ACT' ? 'ACT' : 'INVOICE';

  useEffect(() => {
    club
      .billingDocument(kind, params.id)
      .then(setDoc)
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
  }, [kind, params.id]);

  const title = kind === 'ACT' ? 'Акт оказанных услуг' : 'Счёт на оплату';

  return (
    <div className="min-h-dvh bg-white px-5 py-8 text-black sm:px-10 print:p-0">
      <div className="mx-auto grid max-w-3xl gap-6 text-[0.9375rem] leading-relaxed">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href={clubPath(slug, '/billing')} className="text-[0.875rem] underline underline-offset-2">
            ← К подписке
          </Link>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            Распечатать или сохранить в PDF
          </Button>
        </div>

        {error && <Alert>{error}</Alert>}

        {doc && (
          <>
            {!doc.seller && (
              <div className="rounded border border-black/30 px-4 py-3 text-[0.875rem] print:hidden">
                Реквизиты продавца не заданы на сервере (BILLING_SELLER_*): документ неполный, отправлять его нельзя.
              </div>
            )}

            {kind === 'INVOICE' && doc.seller && (
              <table className="w-full border-collapse border border-black text-[0.875rem]">
                <tbody>
                  <tr>
                    <td className="border border-black px-2 py-1" colSpan={2}>
                      {doc.seller.bank ?? 'Банк не указан'}
                      <br />
                      <span className="text-[0.75rem]">Банк получателя</span>
                    </td>
                    <td className="border border-black px-2 py-1">БИК</td>
                    <td className="border border-black px-2 py-1 tabular-nums">{doc.seller.bik ?? '—'}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1">ИНН {doc.seller.inn}</td>
                    <td className="border border-black px-2 py-1">КПП {doc.seller.kpp ?? '—'}</td>
                    <td className="border border-black px-2 py-1">Сч. №</td>
                    <td className="border border-black px-2 py-1 tabular-nums">{doc.seller.account ?? '—'}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1" colSpan={2}>
                      {doc.seller.name}
                      <br />
                      <span className="text-[0.75rem]">Получатель</span>
                    </td>
                    <td className="border border-black px-2 py-1">Корр. сч.</td>
                    <td className="border border-black px-2 py-1 tabular-nums">{doc.seller.corrAccount ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            )}

            <h1 className="text-[1.375rem] font-bold">
              {title} № {doc.number} от {date(doc.date)}
            </h1>

            <dl className="grid gap-2">
              <div>
                <dt className="inline font-semibold">{kind === 'ACT' ? 'Исполнитель' : 'Поставщик'}: </dt>
                <dd className="inline">
                  {doc.seller
                    ? `${doc.seller.name}, ИНН ${doc.seller.inn}${doc.seller.kpp ? `, КПП ${doc.seller.kpp}` : ''}, ${doc.seller.address}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold">{kind === 'ACT' ? 'Заказчик' : 'Покупатель'}: </dt>
                <dd className="inline">
                  {doc.buyer.legalName}, ИНН {doc.buyer.inn}
                  {doc.buyer.kpp ? `, КПП ${doc.buyer.kpp}` : ''}, {doc.buyer.address}
                </dd>
              </div>
            </dl>

            <table className="w-full border-collapse text-[0.875rem]">
              <thead>
                <tr>
                  <th className="border border-black px-2 py-1 text-left">№</th>
                  <th className="border border-black px-2 py-1 text-left">Наименование</th>
                  <th className="border border-black px-2 py-1 text-right">Кол-во</th>
                  <th className="border border-black px-2 py-1 text-right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-black px-2 py-1">1</td>
                  <td className="border border-black px-2 py-1">{doc.subject}</td>
                  <td className="border border-black px-2 py-1 text-right">1</td>
                  <td className="border border-black px-2 py-1 text-right tabular-nums">{formatKopecks(doc.amount)}</td>
                </tr>
              </tbody>
            </table>

            <p className="text-right">
              Итого: <strong className="tabular-nums">{formatKopecks(doc.amount)}</strong>
              <br />
              Без НДС
            </p>

            {kind === 'ACT' ? (
              <p>
                Услуги оказаны полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.
              </p>
            ) : (
              <p>Оплата этого счёта означает согласие с условиями доступа к платформе КНТ. Счёт действителен 5 банковских дней.</p>
            )}

            <div className="mt-6 grid gap-8 sm:grid-cols-2">
              <p>
                {kind === 'ACT' ? 'Исполнитель' : 'Руководитель'} ____________________
              </p>
              {kind === 'ACT' && <p>Заказчик ____________________</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** «2 октября 2026 г.». */
function date(iso: string): string {
  return `${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))}`;
}
