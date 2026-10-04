import type { Metadata } from 'next';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { LEGAL_DOCUMENTS, legalHref } from '@/content/legal';

export const metadata: Metadata = { title: 'Документы' };

/** Документы платформы списком — «Документы» в подвале ведут сюда. */
export default function LegalIndexPage() {
  return (
    <AppShell>
      <div className="grid max-w-3xl gap-6">
        <div className="grid gap-2">
          <h1 className="font-display text-[1.75rem] leading-tight sm:text-[2.25rem]">Документы</h1>
          <p className="text-[1rem] text-text-muted">
            Как КНТ обращается с персональными данными и на каких условиях работает платформа. Тексты документов
            готовятся — пока на их страницах сказано, о чём они будут.
          </p>
        </div>

        <ul className="grid gap-3">
          {LEGAL_DOCUMENTS.map((document) => (
            <li key={document.slug}>
              <Link
                href={legalHref(document.slug)}
                className="group grid gap-1 rounded-card border border-border bg-surface-raised px-5 py-4 transition-colors hover:border-border-strong"
              >
                <span className="text-[1rem] font-medium text-text group-hover:underline">{document.title}</span>
                <span className="text-[0.875rem] text-text-muted">{document.lead}</span>
                <span className="text-[0.8125rem] text-warning">Документ в разработке</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
