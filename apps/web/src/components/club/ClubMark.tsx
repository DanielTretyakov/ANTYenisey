'use client';

import type { ClubRef } from '@yenisey/types';
import { cn } from '@/lib/cn';
import { useSharedFileUrl } from '@/lib/useFileUrl';

/**
 * Опознавательный знак клуба: логотип, а если его нет — монограмма.
 *
 * Заглушка не серый прямоугольник и не стоковая фотография зала. Клуб без
 * логотипа — штатное состояние (его заполняют не сразу), и в списке из
 * двадцати клубов одинаковые серые квадраты не дают отличить один от другого.
 * Монограмма из первых букв названия в фирменном цвете различает их сразу.
 *
 * Стоковых снимков здесь нет намеренно: фотография чужого зала под названием
 * клуба — это ложь о клубе, а не оформление. Своих снимков у клуба нет тоже
 * (решение от 02.10.2026): только квадратный логотип и фирменный цвет.
 */
export function ClubMark({
  club,
  size = 'md',
  className,
}: {
  club: Pick<ClubRef, 'name' | 'accentColor'> & { logoFileId?: string | null };
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = { sm: 'h-9 w-9', md: 'h-12 w-12', lg: 'h-16 w-16' }[size];
  const text = { sm: 'text-[0.8125rem]', md: 'text-[1rem]', lg: 'text-[1.375rem]' }[size];
  const logo = useSharedFileUrl(club.logoFileId ?? null);

  // Логотип — квадрат того же размера, что монограмма (решение от
  // 02.10.2026): сервер принимает только квадратный знак и приводит его к
  // 512×512, поэтому слот один на оба случая и строку списка не разносит.
  if (club.logoFileId) {
    return (
      // Светлая подложка — не оформление, а условие читаемости: клуб мог
      // нарисовать знак тёмной краской по прозрачному фону, и на тёмной теме
      // такой знак проваливается в фон целиком. Инвертировать чужой логотип
      // фильтром нельзя — у него могут быть свои цвета, и инверсия их
      // переврёт. Поэтому фон у знака всегда светлый, в обеих темах. Пока
      // байты едут, стоит та же пустая подложка — без мигания монограммой.
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 overflow-hidden rounded-control border border-border bg-ink-0 p-0.5',
          box,
          className,
        )}
      >
        {logo && (
          // Пустой alt: рядом всегда стоит название клуба, и диктор, читающий
          // его дважды, только мешает.
          <img src={logo} alt="" className="h-full w-full object-contain" />
        )}
      </span>
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
