import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/Button';

const OFFERINGS = [
  {
    title: 'Тренировки',
    text: 'Групповые и индивидуальные занятия с тренерами академии — от первой ракетки до разбора тактики.',
  },
  {
    title: 'Аренда столов',
    text: 'Свободный стол на час в удобном зале. Забронировать можно заранее, оплатить — на месте или онлайн.',
  },
  {
    title: 'Турниры',
    text: 'Еженедельные клубные турниры: играют все уровни, а не только разрядники.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-5 sm:h-24 sm:px-8">
        <Logo height={2} />
        <div className="flex items-center gap-1.5 sm:gap-3">
          <ThemeToggle />
          <Link href="/login">
            <Button variant="secondary">Войти</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <section className="py-16 sm:py-24">
          <p className="mb-4 text-[0.8125rem] tracking-[0.18em] text-text-accent uppercase">
            Красноярск
          </p>

          <h1 className="max-w-3xl text-[2.25rem] sm:text-[3.25rem]">
            Академия настольного тенниса «Енисей»
          </h1>

          <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-text-muted">
            Развиваем культуру настольного тенниса и делаем этот спорт доступным каждому. Записаться
            на тренировку, забронировать стол и попасть на клубный турнир — в одном месте.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/register">
              <Button size="lg">Записаться</Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="secondary">
                У меня уже есть аккаунт
              </Button>
            </Link>
          </div>
        </section>

        <hr className="river-rule" />

        <section className="grid gap-10 py-16 sm:grid-cols-3 sm:gap-8">
          {OFFERINGS.map((item) => (
            <div key={item.title}>
              <h2 className="text-[1.25rem]">{item.title}</h2>
              <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-text-muted">{item.text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-9 text-[0.8125rem] text-text-subtle sm:px-8">
          <Logo height={1.25} />
          <p>Доступность · Профессионализм · Развитие характера · Комьюнити</p>
        </div>
      </footer>
    </div>
  );
}
