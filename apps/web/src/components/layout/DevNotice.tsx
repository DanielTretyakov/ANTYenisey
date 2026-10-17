/**
 * Полоса «Сервис в разработке» над шапкой (решение от 02.10.2026; с
 * 17.10.2026 — на всех страницах, одной строкой в корневом layout).
 *
 * Для случайного гостя: адрес уже живёт в интернете, а продукт ещё
 * обкатывается. Не липкая и не закрывается — она нужна тому, кто попал сюда
 * впервые, и уезжает вместе со страницей, не трогая высоту шапки и отступы
 * `top-20`, которые на неё завязаны.
 */
export function DevNotice() {
  return (
    <div role="note" className="border-b border-warning-border bg-warning-soft text-warning print:hidden">
      <p className="mx-auto w-full max-w-6xl px-5 py-2 text-center text-[0.8125rem] leading-snug font-medium sm:px-8">
        Сервис в разработке — возможны ошибки и изменения. Онлайн-оплаты пока нет.
      </p>
    </div>
  );
}
