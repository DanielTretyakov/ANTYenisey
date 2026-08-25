import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * Разворот для входа и регистрации: слева — обещание клуба, справа — форма.
 *
 * Левая половина изумрудная и на узком экране не показывается вовсе. Это не
 * экономия места: человек, открывший форму входа с телефона у стола в зале,
 * пришёл нажать две кнопки, и прокручивать мимо миссии академии ему незачем.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="relative hidden overflow-hidden bg-brand-900 px-12 py-14 text-white lg:flex lg:w-[44%] lg:flex-col lg:justify-between">
        <RiverBackdrop />

        <Link href="/" className="relative z-10 w-fit text-white">
          <Logo height={2.25} onDark />
        </Link>

        <div className="relative z-10 max-w-md">
          <p className="font-display text-[2rem] leading-[1.2] text-white">
            От новичка до чемпиона — вместе с нами
          </p>
          <p className="mt-5 text-[0.9375rem] leading-relaxed text-brand-100">
            Академия настольного тенниса в Красноярске. Запись на тренировки, аренда столов,
            клубные турниры — в одном месте.
          </p>
        </div>

        <p className="relative z-10 text-[0.8125rem] tracking-wide text-brand-200">
          Доступность · Профессионализм · Развитие характера · Комьюнити
        </p>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="flex h-20 items-center px-5 sm:h-24 sm:px-8 lg:px-12">
          <Link href="/" className="lg:hidden">
            <Logo height={1.625} />
          </Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center px-5 pb-16 sm:px-8 lg:px-12">
          <div className="w-full max-w-[26rem]">
            <h1 className="text-[1.75rem]">{title}</h1>
            {subtitle && <p className="mt-2 mb-7 text-[0.9375rem] text-text-muted">{subtitle}</p>}
            {!subtitle && <div className="mb-7" />}

            {children}

            {footer && <div className="mt-7 text-[0.875rem] text-text-muted">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Фон левой половины: русло реки между горами.
 *
 * Чистая геометрия вместо фотографии — в брендбуке требование «ничего
 * вылизанного», а стоковый снимок зала в подложке читается ровно наоборот.
 */
function RiverBackdrop() {
  return (
    <svg
      viewBox="0 0 400 800"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <path
        d="M-40 820 C120 640 60 520 180 380 C280 260 240 140 330 -20"
        fill="none"
        stroke="white"
        strokeOpacity="0.07"
        strokeWidth="120"
        strokeLinecap="round"
      />
      <path
        d="M-40 820 C120 640 60 520 180 380 C280 260 240 140 330 -20"
        fill="none"
        stroke="white"
        strokeOpacity="0.1"
        strokeWidth="2"
      />
      <path
        d="M-40 700 L60 560 L110 620 L190 480 L250 570 L330 430 L440 560"
        fill="none"
        stroke="white"
        strokeOpacity="0.08"
        strokeWidth="2"
      />
    </svg>
  );
}
