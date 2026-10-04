import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { findLegal, LEGAL_DOCUMENTS, LEGAL_PAGES_SINCE, legalHref } from '@/content/legal';
import { cn } from '@/lib/cn';
import { OPERATOR, PENDING } from '@/lib/operator';

/** Документы известны при сборке — страницы собираются заранее. */
export function generateStaticParams(): { doc: string }[] {
  return LEGAL_DOCUMENTS.map((document) => ({ doc: document.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const document = findLegal((await params).doc);

  return { title: document ? document.title : 'Документы' };
}

/**
 * Документ платформы — пока «в разработке» (решение владельца от
 * 03.10.2026): что это за документ, о чём он будет и кто оператор. Адрес
 * постоянный — на него уже ссылаются подвал и галочка согласия.
 */
export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const document = findLegal((await params).doc);

  if (!document) {
    notFound();
  }

  const operator: [string, string | null][] = [
    ['Оператор', OPERATOR.name],
    ['ИНН', OPERATOR.inn],
    ['Адрес', OPERATOR.address],
    ['Почта для вопросов о данных', OPERATOR.email],
  ];

  return (
    <AppShell>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <article className="grid max-w-3xl content-start gap-6">
          <nav className="text-[0.875rem] text-text-subtle" aria-label="Раздел">
            <Link href="/legal" className="text-text-accent underline underline-offset-2">
              Документы
            </Link>
          </nav>

          <div className="grid gap-3">
            <span className="inline-flex items-center gap-1.5 justify-self-start rounded-full border border-warning-border bg-warning-soft px-3 py-1 text-[0.8125rem] font-medium text-warning">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
              Документ в разработке
            </span>
            <h1 className="font-display text-[1.75rem] leading-tight [text-wrap:balance] sm:text-[2.25rem]">
              {document.title}
            </h1>
            <p className="text-[1rem] text-text-muted">{document.lead}</p>
          </div>

          <p className="rounded-card border border-border bg-surface-raised px-5 py-4 text-[0.9375rem] text-text-muted">
            Окончательный текст готовится. Как только он будет утверждён, он появится на этой странице — по этому же
            адресу, с датой вступления в силу.
          </p>

          <section className="grid gap-3">
            <h2 className="text-[1.125rem]">Что будет в документе</h2>
            <ul className="grid gap-2 text-[0.9375rem]">
              {document.outline.map((item) => (
                <li key={item} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-text-subtle" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-3">
            <h2 className="text-[1.125rem]">Оператор</h2>
            <dl className="grid gap-2 text-[0.9375rem] sm:grid-cols-[14rem_minmax(0,1fr)]">
              {operator.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-text-muted">{label}</dt>
                  <dd className={cn(!value && 'text-text-subtle')}>{value ?? PENDING}</dd>
                </div>
              ))}
            </dl>
          </section>

          <p className="text-[0.8125rem] text-text-subtle">Страница опубликована {LEGAL_PAGES_SINCE}</p>
        </article>

        <DocumentsNav current={document.slug} />
      </div>
    </AppShell>
  );
}

/** Все три документа — рядом: со страницы согласия обычно идут в политику. */
function DocumentsNav({ current }: { current: string }) {
  return (
    <nav aria-label="Документы платформы" className="grid content-start gap-1 lg:sticky lg:top-24">
      <p className="px-3 pb-1 text-[0.6875rem] tracking-[0.1em] text-text-subtle uppercase">Документы</p>
      {LEGAL_DOCUMENTS.map((item) => (
        <Link
          key={item.slug}
          href={legalHref(item.slug)}
          aria-current={item.slug === current ? 'page' : undefined}
          className={cn(
            'rounded-control px-3 py-2 text-[0.875rem]',
            item.slug === current
              ? 'bg-surface-accent-soft font-medium text-text-accent'
              : 'text-text-muted hover:bg-surface-sunken hover:text-text',
          )}
        >
          {item.title}
        </Link>
      ))}
    </nav>
  );
}
