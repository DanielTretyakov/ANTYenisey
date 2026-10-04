import type { Metadata } from 'next';
import Link from 'next/link';
import { PLATFORM_GRACE_DAYS, PLATFORM_TRIAL_DAYS } from '@yenisey/types';
import { RiverBackdrop } from '@/components/brand/RiverBackdrop';
import { AppShell } from '@/components/layout/AppShell';
import { OPERATOR } from '@/lib/operator';
import { ApplicationForm, PlanCards } from './ForClubsParts';

export const metadata: Metadata = {
  title: 'Подключить свой клуб',
  description: 'КНТ для клубов настольного тенниса: онлайн-запись, расписание залов, смены, абонементы и уведомления.',
};

/** Якорь формы заявки — на него ведут «Связаться с нами» из подвала и кнопка обложки. */
const CONTACT_ANCHOR = 'svyaz';
const PLANS_ANCHOR = 'tarify';

/** Что получает клуб — по делам, а не по экранам. */
const FEATURES: { title: string; text: string }[] = [
  {
    title: 'Онлайн-запись и бронь столов',
    text: 'Клиент сам выбирает стол в сетке зала и записывается на тренировку или турнир. Цену считает сервер — без ошибок в кассе.',
  },
  {
    title: 'Расписание залов',
    text: 'Шаблон недели и правка отдельного дня: занятия, турниры, аренда и закрытые столы — кистью по сетке.',
  },
  {
    title: 'Смена администратора',
    text: 'Кто пришёл, кто не пришёл и деньги дня — с телефона у стойки. Смены назначает управляющий.',
  },
  {
    title: 'Абонементы',
    text: 'Продажа у стойки, визиты списываются при записи и возвращаются при отмене — сами, без тетрадки.',
  },
  {
    title: 'Уведомления в MAX и браузере',
    text: 'Клиенту — подтверждение и напоминание, тренеру — состав группы, руководству — сводка в 9 утра.',
  },
  {
    title: 'Страница клуба',
    text: 'Залы с адресами, часами и ценами, тренеры, новости, рейтинг посещений. Клуб находят в поиске по городу.',
  },
  {
    title: 'Семьи и дети',
    text: 'Родители записывают детей до 14 лет и видят их расписание. Профили детей закрыты от посторонних.',
  },
  {
    title: 'Залы в разных городах',
    text: 'У каждого зала свои цены, шаг брони, часы работы и часовой пояс. Подписка — одна на клуб.',
  },
];

/** Один продукт — три взгляда на него. */
const ROLES: { who: string; points: string[] }[] = [
  {
    who: 'Игроку',
    points: ['Один аккаунт на все клубы', 'Запись и отмена в два касания', 'Напоминание за три часа до начала'],
  },
  {
    who: 'Администратору',
    points: ['Смена и отметки с телефона', 'Расписание залов в одном месте', 'Новичок регистрируется сам по QR у стойки'],
  },
  {
    who: 'Руководителю',
    points: ['Деньги дня и сводка каждое утро', 'Роли и смены сотрудников', 'Настройки вступают в силу в полночь'],
  },
];

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Заявка',
    text: 'Оставьте заявку формой ниже. Мы свяжемся, расскажем о платформе и покажем её на примере вашего клуба.',
  },
  {
    title: 'Настраиваем вместе',
    text: 'Заводим клуб, залы, столы и цены, переносим расписание, приглашаем сотрудников и тренеров.',
  },
  {
    title: 'Запуск',
    text: `Клиенты регистрируются по QR у стойки и записываются сами. Первые ${PLATFORM_TRIAL_DAYS} дней — бесплатно, дальше — тариф на выбор.`,
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Сколько залов можно подключить?',
    a: 'Сколько есть. У каждого зала свои цены, шаг брони, часы работы и часовой пояс, а подписка — одна на весь клуб.',
  },
  {
    q: 'Клиентам нужно ставить приложение?',
    a: 'Нет, всё работает в браузере телефона и компьютера. Аккаунт у человека один на все клубы платформы.',
  },
  {
    q: 'Как клиенты попадут в наш клуб?',
    a: 'Новичок регистрируется сам по QR-коду у стойки — и сразу становится клиентом клуба. Уже зарегистрированного администратор находит по почте или телефону и привязывает.',
  },
  {
    q: 'Можно платить по счёту?',
    a: 'Да. Юрлицу — счёт и акты раз в месяц; можно и картой с автопродлением.',
  },
  {
    q: 'Что будет, если не оплатить вовремя?',
    a: `Ещё ${PLATFORM_GRACE_DAYS} дня клуб работает как обычно. Потом запись в клуб приостанавливается, а будущие записи отменяются с полным возвратом клиентам. Оплата возвращает доступ сразу.`,
  },
  {
    q: 'Клиенты могут платить онлайн?',
    a: 'Пока нет: клиенты платят в клубе, абонементы продаёт администратор. Онлайн-оплата — в планах.',
  },
];

/**
 * «Подключить свой клуб» (решение владельца от 03.10.2026): что получает
 * клуб, как подключиться, тарифы, частые вопросы и две дороги связи — почта
 * и форма заявки. Тарифы — те же строки, что считает подписка клуба
 * (`GET /platform/plans`), а не второй прайс «для витрины».
 */
export default function ForClubsPage() {
  return (
    <AppShell>
      <section
        className="relative -mt-2 overflow-hidden rounded-[1.375rem] px-6 pt-12 pb-9 text-white sm:px-11 sm:pt-14"
        style={{ background: 'color-mix(in oklab, var(--brand-600) 50%, var(--ink-950))' }}
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <RiverBackdrop orientation="landscape" />
          <span
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(900px 320px at 85% -10%, color-mix(in oklab, var(--brand-400) 45%, transparent), transparent 65%)',
            }}
          />
        </div>

        <div className="relative z-10">
          <p className="text-[0.75rem] font-semibold tracking-[0.12em] text-white/75 uppercase">КНТ для клубов</p>
          <h1 className="mt-4 max-w-4xl font-display text-[2rem] leading-[1.02] text-white [text-wrap:balance] sm:text-[3.25rem]">
            Запись, расписание и смены вашего клуба — в одном месте
          </h1>
          <p className="mt-4 max-w-2xl text-[1rem] leading-snug text-white/90 sm:text-[1.0625rem]">
            Клиенты записываются сами, администратор ведёт смену с телефона, руководитель видит деньги дня и получает
            сводку по утрам.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {[`${PLATFORM_TRIAL_DAYS} дней бесплатно`, 'картой или по счёту', 'работает в браузере'].map((item) => (
              <span key={item} className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-[0.8125rem] font-medium">
                {item}
              </span>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={`#${CONTACT_ANCHOR}`}
              className="inline-flex h-12 items-center rounded-control bg-white px-5 text-[0.9375rem] font-medium text-ink-950 transition-colors hover:bg-white/90"
            >
              Оставить заявку
            </a>
            <a
              href={`#${PLANS_ANCHOR}`}
              className="inline-flex h-12 items-center rounded-control border border-white/40 px-5 text-[0.9375rem] font-medium text-white transition-colors hover:bg-white/10"
            >
              Тарифы
            </a>
          </div>
        </div>
      </section>

      <section className="mt-16" aria-labelledby="chto-poluchaet">
        <h2 id="chto-poluchaet" className="font-display text-[1.5rem] sm:text-[1.875rem]">
          Что получает клуб
        </h2>
        <p className="mt-2 max-w-2xl text-[0.9375rem] text-text-muted">
          Всё, что сейчас живёт в тетради, таблице и чате администраторов, — в одной системе.
        </p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="rounded-card border border-border bg-surface-raised px-5 py-5">
              <h3 className="text-[1rem] font-semibold">{feature.title}</h3>
              <p className="mt-2 text-[0.875rem] text-text-muted">{feature.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16" aria-labelledby="kazhdomu">
        <h2 id="kazhdomu" className="font-display text-[1.5rem] sm:text-[1.875rem]">
          Каждому — своё
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {ROLES.map((role) => (
            <div key={role.who} className="rounded-card border border-border-accent bg-surface-accent-soft px-5 py-5">
              <h3 className="text-[0.75rem] font-semibold tracking-[0.1em] text-text-accent uppercase">{role.who}</h3>
              <ul className="mt-3 grid gap-2 text-[0.9375rem]">
                {role.points.map((point) => (
                  <li key={point} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ball)]" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16" aria-labelledby="kak-podklyuchit">
        <h2 id="kak-podklyuchit" className="font-display text-[1.5rem] sm:text-[1.875rem]">
          Как подключиться
        </h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-card border border-border bg-surface-raised px-5 py-5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-accent font-display text-[1rem] text-accent-text">
                {index + 1}
              </span>
              <h3 className="mt-3 text-[1rem] font-semibold">{step.title}</h3>
              <p className="mt-2 text-[0.875rem] text-text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id={PLANS_ANCHOR} className="mt-16 scroll-mt-28" aria-labelledby="tarify-title">
        <h2 id="tarify-title" className="font-display text-[1.5rem] sm:text-[1.875rem]">
          Тарифы
        </h2>
        <p className="mt-2 max-w-2xl text-[0.9375rem] text-text-muted">
          Подписка — на клуб целиком, сколько бы в нём ни было залов, столов и сотрудников. Первые {PLATFORM_TRIAL_DAYS}{' '}
          дней — бесплатно. Подробнее — в{' '}
          <Link href="/help/podpiska-knt" className="text-text-accent underline underline-offset-2">
            справке о подписке
          </Link>
          .
        </p>
        <PlanCards />
      </section>

      <section className="mt-16" aria-labelledby="voprosy">
        <h2 id="voprosy" className="font-display text-[1.5rem] sm:text-[1.875rem]">
          Частые вопросы
        </h2>
        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          {FAQ.map((item) => (
            <details key={item.q} className="group rounded-card border border-border bg-surface-raised px-5 py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[1rem] font-medium">
                {item.q}
                <span aria-hidden="true" className="mt-0.5 text-text-subtle transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-[0.9375rem] text-text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id={CONTACT_ANCHOR} className="mt-16 scroll-mt-28" aria-labelledby="svyaz-title">
        <h2 id="svyaz-title" className="font-display text-[1.5rem] sm:text-[1.875rem]">
          Связаться с нами
        </h2>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="grid content-start gap-4">
            <div className="rounded-card border border-border bg-surface-raised px-5 py-5">
              <h3 className="text-[1rem] font-semibold">Написать на почту</h3>
              {OPERATOR.email ? (
                <a href={`mailto:${OPERATOR.email}`} className="mt-2 inline-block text-[1rem] text-text-accent underline underline-offset-2">
                  {OPERATOR.email}
                </a>
              ) : (
                <p className="mt-2 text-[0.9375rem] text-text-muted">
                  Почта для клубов появится вместе с новым адресом сайта. Пока — оставьте заявку формой: она приходит
                  нам сразу.
                </p>
              )}
            </div>
            <div className="rounded-card border border-border bg-surface-raised px-5 py-5">
              <h3 className="text-[1rem] font-semibold">Посмотреть, как это выглядит</h3>
              <p className="mt-2 text-[0.9375rem] text-text-muted">
                Страница действующего клуба —{' '}
                <Link href="/clubs/yenisey" className="text-text-accent underline underline-offset-2">
                  АНТ «Енисей»
                </Link>
                . Справка для персонала —{' '}
                <Link href="/help#klubu" className="text-text-accent underline underline-offset-2">
                  в разделе «Клубу»
                </Link>
                .
              </p>
            </div>
          </div>

          <ApplicationForm />
        </div>
      </section>
    </AppShell>
  );
}
