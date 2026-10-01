'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { hasAnyRole, MANAGING_ROLES, type ClubPost, type ClubPostRequest } from '@yenisey/types';
import { AdminShell } from '@/components/layout/AdminShell';
import { MarkupEditor } from '@/components/news/MarkupEditor';
import { NewsBody, newsDate } from '@/components/news/NewsParts';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Toggle } from '@/components/ui/Toggle';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { rolesInClub } from '@/lib/membership';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

const EMPTY: ClubPostRequest = { title: '', body: '', published: true };

/**
 * Лента клуба: акции и объявления (решение владельца от 26.09.2026). Пишут
 * руководитель, управляющий и администратор, любой из них правит любую
 * публикацию клуба.
 *
 * Опубликованное впервые уходит сообщением клиентам клуба в MAX и браузер
 * (кто не выключил «Новости клубов»; ночью — к восьми утра). Правка
 * опубликованного второго сообщения не шлёт.
 */
export default function ClubPostsEditorPage() {
  const session = useSession();
  const router = useRouter();
  const slug = useClubSlug();
  const club = useClubApi();

  const roles = session.status === 'ready' ? rolesInClub(session.user, slug) : [];
  const allowed = hasAnyRole(roles, MANAGING_ROLES);

  const [items, setItems] = useState<ClubPost[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClubPostRequest>(EMPTY);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'anonymous') router.replace('/login');
  }, [session.status, router]);

  useEffect(() => {
    if (!allowed) return;

    club
      .managePosts()
      .then(setItems)
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
  }, [allowed, club]);

  const current = items?.find((item) => item.id === editing) ?? null;

  const welcome = current?.welcome ?? false;
  // У приветствия «собирать из данных клуба» — текст правит не человек.
  const auto = welcome && (draft.auto ?? false);

  function open(item: ClubPost | null): void {
    setEditing(item?.id ?? null);
    setDraft(
      item
        ? {
            title: item.title,
            body: item.body,
            published: item.publishedAt !== null,
            ...(item.welcome ? { auto: item.autoBody } : {}),
          }
        : EMPTY,
    );
    setConfirmDelete(false);
    setError(null);
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const firstPublish = draft.published && !current?.publishedAt && !welcome;

    try {
      const saved = editing ? await club.updatePost(editing, draft) : await club.createPost(draft);
      setItems(await club.managePosts());
      setEditing(saved.id);
      setNotice(
        !saved.publishedAt
          ? 'Сохранено черновиком — на странице клуба его нет.'
          : firstPublish
            ? 'Опубликовано. Клиентам клуба ушло сообщение.'
            : 'Сохранено.',
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  /**
   * «Собирать из данных клуба»: выключили — в поле ложится текст по
   * умолчанию, чтобы править его, а не писать с нуля; включили — вернули
   * исходный.
   */
  async function setAuto(next: boolean): Promise<void> {
    setError(null);

    try {
      const text = await club.welcomeDefault();
      setDraft((value) => ({ ...value, title: text.title, body: text.body, auto: next }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    }
  }

  async function remove(): Promise<void> {
    if (!editing) return;

    setPending(true);
    setError(null);

    try {
      await club.deletePost(editing);
      setItems(await club.managePosts());
      open(null);
      setNotice('Публикация удалена.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminShell>
      <h1 className="mb-2 text-[1.75rem]">Лента клуба</h1>
      <p className="mb-7 max-w-2xl text-[0.9375rem] text-text-muted">
        Приветствие клуба, акции и объявления. Видны всем на странице клуба в блоке{' '}
        <Link href={`/clubs/${slug}#novosti`} className="text-text-accent underline-offset-2 hover:underline">
          «Новости клуба»
        </Link>{' '}
        и на стартовой у тех, кто ходит в клуб.
      </p>

      {session.status === 'ready' && !allowed && (
        <Alert>Публикует руководство клуба и администраторы.</Alert>
      )}

      {allowed && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Все публикации" description="Приветствие закреплено первым, дальше — черновики." />
            <CardBody>
              <Button type="button" variant="secondary" size="sm" className="mb-4" onClick={() => open(null)}>
                + Новая публикация
              </Button>

              {items === null && <p className="text-[0.9375rem] text-text-muted">Загружаю…</p>}
              {items?.length === 0 && <p className="text-[0.9375rem] text-text-muted">Публикаций пока нет.</p>}

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
                      <span className="mb-1 block text-[0.75rem] text-text-subtle">
                        {item.welcome
                          ? `закреплено${item.publishedAt ? '' : ' · скрыто'}${item.autoBody ? ' · из данных клуба' : ''}`
                          : `${item.publishedAt ? newsDate(item.publishedAt) : 'черновик'} · ${item.author}`}
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
              title={welcome ? 'Приветствие клуба' : editing ? 'Правка публикации' : 'Новая публикация'}
              description={
                welcome
                  ? 'Закреплено первым в «Новостях клуба» — его первым читает новичок. Сообщением не рассылается, удалить нельзя — только скрыть.'
                  : 'Жирный, курсив, подчёркивание и списки — кнопками над текстом. В сообщение клиентам уходят заголовок и первый абзац.'
              }
            />
            <CardBody>
              {error && <Alert>{error}</Alert>}
              {notice && <Alert tone="info">{notice}</Alert>}

              <form onSubmit={save}>
                {welcome && (
                  <Toggle
                    label="Собирать из данных клуба"
                    hint={
                      auto
                        ? 'Залы, адреса, часы работы, цены и контакты берутся из настроек и обновляются сами. Выключите, чтобы написать своё.'
                        : 'Сейчас — ваш текст. Включите, чтобы вернуть собранный из данных клуба.'
                    }
                    checked={auto}
                    onChange={(event) => void setAuto(event.target.checked)}
                  />
                )}

                {!auto && (
                  <>
                    <Field
                      label="Заголовок"
                      value={draft.title}
                      maxLength={160}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                      required
                    />
                    <MarkupEditor
                      label="Текст"
                      value={draft.body}
                      onChange={(body) => setDraft({ ...draft, body })}
                      rows={welcome ? 16 : 10}
                      maxLength={20000}
                      required
                    />
                  </>
                )}
                <Toggle
                  label="Опубликовать"
                  hint={
                    welcome
                      ? 'Без галочки — приветствие скрыто со страницы клуба.'
                      : current?.publishedAt
                        ? 'Без галочки — снять со страницы клуба в черновики.'
                        : 'При первой публикации клиенты клуба получат сообщение. Без галочки — черновик.'
                  }
                  checked={draft.published}
                  onChange={(event) => setDraft({ ...draft, published: event.target.checked })}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" pending={pending}>
                    Сохранить
                  </Button>
                  {welcome && !auto && (
                    <Button type="button" variant="ghost" onClick={() => void setAuto(true)}>
                      Вернуть исходный текст
                    </Button>
                  )}
                  {editing && !welcome && !confirmDelete && (
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

              {draft.body.trim() && (
                <div className="mt-6 border-t border-border pt-5">
                  <p className="mb-2 text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">Как увидят</p>
                  <h2 className="mb-3 text-[1.25rem]">{draft.title || 'Без заголовка'}</h2>
                  <NewsBody body={draft.body} />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}
