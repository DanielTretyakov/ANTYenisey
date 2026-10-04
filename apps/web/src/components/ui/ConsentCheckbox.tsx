'use client';

import Link from 'next/link';
import { useId } from 'react';
import { legalHref } from '@/content/legal';

/**
 * Галочка согласия на обработку персональных данных (152-ФЗ, решение
 * владельца от 03.10.2026): без неё кнопка формы не активна, а сервер учётку
 * не заводит (`consent` в `AccountDto`).
 *
 * Ссылки на документы открываются в новой вкладке: иначе человек, решивший
 * прочитать политику, потерял бы заполненную анкету.
 *
 * Кто соглашается: `self` — человек о себе (регистрация); `parent` — родитель
 * за ребёнка в своём кабинете; `desk` — у стойки форму заполняет
 * администратор, а согласие даёт родитель, который стоит рядом;
 * `application` — заявка клуба: учётки нет, соглашение принимать не с чем.
 */
export function ConsentCheckbox({
  checked,
  onChange,
  by = 'self',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  by?: 'self' | 'parent' | 'desk' | 'application';
}) {
  const id = useId();

  return (
    <div className="mb-4">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          required
          className="mt-0.5 h-4.5 w-4.5 shrink-0 cursor-pointer rounded-sm border border-border-strong accent-accent"
        />
        {by === 'application' ? (
          <span className="text-[0.875rem] text-text">
            Даю <DocLink href={legalHref('consent')}>согласие на обработку персональных данных</DocLink>, чтобы со мной
            связались по заявке, в соответствии с <DocLink href={legalHref('privacy')}>политикой</DocLink>.
          </span>
        ) : (
        <span className="text-[0.875rem] text-text">
          {by === 'self' ? 'Даю ' : by === 'parent' ? 'Как родитель, даю ' : 'Родитель даёт '}
          <DocLink href={legalHref('consent')}>согласие на обработку персональных данных</DocLink>
          {by === 'self' ? '' : ' ребёнка'} в соответствии с <DocLink href={legalHref('privacy')}>политикой</DocLink> и{' '}
          {by === 'desk' ? 'принимает' : 'принимаю'}{' '}
          <DocLink href={legalHref('terms')}>пользовательское соглашение</DocLink>.
        </span>
        )}
      </label>
    </div>
  );
}

function DocLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} target="_blank" rel="noopener" className="text-text-accent underline underline-offset-2">
      {children}
    </Link>
  );
}
