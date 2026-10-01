/**
 * Разметка текста новостей — клуба и платформы (решение владельца от
 * 30.09.2026): жирный, курсив, подчёркивание и маркированный список.
 *
 * Хранится простой текст с пометками, а не HTML: страница строит элементы
 * из разобранного дерева сама, и вставить в неё скрипт через новость нельзя.
 *
 * - `**жирный**`, `*курсив*`, `__подчёркнутый__`;
 * - строка, начатая с «- » или «• », — пункт списка;
 * - абзацы — через пустую строку, перенос внутри абзаца сохраняется.
 *
 * Пометка без пары остаётся текстом как есть: «5 * 3» не должно пропасть.
 * Пометка внутри слова не срабатывает — «snake__case__name» остаётся словом.
 *
 * Общий модуль: веб рисует им новость, сервер — готовит выдержку для
 * сообщений, куда звёздочки уйти не должны.
 */

export interface MarkupSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export type MarkupBlock =
  | { kind: 'paragraph'; spans: MarkupSpan[] }
  | { kind: 'list'; items: MarkupSpan[][] };

type Style = Pick<MarkupSpan, 'bold' | 'italic' | 'underline'>;

const MARKERS: { marker: string; style: keyof Style }[] = [
  { marker: '**', style: 'bold' },
  { marker: '__', style: 'underline' },
  { marker: '*', style: 'italic' },
];

const LIST_ITEM = /^\s*[-•]\s+/;
const WORD = /[\p{L}\p{N}]/u;

/** Текст — в блоки: абзацы и списки. */
export function parseMarkup(body: string): MarkupBlock[] {
  const blocks: MarkupBlock[] = [];

  for (const paragraph of body.split(/\n\s*\n/)) {
    const lines = paragraph.split('\n');
    let text: string[] = [];
    let items: MarkupSpan[][] = [];

    const flushText = (): void => {
      const joined = text.join('\n').trim();
      if (joined) blocks.push({ kind: 'paragraph', spans: parseInline(joined) });
      text = [];
    };
    const flushList = (): void => {
      if (items.length > 0) blocks.push({ kind: 'list', items });
      items = [];
    };

    for (const line of lines) {
      if (LIST_ITEM.test(line)) {
        flushText();
        const item = line.replace(LIST_ITEM, '').trim();
        // Пустой пункт «- » ничего не сообщает — не рисуем точку без текста.
        if (item) items.push(parseInline(item));
      } else {
        flushList();
        text.push(line);
      }
    }

    flushText();
    flushList();
  }

  return blocks;
}

/**
 * Текст без пометок — для выдержек и сообщений. Пункты списка — с «• »,
 * абзацы — через пустую строку: выдержка берёт первый абзац.
 */
export function plainText(body: string): string {
  return parseMarkup(body)
    .map((block) =>
      block.kind === 'paragraph'
        ? spansText(block.spans)
        : block.items.map((item) => `• ${spansText(item)}`).join('\n'),
    )
    .join('\n\n');
}

function spansText(spans: MarkupSpan[]): string {
  return spans.map((span) => span.text).join('');
}

/** Строчные пометки — отрезки текста со стилем. */
export function parseInline(text: string): MarkupSpan[] {
  return merge(inline(text, {}));
}

function inline(text: string, style: Style): MarkupSpan[] {
  const spans: MarkupSpan[] = [];
  let plain = '';
  let index = 0;

  while (index < text.length) {
    let opened: (typeof MARKERS)[number] | undefined;
    let close = -1;

    for (const candidate of MARKERS) {
      if (!text.startsWith(candidate.marker, index) || !canOpen(text, index, candidate.marker)) continue;

      close = findClose(text, index + candidate.marker.length, candidate.marker);

      if (close >= 0) {
        opened = candidate;
        break;
      }
    }

    if (!opened) {
      plain += text[index];
      index += 1;
      continue;
    }

    if (plain) spans.push({ text: plain, ...style });
    plain = '';

    spans.push(...inline(text.slice(index + opened.marker.length, close), { ...style, [opened.style]: true }));
    index = close + opened.marker.length;
  }

  if (plain) spans.push({ text: plain, ...style });

  return spans;
}

/** Открыть можно не внутри слова и не перед пробелом. */
function canOpen(text: string, index: number, marker: string): boolean {
  const before = text[index - 1];
  const after = text[index + marker.length];

  return after !== undefined && !/\s/.test(after) && (before === undefined || !WORD.test(before));
}

/**
 * Закрывающая пара: не после пробела и не внутри слова. Курсив ищет одну
 * звёздочку и перешагивает «**» — это жирный внутри курсива.
 */
function findClose(text: string, from: number, marker: string): number {
  for (let index = from + 1; index < text.length; index += 1) {
    if (marker === '*' && text.startsWith('**', index)) {
      index += 1;
      continue;
    }

    if (!text.startsWith(marker, index)) continue;

    // «***слово***»: жирный закрывается последней парой звёздочек серии, а
    // первая остаётся курсиву внутри — иначе жирный съел бы её.
    if (marker.length === 2 && text[index + 2] === marker[0]) continue;

    const before = text[index - 1]!;
    const after = text[index + marker.length];

    if (!/\s/.test(before) && (after === undefined || !WORD.test(after))) {
      return index;
    }
  }

  return -1;
}

/** Соседние отрезки одного стиля — одним. */
function merge(spans: MarkupSpan[]): MarkupSpan[] {
  const merged: MarkupSpan[] = [];

  for (const span of spans) {
    const last = merged[merged.length - 1];

    if (last && !!last.bold === !!span.bold && !!last.italic === !!span.italic && !!last.underline === !!span.underline) {
      last.text += span.text;
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}
