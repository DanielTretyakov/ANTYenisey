/**
 * Ограничитель неудачных попыток входа.
 *
 * Считает только провалы и только по адресу почты, а не по IP. Так задумано:
 *
 * - учёт по IP ломает клубы, где все входят из одной сети зала, и обходится
 *   ботнетом, которому смена адреса ничего не стоит;
 * - успешные входы не учитываются, поэтому активная работа честного клиента
 *   никогда не приближает его к блокировке;
 * - подбор пароля к конкретной учётке — единственный сценарий, который
 *   ограничитель обязан остановить, и по этому ключу он останавливается вне
 *   зависимости от того, с скольких адресов идёт перебор.
 *
 * Счётчики живут в памяти процесса. Для одного экземпляра API этого
 * достаточно; когда экземпляров станет несколько, окно придётся перенести в
 * общее хранилище (Redis), иначе лимит умножится на число процессов.
 *
 * Класс намеренно без декораторов Nest: `node --test` со срезанием типов
 * декораторы не исполняет, а покрыть логику окна тестами нужно.
 */
export interface AttemptLimiterOptions {
  /** Сколько провалов подряд допускается внутри окна. */
  maxAttempts: number;
  /** Длина окна в миллисекундах. */
  windowMs: number;
  /** Часы — подменяются в тестах, чтобы не ждать реальное окно. */
  now?: () => number;
}

export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: AttemptLimiterOptions) {
    this.maxAttempts = options.maxAttempts;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  /**
   * Сколько миллисекунд осталось до следующей разрешённой попытки, или `null`,
   * если попытка разрешена прямо сейчас.
   */
  retryAfterMs(key: string): number | null {
    const recent = this.recentFailures(key);

    if (recent.length < this.maxAttempts) {
      return null;
    }

    // Разблокировка наступит, когда из окна выпадет самый ранний из учтённых
    // провалов, — а не через полное окно после последней попытки. Иначе
    // упорный бот держал бы честного владельца учётки заблокированным вечно.
    const oldest = recent[recent.length - this.maxAttempts]!;

    return oldest + this.windowMs - this.now();
  }

  /** Учесть неудачную попытку. */
  registerFailure(key: string): void {
    const recent = this.recentFailures(key);
    recent.push(this.now());
    this.failures.set(key, recent);
  }

  /** Сбросить счётчик — вызывается после успешного входа. */
  reset(key: string): void {
    this.failures.delete(key);
  }

  /**
   * Провалы внутри окна. Заодно вычищает просроченные: без этого карта росла
   * бы по одной записи на каждый когда-либо ошибшийся адрес.
   */
  private recentFailures(key: string): number[] {
    const threshold = this.now() - this.windowMs;
    const recent = (this.failures.get(key) ?? []).filter((at) => at > threshold);

    if (recent.length === 0) {
      this.failures.delete(key);
    }

    return recent;
  }
}

/**
 * Ключ окна — адрес почты, и только он.
 *
 * Раньше в ключ входил ещё и клуб: почта была уникальна парой (клуб, почта),
 * и один адрес мог принадлежать разным людям. Теперь почта уникальна по всей
 * платформе — за адресом стоит ровно один аккаунт, и клуб в ключе не просто
 * лишний, а вреден: подбирающий множил бы себе попытки, перебирая коды клубов
 * с одним и тем же адресом.
 */
export function attemptKey(email: string): string {
  return email.trim().toLowerCase();
}
