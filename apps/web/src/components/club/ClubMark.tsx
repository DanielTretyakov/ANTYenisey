import type { ClubRef } from '@yenisey/types';
import { cn } from '@/lib/cn';

/**
 * Опознавательный знак клуба: логотип, а если его нет — монограмма.
 *
 * Заглушка не серый прямоугольник и не стоковая фотография зала. Клуб без
 * логотипа — штатное состояние (его заполняют не сразу), и в списке из
 * двадцати клубов одинаковые серые квадраты не дают отличить один от другого.
 * Монограмма из первых букв названия в фирменном цвете различает их сразу.
 *
 * Стоковых снимков здесь нет намеренно: фотография чужого зала под названием
 * клуба — это ложь о клубе, а не оформление.
 */
export function ClubMark({
  club,
  size = 'md',
  className,
}: {
  club: Pick<ClubRef, 'name' | 'accentColor'> & { logoUrl?: string | null };
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = { sm: 'h-9 w-9', md: 'h-12 w-12', lg: 'h-16 w-16' }[size];
  const text = { sm: 'text-[0.8125rem]', md: 'text-[1rem]', lg: 'text-[1.375rem]' }[size];

  if (club.logoUrl) {
    return (
      <img
        src={club.logoUrl}
        alt=""
        // Пустой alt: рядом всегда стоит название клуба, и диктор, читающий
        // его дважды, только мешает.
        className={cn('shrink-0 rounded-control object-contain', box, className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control font-display',
        'border border-[color-mix(in_oklab,var(--mark)_35%,transparent)]',
        'bg-[color-mix(in_oklab,var(--mark)_12%,transparent)] text-[var(--mark)]',
        box,
        text,
        className,
      )}
      style={{ '--mark': club.accentColor ?? 'var(--accent)' } as React.CSSProperties}
    >
      {monogram(club.name)}
    </span>
  );
}

/**
 * Две буквы из СОБСТВЕННОГО названия клуба.
 *
 * Кавычки отбрасываются, а аббревиатура организационной формы пропускается:
 * у «АНТ «Енисей»» и «КНТ «Саяны»» первое слово одинаково бесполезно —
 * монограммы «АН» и «КН» ничего не различают, а «ЕН» и «СА» опознаются сразу.
 *
 * Аббревиатуру узнаём по тому, что слово целиком в верхнем регистре: клубы
 * пишут её именно так, а собственное имя — с одной заглавной.
 */
function monogram(name: string): string {
  const words = name
    .replace(/[«»"'()]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1);

  const isAbbreviation = (word: string): boolean => word === word.toUpperCase();

  const source =
    words.find((word) => !isAbbreviation(word)) ??
    words.find((word) => word.length > 2) ??
    words[0] ??
    name;

  return source.slice(0, 2).toUpperCase();
}
