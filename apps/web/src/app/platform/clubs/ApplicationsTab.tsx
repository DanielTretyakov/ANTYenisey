'use client';

import { useState } from 'react';
import {
  CLUB_APPLICATION_STATUS_LABELS,
  CLUB_APPLICATION_STATUSES,
  type ClubApplicationStatus,
  type ClubApplicationView,
} from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { inputClassName } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';

const TONE: Record<ClubApplicationStatus, string> = {
  NEW: 'bg-warning-soft text-warning',
  IN_PROGRESS: 'bg-surface-accent-soft text-text-accent',
  CONNECTED: 'bg-surface-accent-soft text-text-accent',
  DECLINED: 'bg-surface-sunken text-text-muted',
};

function when(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/**
 * Заявки клубов со страницы «Подключить свой клуб» (решение владельца от
 * 03.10.2026): кто, откуда, как связаться — и статус с заметкой. Новые —
 * сверху: их порядок задаёт сервер.
 */
export function ApplicationsTab({
  items,
  onChange,
}: {
  items: ClubApplicationView[];
  onChange: (item: ClubApplicationView) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-card border border-border bg-surface-raised px-5 py-6 text-[0.9375rem] text-text-muted">
        Заявок пока нет. Они приходят со страницы «Подключить свой клуб» — сообщением в MAX и сюда.
      </p>
    );
  }

  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li key={item.id}>
          <ApplicationCard item={item} onChange={onChange} />
        </li>
      ))}
    </ul>
  );
}

function ApplicationCard({ item, onChange }: { item: ClubApplicationView; onChange: (item: ClubApplicationView) => void }) {
  const [status, setStatus] = useState<ClubApplicationStatus>(item.status);
  const [note, setNote] = useState(item.note ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = status !== item.status || note.trim() !== (item.note ?? '');

  const size = [
    item.halls ? `${item.halls} ${plural(item.halls, 'зал', 'зала', 'залов')}` : null,
    item.tables ? `${item.tables} ${plural(item.tables, 'стол', 'стола', 'столов')}` : null,
  ].filter(Boolean);

  async function save(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      onChange(await api.updateClubApplication(item.id, { status, note: note.trim() || null }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="grid gap-4 rounded-card border border-border bg-surface-raised px-5 py-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid content-start gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[1.0625rem] font-semibold">{item.clubName}</h3>
          <span className={cn('rounded-full px-2.5 py-0.5 text-[0.75rem] font-semibold', TONE[item.status])}>
            {CLUB_APPLICATION_STATUS_LABELS[item.status]}
          </span>
        </div>
        <p className="text-[0.875rem] text-text-muted">
          {[item.city ?? 'город не указан', ...size].join(' · ')} · {when(item.createdAt)}
        </p>
        <p className="text-[0.9375rem]">
          {item.contactName}
          {item.phone && (
            <>
              {' · '}
              <a href={`tel:${item.phone}`} className="text-text-accent underline underline-offset-2">
                {item.phone}
              </a>
            </>
          )}
          {item.email && (
            <>
              {' · '}
              <a href={`mailto:${item.email}`} className="text-text-accent underline underline-offset-2">
                {item.email}
              </a>
            </>
          )}
        </p>
        {item.comment && <p className="text-[0.875rem] whitespace-pre-line text-text-muted">«{item.comment}»</p>}
      </div>

      <div className="grid content-start gap-2">
        {error && <Alert>{error}</Alert>}
        <label className="grid gap-1 text-[0.8125rem] text-text-muted">
          Статус
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ClubApplicationStatus)}
            className={cn(inputClassName, 'py-2')}
          >
            {CLUB_APPLICATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {CLUB_APPLICATION_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[0.8125rem] text-text-muted">
          Заметка
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Созвонились, ждут договор…"
            className={cn(inputClassName, 'resize-y py-2')}
          />
        </label>
        <Button size="sm" pending={pending} disabled={!dirty} onClick={() => void save()} className="justify-self-start">
          Сохранить
        </Button>
      </div>
    </article>
  );
}
