'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { inputClassName } from '@/components/ui/Field';
import { cn } from '@/lib/cn';

/**
 * Поле текста новости с кнопками разметки (решение владельца от 30.09.2026):
 * жирный, курсив, подчёркивание и маркированный список — клуба и платформы.
 *
 * Кнопки не делают ничего, чего нельзя набрать руками: они расставляют те же
 * пометки (`**`, `*`, `__`, «- »), что разбирает `parseMarkup`. Поэтому
 * хранится простой текст, а не HTML, и то, что видно в поле, — ровно то, что
 * уйдёт на сервер.
 */

type Wrap = { marker: string; label: string; title: string; key: string; className: string };

const WRAPS: Wrap[] = [
  { marker: '**', label: 'Ж', title: 'Жирный (Ctrl+B)', key: 'b', className: 'font-bold' },
  { marker: '*', label: 'К', title: 'Курсив (Ctrl+I)', key: 'i', className: 'italic' },
  { marker: '__', label: 'Ч', title: 'Подчёркнутый (Ctrl+U)', key: 'u', className: 'underline underline-offset-2' },
];

const LIST_ITEM = /^\s*[-•]\s+/;

export function MarkupEditor({
  label,
  value,
  onChange,
  rows = 10,
  maxLength,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  required?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);

  /** Новое значение и выделение — выделение ставится после отрисовки. */
  function apply(next: string, start: number, end: number): void {
    onChange(next);
    requestAnimationFrame(() => {
      const element = area.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(start, end);
    });
  }

  function wrap({ marker }: Wrap): void {
    const element = area.current;
    if (!element) return;

    const { selectionStart: start, selectionEnd: end } = element;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);
    const size = marker.length;

    // Уже обёрнуто этой пометкой — снимаем. Курсив не путается с жирным:
    // «**x**» при курсиве снаружи выглядит как «*» + «*x*» + «*».
    const wrapped =
      before.endsWith(marker) &&
      after.startsWith(marker) &&
      !(marker === '*' && before.endsWith('**') && after.startsWith('**') && !before.endsWith('***'));

    if (wrapped) {
      apply(before.slice(0, -size) + selected + after.slice(size), start - size, end - size);
      return;
    }

    // Пробелы по краям выделения остаются снаружи: «** слово**» — не пометка.
    const lead = selected.length - selected.trimStart().length;
    const trail = selected.length - selected.trimEnd().length;
    const core = selected.trim();

    apply(
      `${before}${selected.slice(0, lead)}${marker}${core}${marker}${selected.slice(selected.length - trail)}${after}`,
      start + lead + size,
      start + lead + size + core.length,
    );
  }

  function toggleList(): void {
    const element = area.current;
    if (!element) return;

    // Выделение расширяется до целых строк.
    const lineStart = value.lastIndexOf('\n', element.selectionStart - 1) + 1;
    const nextBreak = value.indexOf('\n', element.selectionEnd);
    const lineEnd = nextBreak < 0 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const filled = lines.filter((line) => line.trim());
    const isList = filled.length > 0 && filled.every((line) => LIST_ITEM.test(line));

    const changed = lines
      .map((line) => {
        if (isList) return line.replace(LIST_ITEM, '');
        return line.trim() ? `- ${line}` : lines.length === 1 ? '- ' : line;
      })
      .join('\n');

    apply(value.slice(0, lineStart) + changed + value.slice(lineEnd), lineStart, lineStart + changed.length);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;

    const found = WRAPS.find((item) => item.key === event.key.toLowerCase());

    if (found) {
      event.preventDefault();
      wrap(found);
    }
  }

  const button =
    'grid h-8 min-w-8 place-items-center rounded-control px-2 text-[0.9375rem] text-text-muted transition-colors hover:bg-surface-accent-soft hover:text-text-accent';

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-[0.8125rem] font-medium text-text-muted">
        {label}
      </label>

      <div className="rounded-control border border-border bg-surface-raised focus-within:border-accent">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1" role="toolbar" aria-label="Оформление текста">
          {WRAPS.map((item) => (
            <button
              key={item.marker}
              type="button"
              title={item.title}
              aria-label={item.title}
              onClick={() => wrap(item)}
              className={cn(button, item.className)}
            >
              {item.label}
            </button>
          ))}
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          <button type="button" title="Маркированный список" aria-label="Маркированный список" onClick={toggleList} className={button}>
            <ListIcon />
          </button>
        </div>

        <textarea
          id={id}
          ref={area}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={rows}
          maxLength={maxLength}
          required={required}
          className={cn(inputClassName, 'resize-y rounded-t-none border-0 hover:border-0')}
        />
      </div>

      <p className="mt-1.5 text-[0.8125rem] text-text-subtle">
        {hint ?? 'Выделите слова и нажмите кнопку. Абзацы — через пустую строку, пункт списка — строка с «- ».'}
      </p>
    </div>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="2.8" cy="4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="2.8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="2.8" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <path d="M6 4h8M6 8h8M6 12h8" strokeLinecap="round" />
    </svg>
  );
}
