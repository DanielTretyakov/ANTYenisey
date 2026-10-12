/**
 * Галерея писем одним файлом — `docs/mail-examples.html`.
 *
 *   pnpm --filter @yenisey/api mail:gallery
 *
 * Самостоятельная страница: открывается двойным щелчком, без запущенного API
 * и сайта. Каждое письмо — в светлой и тёмной теме рядом; знак «Стол»
 * встроен картинкой в сам файл, а не ссылкой на сайт. Рисует те же
 * шаблоны и пробные данные, что `/api/dev/mail/preview`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LETTER_SAMPLES } from '../src/mail/letter-samples.ts';
import { escapeHtml, renderLetter } from '../src/mail/letters.ts';

const root = resolve(import.meta.dirname, '../../..');
const origin = 'https://ant-yenisey.ru';
const icon = `data:image/png;base64,${readFileSync(resolve(root, 'apps/web/public/icons/icon-192.png')).toString('base64')}`;

/** Тёмная версия письма: медиазапрос темы срабатывает всегда. */
function dark(html: string): string {
  return html.replace('@media (prefers-color-scheme: dark) {', '@media all {');
}

/** Светлая — не срабатывает никогда, какая бы тема ни стояла у смотрящего. */
function light(html: string): string {
  return html.replace('@media (prefers-color-scheme: dark) {', '@media not all {');
}

const letters = LETTER_SAMPLES.map((sample) => {
  const letter = renderLetter(sample.template, sample.payload, {
    webOrigin: origin,
    operator: null,
    ...(sample.news ? { unsubscribeUrl: `${origin}/unsubscribe?t=proba` } : {}),
  });
  const html = letter.html.replace(`${origin}/icons/icon-192.png`, icon);

  return `<section>
  <h2>${escapeHtml(sample.title)}</h2>
  <p class="subject">Тема: <b>${escapeHtml(letter.subject)}</b></p>
  <div class="pair">
    <figure><figcaption>Светлая</figcaption><iframe loading="lazy" srcdoc="${escapeHtml(light(html))}"></iframe></figure>
    <figure><figcaption>Тёмная</figcaption><iframe loading="lazy" srcdoc="${escapeHtml(dark(html))}"></iframe></figure>
  </div>
  <details><summary>Текстовая версия</summary><pre>${escapeHtml(letter.text)}</pre></details>
</section>`;
}).join('\n');

const page = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Письма КНТ</title>
<style>
  body { margin: 0; background: #f6f5f1; color: #1d2320; font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
  .page { max-width: 1240px; margin: 0 auto; padding: 40px 16px 64px; }
  h1 { font-size: 2rem; margin: 0 0 8px; }
  .intro { color: #5d6661; max-width: 720px; margin: 0 0 32px; }
  section { margin: 0 0 48px; }
  h2 { font-size: 1.25rem; margin: 0 0 4px; }
  .subject { color: #5d6661; margin: 0 0 12px; font-size: .9375rem; }
  .pair { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  @media (max-width: 860px) { .pair { grid-template-columns: 1fr; } }
  figure { margin: 0; }
  figcaption { font-size: .8125rem; color: #858c88; margin: 0 0 6px; }
  iframe { width: 100%; height: 760px; border: 1px solid #e3e1da; border-radius: 12px; background: #fff; }
  details { margin-top: 8px; }
  pre { white-space: pre-wrap; background: #fff; border: 1px solid #e3e1da; border-radius: 10px; padding: 12px 14px; font-size: .8125rem; }
</style>
</head>
<body>
<div class="page">
<h1>Письма КНТ</h1>
<p class="intro">Все письма платформы на пробных данных — каждое в светлой и тёмной теме: почтовик сам выбирает по теме телефона или компьютера. Ниже каждого — простая текстовая версия, которую видят простые клиенты. Ссылки ведут на ant-yenisey.ru; оператор пока «уточняется».</p>
${letters}
</div>
</body>
</html>
`;

const target = resolve(root, 'docs/mail-examples.html');
writeFileSync(target, page);
console.log(`Готово: ${target} (${LETTER_SAMPLES.length} писем)`);
