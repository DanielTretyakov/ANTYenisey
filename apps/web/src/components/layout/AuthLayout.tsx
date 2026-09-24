import Link from 'next/link';
import type { ReactNode } from 'react';
import { PlatformLogo } from '@/components/brand/PlatformLogo';
import { RiverBackdrop } from '@/components/brand/RiverBackdrop';
import { HEADER_HEIGHT, HEADER_LOGO_HEIGHT } from '@/components/layout/metrics';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/cn';

/**
 * Разворот для входа и регистрации: слева — обещание платформы, справа — форма.
 *
 * Обещание именно платформы, а не клуба: аккаунт один на все клубы, и человек
 * заводит его до того, как выбрал, куда пойдёт играть. Раньше здесь стояла
 * миссия академии «Енисей» — на общей форме входа она обещала не то.
 *
 * Левая половина изумрудная и на узком экране не показывается вовсе. Это не
 * экономия места: человек, открывший форму входа с телефона у стола в зале,
 * пришёл нажать две кнопки, и прокручивать мимо обещания ему незачем.
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
          <PlatformLogo height={2.25} onDark />
        </Link>

        <div className="relative z-10 max-w-md">
          <p className="font-display text-[2rem] leading-[1.2] text-white">
            Один аккаунт — все клубы настольного тенниса
          </p>
          <p className="mt-5 text-[0.9375rem] leading-relaxed text-brand-100">
            Занятия, турниры и аренда стола в клубе рядом с домом и в любом другом, куда занесёт.
            Заводить учётную запись в каждом не нужно.
          </p>
        </div>

        <p className="relative z-10 text-[0.8125rem] tracking-wide text-brand-200">
          Доступность · Профессионализм · Развитие характера · Комьюнити
        </p>
      </aside>

      <main className="flex flex-1 flex-col">
        {/* Своя полоса, а не SiteHeader: разворот входа делится пополам, и
            шапка во всю ширину разрезала бы изумрудную половину. Высота и
            размер логотипа взяты оттуда же — полоса не должна менять рост при
            переходе с формы входа на любую другую страницу. */}
        <header className={cn('flex items-center px-5 sm:px-8 lg:px-12', HEADER_HEIGHT)}>
          <Link href="/" className="lg:hidden">
            <PlatformLogo height={HEADER_LOGO_HEIGHT} />
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
