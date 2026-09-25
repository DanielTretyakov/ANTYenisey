import type { PublicTenant } from '@yenisey/types';

/**
 * «О клубе»: описание, ценности карточками и как связаться — телефон, почта,
 * ВКонтакте и MAX (решение владельца от 25.09.2026). Ничего не заполнено —
 * блока нет вовсе: пустой заголовок «О клубе» хуже никакого.
 */
export function ClubAbout({ tenant }: { tenant: PublicTenant | null }) {
  if (!tenant) {
    return null;
  }

  const contacts = tenant.phone || tenant.email || tenant.vkUrl || tenant.maxUrl;

  if (!tenant.description && tenant.values.length === 0 && !contacts) {
    return null;
  }

  return (
    <section className="mb-10 grid gap-6" aria-label="О клубе">
      {tenant.description && (
        <p className="max-w-3xl text-[1rem] leading-relaxed whitespace-pre-line text-text">{tenant.description}</p>
      )}

      {tenant.values.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tenant.values.map((value, index) => (
            <li key={`${index}-${value.title}`} className="rounded-card border border-border bg-surface-raised px-5 py-4">
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

      {contacts && (
        <p className="flex flex-wrap items-center gap-2">
          {tenant.phone && <ContactLink href={`tel:${tenant.phone}`} label={tenant.phone} icon={<PhoneIcon />} />}
          {tenant.email && <ContactLink href={`mailto:${tenant.email}`} label={tenant.email} icon={<MailIcon />} />}
          {tenant.vkUrl && <ContactLink href={tenant.vkUrl} label="ВКонтакте" icon={<Monogram text="VK" />} external />}
          {tenant.maxUrl && <ContactLink href={tenant.maxUrl} label="MAX" icon={<Monogram text="M" />} external />}
        </p>
      )}
    </section>
  );
}

function ContactLink({
  href,
  label,
  icon,
  external = false,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised py-1.5 pr-3.5 pl-2 text-[0.875rem] text-text transition-colors hover:border-border-strong"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-accent-soft text-text-accent">{icon}</span>
      {label}
    </a>
  );
}

/** Буквы вместо логотипа сети: чужие знаки без их файлов не рисуем. */
function Monogram({ text }: { text: string }) {
  return <span className="text-[0.625rem] font-semibold tracking-tight">{text}</span>;
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3.5 2h2.2l1.1 3-1.5 1a8 8 0 0 0 4.7 4.7l1-1.5 3 1.1v2.2A1.5 1.5 0 0 1 12.5 14 10.5 10.5 0 0 1 2 3.5 1.5 1.5 0 0 1 3.5 2Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="m2.5 4.5 5.5 4 5.5-4" />
    </svg>
  );
}
