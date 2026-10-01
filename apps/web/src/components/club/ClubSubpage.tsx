'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { PublicTenant } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { api } from '@/lib/api';
import { clubAccent } from '@/lib/clubTheme';
import { useClubSlug } from '@/lib/useClubApi';

/**
 * Отдельная страница клуба — новости, рейтинг (решение владельца от
 * 30.09.2026: развёрнутое — страницей, а не всплывающим окном). Шапка с
 * разделами клуба, путь назад к странице клуба и цвет клуба на содержимом —
 * как у самой страницы клуба.
 */
export function ClubSubpage({
  title,
  description,
  back,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Куда «назад», если не на страницу клуба: из публикации — к ленте. */
  back?: { href: string; label: string };
  children: ReactNode;
}) {
  const slug = useClubSlug();
  const [tenant, setTenant] = useState<PublicTenant | null>(null);

  useEffect(() => {
    api
      .tenant(slug)
      .then(setTenant)
      .catch(() => setTenant(null));
  }, [slug]);

  return (
    <AppShell clubSlug={slug}>
      <div style={clubAccent(tenant?.accentColor)}>
        <Link
          href={back?.href ?? `/clubs/${slug}`}
          className="mb-5 inline-block text-[0.875rem] text-text-accent underline underline-offset-2"
        >
          ← {back?.label ?? tenant?.name ?? 'К странице клуба'}
        </Link>

        <h1 className="mb-2 text-[1.75rem] leading-tight">{title}</h1>
        {description && <p className="mb-6 max-w-2xl text-[0.9375rem] text-text-muted">{description}</p>}

        {children}
      </div>
    </AppShell>
  );
}
