'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  NEWS_BODY_MAX,
  NEWS_SECTION_LABELS,
  NEWS_SECTIONS,
  NEWS_TITLE_MAX,
  type NewsDraft,
  type NewsItem,
} from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { NewsBody, newsDate, SectionBadge } from '@/components/news/NewsParts';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, inputClassName } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/useSession';

const EMPTY: NewsDraft = { section: 'GENERAL', title: '', body: '', published: true };

/**
 * Редактор новостей платформы — только владелец платформы (решение от
 * 26.09.2026). Проверка роли здесь — удобство: запрет стоит на сервере.
 *
 * Слева — все новости, черновики сверху; справа — форма новой или выбранной.
 * Снять галочку «Опубликовать» — вернуть в черновики: новость пропадёт из
 * ленты, но останется здесь. Дата публикации при правке не сдвигается.
 */
export default function NewsEditorPage() {
  const session = useSession();
  const router = useRouter();
  const owner = session.status === 'ready' && session.user.platformOwner;

  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewsDraft>(EMPTY);
  const [preview, setPreview] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'anonymous') router.replace('/login?next=/news/editor');
  }, [session.status, router]);

  useEffect(() => {
    if (!owner) return;

    api
      .platformNews()
      .then(setItems)
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
  }, [owner]);

  function open(item: NewsItem | null): void {
    setEditing(item?.id ?? null);
    setDraft(
      item ? { section: item.section, title: item.title, body: item.body, published: item.publishedAt !== null } : EMPTY,
    );
    setPreview(false);
    setConfirmDelete(false);
    setError(null);
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const saved = editing ? await api.updateNews(editing, draft) : await api.createNews(draft);
      setItems(await api.platformNews());
      setEditing(saved.id);
      setNotice(saved.publishedAt ? 'Сохранено и опубликовано.' : 'Сохранено черновиком — в ленте его нет.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  async function remove(): Promise<void> {
    if (!editing) return;

    setPending(true);
    setError(null);

    try {
      await api.deleteNews(editing);
      setItems(await api.platformNews());
      open(null);
      setNotice('Новость удалена.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell>
      <Link href="/news" className="mb-5 inline-block text-[0.875rem] text-text-accent underline underline-offset-2">
        ← Лента новостей
      </Link>
      <h1 className="mb-6 text-[1.75rem]">Редактор новостей</h1>

      {session.status === 'ready' && !owner && (
        <Alert>Новости платформы пишет только её владелец.</Alert>
      )}

      {owner && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Все новости" description="Черновики — сверху." />
            <CardBody>
              <Button type="button" variant="secondary" size="sm" className="mb-4" onClick={() => open(null)}>
                + Новая новость
              </Button>

              {items === null && <p className="text-[0.9375rem] text-text-muted">Загружаю…</p>}
              {items?.length === 0 && <p className="text-[0.9375rem] text-text-muted">Новостей пока нет.</p>}

              <ul className="divide-y divide-border">
                {(items ?? []).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => open(item)}
                      aria-current={editing === item.id}
                      className={cn(
                        'w-full py-3 text-left',
                        editing === item.id ? 'text-text-accent' : 'text-text hover:text-text-accent',
                      )}
                    >
                      <span className="mb-1 flex flex-wrap items-center gap-2">
                        <SectionBadge section={item.section} />
                        <span className="text-[0.75rem] text-text-subtle">
                          {item.publishedAt ? newsDate(item.publishedAt) : 'черновик'}
                        </span>
                      </span>
                      <span className="block text-[0.9375rem] font-medium">{item.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={editing ? 'Правка новости' : 'Новая новость'}
              description="Простой текст: абзацы — через пустую строку. «Для клубов» видят только сотрудники клубов. В MAX новости не рассылаются."
            />
            <CardBody>
              {error && <Alert>{error}</Alert>}
              {notice && <Alert tone="info">{notice}</Alert>}

              <form onSubmit={save}>
                <Select
                  label="Раздел"
                  options={NEWS_SECTIONS.map((section) => ({ value: section, label: NEWS_SECTION_LABELS[section] }))}
                  value={draft.section}
                  onChange={(event) => setDraft({ ...draft, section: event.target.value as NewsDraft['section'] })}
                />
                <Field
                  label="Заголовок"
                  value={draft.title}
                  maxLength={NEWS_TITLE_MAX}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  required
                />
                <label className="mb-4 block">
                  <span className="mb-1.5 block text-[0.8125rem] font-medium text-text-muted">Текст</span>
                  <textarea
                    value={draft.body}
                    onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    rows={12}
                    maxLength={NEWS_BODY_MAX}
                    required
                    className={cn(inputClassName, 'resize-y')}
                  />
                </label>
                <Toggle
                  label="Опубликовать"
                  hint="Без галочки — черновик: его видите только вы."
                  checked={draft.published}
                  onChange={(event) => setDraft({ ...draft, published: event.target.checked })}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" pending={pending}>
                    Сохранить
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setPreview((value) => !value)}>
                    {preview ? 'Скрыть предпросмотр' : 'Предпросмотр'}
                  </Button>
                  {editing && !confirmDelete && (
                    <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
                      Удалить
                    </Button>
                  )}
                  {editing && confirmDelete && (
                    <>
                      <span className="text-[0.875rem] text-text-muted">Удалить насовсем?</span>
                      <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => void remove()}>
                        Да, удалить
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                        Отмена
                      </Button>
                    </>
                  )}
                </div>
              </form>

              {preview && draft.body.trim() && (
                <div className="mt-6 border-t border-border pt-5">
                  <h2 className="mb-4 text-[1.375rem]">{draft.title || 'Без заголовка'}</h2>
                  <NewsBody body={draft.body} />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
