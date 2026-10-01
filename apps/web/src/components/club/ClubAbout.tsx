import type { ReactNode } from 'react';
import type { PublicTenant } from '@yenisey/types';
import { cn } from '@/lib/cn';
import { SectionHeading } from './SectionHeading';

/**
 * «О клубе»: описание и ключевые ценности — не больше трёх (решения
 * владельца от 25.09 и 01.10.2026), под заголовком, как у остальных блоков.
 * Контакты — на обложке справа (`ClubContacts`, решение от 01.10.2026).
 */
export function ClubAbout({ tenant }: { tenant: PublicTenant | null }) {
  if (!tenant) {
    return null;
  }

  const empty = !tenant.description && tenant.values.length === 0;

  return (
    <section className="mb-12" aria-label="О клубе">
      <SectionHeading title="О клубе" description="Чем живёт клуб и ради чего в него приходят." />

      {empty && <p className="text-[0.9375rem] text-text-muted">Клуб пока не рассказал о себе.</p>}

      {tenant.description && (
        <p className="max-w-3xl text-[1rem] leading-relaxed whitespace-pre-line text-text">{tenant.description}</p>
      )}

      {tenant.values.length > 0 && (
        <ul className={cn('grid gap-3 sm:grid-cols-3', tenant.description && 'mt-6')}>
          {tenant.values.map((value, index) => (
            <li
              key={`${index}-${value.title}`}
              className="rounded-card border border-border bg-surface-raised px-5 py-4"
            >
              <p className="flex items-baseline gap-2.5 text-[1rem] font-medium text-text">
                <span aria-hidden="true" className="font-display text-[0.875rem] text-text-accent">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {value.title}
              </p>
              {value.text && <p className="mt-1.5 text-[0.875rem] leading-relaxed text-text-muted">{value.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Контакты клуба на обложке — одной строкой внизу, под кнопками (решение
 * владельца от 01.10.2026). Всегда все четыре (решение от 30.09.2026): не заполненный —
 * со знаком и словами «не указан», а не пропадает. Иначе посетитель не
 * отличит «у клуба нет ВКонтакте» от «страница не догрузилась».
 */
export function ClubContacts({ tenant }: { tenant: PublicTenant }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Контакты клуба">
      <Contact
        href={tenant.phone ? `tel:${tenant.phone}` : null}
        label={tenant.phone ?? 'не указан'}
        name="Телефон"
        icon={
          <RoundIcon>
            <PhoneIcon />
          </RoundIcon>
        }
      />
      <Contact
        href={tenant.email ? `mailto:${tenant.email}` : null}
        label={tenant.email ?? 'не указана'}
        name="Почта"
        icon={
          <RoundIcon>
            <MailIcon />
          </RoundIcon>
        }
      />
      <Contact
        href={tenant.vkUrl}
        label={tenant.vkUrl ? 'ВКонтакте' : 'не указан'}
        name="ВКонтакте"
        icon={<VkLogo />}
        external
      />
      <Contact
        href={tenant.maxUrl}
        label={tenant.maxUrl ? 'MAX' : 'не указан'}
        name="MAX"
        icon={<MaxLogo />}
        external
      />
    </ul>
  );
}

/** Контакт строкой на тёмной обложке: есть — ссылка, нет — приглушённое «не указан». */
function Contact({
  href,
  label,
  name,
  icon,
  external = false,
}: {
  href: string | null;
  label: string;
  /** Что это за контакт — для диктора и подсказки у пустого. */
  name: string;
  icon: ReactNode;
  external?: boolean;
}) {
  const className =
    'flex min-w-0 items-center gap-2.5 rounded-full border py-1.5 pr-4 pl-1.5 text-[0.875rem] backdrop-blur-sm';

  if (!href) {
    return (
      <li>
        <span
          className={cn(className, 'border-dashed border-white/25 bg-black/15 text-white/55')}
          title={`${name}: не указан`}
          aria-label={`${name}: не указан`}
        >
          <span className="opacity-50 grayscale">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        aria-label={external ? `${name} клуба` : undefined}
        className={cn(className, 'border-white/30 bg-black/25 text-white transition-colors hover:bg-black/40')}
      >
        {icon}
        <span className="truncate">{label}</span>
      </a>
    </li>
  );
}

function RoundIcon({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/90 text-ink-950">{children}</span>
  );
}

/** Знак ВКонтакте — фирменный синий квадрат с буквами. */
function VkLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden="true">
      <rect width="24" height="24" rx="7" fill="#0077FF" />
      <path
        fill="#fff"
        d="M12.8 17.2c-5.1 0-8-3.5-8.1-9.3h2.6c.1 4.3 2 6.1 3.5 6.5V7.9h2.4v3.7c1.5-.2 3.1-1.9 3.6-3.7h2.4c-.4 2.3-2.1 4-3.3 4.7 1.2.6 3.1 2 3.9 4.6h-2.7c-.6-1.8-2-3.1-3.9-3.3v3.3h-.4Z"
      />
    </svg>
  );
}

/** Знак MAX — градиентный квадрат с облаком сообщения. */
function MaxLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <defs>
        <linearGradient id="max-logo-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3D8BFF" />
          <stop offset="1" stopColor="#8A3DFF" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="7" fill="url(#max-logo-fill)" />
      <path
        fill="#fff"
        d="M12 5.5c-3.9 0-6.8 2.8-6.8 6.4 0 1.9.8 3.5 2.2 4.7l-.5 2.3 2.4-1.2c.8.3 1.7.5 2.7.5 3.9 0 6.8-2.8 6.8-6.3S15.9 5.5 12 5.5Zm-2.9 8.7V9.6h1.3l1.6 2.3 1.6-2.3h1.3v4.6h-1.3v-2.6l-1.6 2.2-1.6-2.2v2.6H9.1Z"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M3.5 2h2.2l1.1 3-1.5 1a8 8 0 0 0 4.7 4.7l1-1.5 3 1.1v2.2A1.5 1.5 0 0 1 12.5 14 10.5 10.5 0 0 1 2 3.5 1.5 1.5 0 0 1 3.5 2Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="m2.5 4.5 5.5 4 5.5-4" />
    </svg>
  );
}
