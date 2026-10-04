import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * «Как это работает?» — ссылка на статью справки с трудного экрана (решение
 * владельца от 02.10.2026). Тихая, под заголовком: подсказка, а не действие.
 */
export function HelpHint({ slug, className }: { slug: string; className?: string }) {
  return (
    <Link
      href={`/help/${slug}`}
      className={cn('inline-block text-[0.8125rem] text-text-accent underline-offset-2 hover:underline', className)}
    >
      Как это работает?
    </Link>
  );
}
