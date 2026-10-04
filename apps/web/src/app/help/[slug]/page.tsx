import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { findArticle, HELP_ARTICLES, HELP_AUDIENCES, helpHref } from '@/content/help';

/** Статьи известны при сборке — страницы собираются заранее. */
export function generateStaticParams(): { slug: string }[] {
  return HELP_ARTICLES.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = findArticle((await params).slug);

  return { title: article ? article.title : 'Помощь' };
}

/**
 * Статья справки: вопрос заголовком, ответ, «см. также». Адрес у каждой
 * свой — на него ссылаются «Как это работает?» с трудных экранов.
 */
export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = findArticle((await params).slug);

  if (!article) {
    notFound();
  }

  const audience = HELP_AUDIENCES.find((item) => item.id === article.audience);
  const related = (article.related ?? []).map(findArticle).filter((item) => item !== null);

  return (
    <AppShell>
      <article className="grid max-w-3xl gap-5">
        <nav className="text-[0.875rem] text-text-subtle" aria-label="Раздел справки">
          <Link href="/help" className="text-text-accent underline underline-offset-2">
            Помощь
          </Link>
          {audience && ` · ${audience.label}`}
        </nav>

        <h1 className="font-display text-[1.75rem] leading-tight [text-wrap:balance] sm:text-[2.25rem]">
          {article.title}
        </h1>

        <div className="grid gap-4">{article.body}</div>

        {related.length > 0 && (
          <section className="mt-4 border-t border-border pt-5">
            <h2 className="mb-3 text-[0.9375rem] font-medium text-text-muted">См. также</h2>
            <ul className="grid gap-2">
              {related.map((item) => (
                <li key={item.slug}>
                  <Link href={helpHref(item.slug)} className="text-text-accent underline underline-offset-2">
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </AppShell>
  );
}
