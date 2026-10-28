'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { ClubField } from '@/components/ClubField';
import { PhoneField } from '@/components/PhoneField';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ConsentCheckbox } from '@/components/ui/ConsentCheckbox';
import { Toggle } from '@/components/ui/Toggle';
import { Field } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { isChildBirthDate } from '@/lib/family';
import { safeNext } from '@/lib/next';
import { saveSession } from '@/lib/session';
import { useSession } from '@/lib/useSession';
import { GenderField, genderFrom } from '@/components/ui/GenderField';

/**
 * Регистрация.
 *
 * Аккаунт заводится НА ПЛАТФОРМЕ, а не в клубе: почта уникальна по всей
 * платформе, и вступать куда-либо, чтобы пользоваться учёткой, не нужно.
 * Поэтому клуб здесь не спрашивается и по умолчанию не подставляется.
 *
 * Исключение — приход со страницы клуба: тогда его код лежит в адресе
 * (`?club=yenisey`), показывается человеку и уходит в запрос, и человек сразу
 * становится клиентом этого клуба. Без кода привязка появится сама, первой же
 * записью.
 */
/**
 * Обёртка с Suspense.
 *
 * Форма читает код клуба из строки запроса через useSearchParams, а он на
 * сервере неизвестен: Next требует границу Suspense, иначе сборка падает на
 * пререндере. Запасной вид — та же разметка без формы, чтобы полоса шапки и
 * разворот входа не мигали.
 */
export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterForm clubSlug={null} next={null} />}>
      <RegisterFormFromQuery />
    </Suspense>
  );
}

function RegisterFormFromQuery() {
  const params = useSearchParams();

  return <RegisterForm clubSlug={params.get('club')} next={safeNext(params.get('next'))} />;
}

/** Черновик анкеты без пароля: «Назад/Вперёд» посреди регистрации его не стирают. */
const DRAFT_KEY = 'knt.register.draft';
const DRAFT_FIELDS = ['lastName', 'firstName', 'middleName', 'phone', 'birthDate', 'email', 'gender'] as const;
type Draft = Partial<Record<(typeof DRAFT_FIELDS)[number], string>>;

function readDraft(): Draft {
  try {
    return JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Draft;
  } catch {
    return {};
  }
}

function saveDraft(form: HTMLFormElement): void {
  const data = new FormData(form);
  const draft: Draft = {};
  for (const field of DRAFT_FIELDS) {
    const value = data.get(field);
    if (typeof value === 'string' && value !== '') draft[field] = value;
  }
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Хранилище закрыто — черновик просто не переживёт уход со страницы.
  }
}

function dropDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Нечего убирать.
  }
}

/** Сервер перечисляет ошибки полей через «; » — человеку удобнее списком. */
function errorLines(message: string): string[] {
  return message.split(/;\s+/).filter(Boolean);
}

function RegisterForm({ clubSlug, next }: { clubSlug: string | null; next: string | null }) {
  const router = useRouter();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  // Занятая почта — отвечаем ссылками на вход и восстановление пароля.
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const [birthDate, setBirthDate] = useState('');
  const [consent, setConsent] = useState(false);
  // Новости КНТ на почту — отдельная неотмеченная галочка (12.10.2026, 38-ФЗ).
  const [newsConsent, setNewsConsent] = useState(false);
  // Черновик читается после монтирования (на сервере хранилища нет) и
  // пересоздаёт форму с ним: поля формы неуправляемые.
  const [draft, setDraft] = useState<Draft>({});
  const [formKey, setFormKey] = useState(0);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const saved = readDraft();
    if (Object.keys(saved).length === 0) return;
    setDraft(saved);
    if (saved.birthDate) setBirthDate(saved.birthDate);
    setFormKey((key) => key + 1);
  }, []);

  // Уже вошедшему анкета ни к чему — туда, куда он и шёл («Назад» из окна
  // мероприятия приводил вошедшего к пустой форме регистрации).
  useEffect(() => {
    if (session.status === 'ready' && !submitting.current) {
      router.replace(next ?? (clubSlug ? `/clubs/${clubSlug}` : '/'));
    }
  }, [session.status, next, clubSlug, router]);

  // Ошибка — над формой, а кнопка — внизу: без прокрутки нажатие выглядело
  // так, будто ничего не произошло.
  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  // Младше 14 регистрироваться можно — учётка ребёнку нужна, чтобы видеть свои
  // записи, — но записывать его будет родитель. Сказать это надо до отправки,
  // а не на первой же кнопке «Записаться». Дата из будущего — не ребёнок, а
  // ошибка ввода: её остановит само поле.
  const child = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && birthDate <= today && isChildBirthDate(birthDate);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Двойное нажатие уходило вторым запросом — с ответом «почта занята».
    if (submitting.current) return;
    setError(null);
    setConflict(false);

    const form = new FormData(event.currentTarget);
    const phone = String(form.get('phone'));

    // Скрытое поле телефона пустеет, пока не набраны все десять цифр —
    // проверяем до отправки, чтобы человек не ждал ответа сервера ради
    // ошибки, которая видна сразу.
    if (!phone) {
      setError('Введите номер телефона полностью — десять цифр');
      return;
    }

    const gender = genderFrom(form);

    if (!gender) {
      setError('Укажите пол');
      return;
    }

    if (!consent) {
      setError('Без согласия на обработку персональных данных зарегистрироваться нельзя');
      return;
    }

    submitting.current = true;
    setPending(true);

    try {
      const auth = await api.register({
        ...(clubSlug ? { tenantSlug: clubSlug } : {}),
        email: String(form.get('email')),
        password: String(form.get('password')),
        lastName: String(form.get('lastName')),
        firstName: String(form.get('firstName')),
        middleName: String(form.get('middleName')),
        phone,
        birthDate: String(form.get('birthDate')),
        gender,
        consent: true,
        newsConsent,
      });

      dropDraft();
      saveSession(auth);
      router.push(next ?? (clubSlug ? `/clubs/${clubSlug}` : '/'));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
      setConflict(cause instanceof ApiError && cause.status === 409);
      submitting.current = false;
      setPending(false);
    }
  }

  const loginLink = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <AuthLayout
      title="Регистрация"
      subtitle="Одна анкета — и запись на тренировки, столы и турниры открыта."
      footer={
        <>
          Уже есть аккаунт?{' '}
          <Link href={loginLink} className="font-medium text-text-accent hover:underline">
            Войти
          </Link>
        </>
      }
    >
      {error && (
        <div ref={errorRef} tabIndex={-1} className="scroll-mt-28 outline-none">
          <Alert>
            {errorLines(error).length > 1 ? (
              <ul className="grid list-disc gap-0.5 pl-4">
                {errorLines(error).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              error
            )}
            {conflict && (
              <span className="mt-1.5 block">
                Если аккаунт с этой почтой уже есть —{' '}
                <Link href={loginLink} className="font-medium underline underline-offset-2">
                  войдите
                </Link>{' '}
                или{' '}
                <Link href="/forgot-password" className="font-medium underline underline-offset-2">
                  восстановите пароль
                </Link>
                .
              </span>
            )}
          </Alert>
        </div>
      )}

      <form key={formKey} onSubmit={handleSubmit} onInput={(event) => saveDraft(event.currentTarget)}>
        {clubSlug && <ClubField slug={clubSlug} />}

        <Field
          label="Фамилия"
          name="lastName"
          autoComplete="family-name"
          maxLength={100}
          defaultValue={draft.lastName}
          required
        />
        <Field
          label="Имя"
          name="firstName"
          autoComplete="given-name"
          maxLength={100}
          defaultValue={draft.firstName}
          required
        />
        <Field
          label="Отчество"
          name="middleName"
          autoComplete="additional-name"
          maxLength={100}
          defaultValue={draft.middleName}
          required
        />

        <GenderField defaultValue={draft.gender === 'MALE' || draft.gender === 'FEMALE' ? draft.gender : null} />

        <PhoneField
          initial={draft.phone ?? ''}
          hint="Десять цифр без кода страны. По нему клуб позвонит, если занятие перенесут."
        />

        <Field
          label="Дата рождения"
          name="birthDate"
          type="date"
          autoComplete="bday"
          hint="Нужна для детских групп и возрастных турниров."
          required
          min="1900-01-01"
          max={today}
          value={birthDate}
          onChange={(event) => setBirthDate(event.target.value)}
        />

        {child && (
          <Alert tone="info">
            До 14 лет на занятия и турниры записывает родитель. Зарегистрироваться можно, а потом
            попросите родителя привязать ваш аккаунт у себя в кабинете или обратитесь к администратору клуба.
          </Alert>
        )}

        <Field
          label="Электронная почта"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          defaultValue={draft.email}
          required
        />

        <Field
          label="Пароль"
          name="password"
          type="password"
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          hint="Не короче 8 символов"
          required
        />

        <ConsentCheckbox checked={consent} onChange={setConsent} />

        <Toggle
          label="Присылать новости КНТ на почту"
          hint="Новые возможности и клубы — не чаще пары писем в месяц. Отписаться можно в каждом письме."
          checked={newsConsent}
          onChange={(event) => setNewsConsent(event.target.checked)}
        />

        <Button type="submit" pending={pending} disabled={!consent} fullWidth size="lg" className="mt-2">
          {pending ? 'Отправляем…' : 'Зарегистрироваться'}
        </Button>
        {!consent && (
          <p className="mt-2 text-center text-[0.8125rem] text-text-subtle">
            Кнопка заработает, когда вы отметите согласие на обработку данных выше.
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
