import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Строительные блоки статей справки (решение владельца от 02.10.2026).
 *
 * Статья — простой TSX из этих блоков, без своей вёрстки: так двадцать пять
 * статей выглядят одинаково, а правка вида — правка одного файла.
 */

/** Абзац. */
export function P({ children }: { children: ReactNode }) {
  return <p className="text-[1rem] leading-relaxed text-text">{children}</p>;
}

/** Нумерованные шаги — только там, где порядок действительно важен. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="grid gap-3 [counter-reset:step]">{children}</ol>;
}

export function Step({ children }: { children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_1fr] items-start gap-3 [counter-increment:step] before:grid before:h-8 before:w-8 before:place-items-center before:rounded-full before:bg-surface-accent-soft before:text-[0.875rem] before:font-semibold before:text-text-accent before:content-[counter(step)]">
      <span className="pt-1 text-[1rem] leading-relaxed text-text">{children}</span>
    </li>
  );
}

/** Список без порядка. */
export function List({ children }: { children: ReactNode }) {
  return <ul className="grid list-disc gap-1.5 pl-5 text-[1rem] leading-relaxed text-text marker:text-text-subtle">{children}</ul>;
}

/** Подзаголовок внутри статьи. */
export function H({ children }: { children: ReactNode }) {
  return <h2 className="mt-2 text-[1.125rem] font-semibold text-text">{children}</h2>;
}

/** Важное: деньги, сроки, то, что нельзя отменить. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card bg-surface-accent-soft px-4 py-3 text-[0.9375rem] leading-relaxed text-text">
      {children}
    </div>
  );
}

/** Таблица «случай → что будет». Шире экрана — прокручивается сама. */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-[0.9375rem]">
        <thead>
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                className="border-b border-border px-3 py-2 text-left text-[0.75rem] font-semibold tracking-[0.06em] text-text-subtle uppercase"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column} className="border-b border-border px-3 py-2.5 align-top text-text">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ссылка внутри сайта — на раздел продукта или на другую статью. */
export function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-text-accent underline underline-offset-2">
      {children}
    </Link>
  );
}

/** Название кнопки или раздела — так, как оно написано в интерфейсе. */
export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold">«{children}»</strong>;
}
