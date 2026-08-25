'use client';

import { useState, type ChangeEvent } from 'react';
import { inputClassName } from '@/components/ui/Field';
import { cn } from '@/lib/cn';

/**
 * Поле телефона с несъёмным «+7».
 *
 * Префикс нарисован рядом с полем, а не лежит внутри его значения: если бы он
 * был частью текста, его можно было бы стереть клавишей Backspace, и человек
 * получил бы «+7» без семёрки или номер вообще без кода. Здесь стирать нечего
 * — человек вводит только десять цифр.
 *
 * Цифры показываются сгруппированными — 999 123-45-67, — но наружу отдаётся
 * чистый E.164 (+79991234567): именно в этом виде номер уходит в API и
 * попадает в базу, и именно его ждёт валидация на сервере.
 */
export function PhoneField({ name = 'phone' }: { name?: string }) {
  const [digits, setDigits] = useState('');

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    // Всё, кроме цифр, отбрасываем: так вставка номера из буфера в любом
    // виде — «+7 (999) 123-45-67», «8-999-123-45-67» — превращается в цифры.
    const onlyDigits = event.target.value.replace(/\D/g, '');

    // Номер, вставленный целиком, начинается с 7 или 8 — это код страны, а не
    // первая цифра номера. Отрезаем, иначе последняя цифра не поместится.
    const withoutCountryCode =
      onlyDigits.length > 10 && /^[78]/.test(onlyDigits) ? onlyDigits.slice(1) : onlyDigits;

    setDigits(withoutCountryCode.slice(0, 10));
  }

  return (
    <div className="mb-4">
      <label
        htmlFor="phone-input"
        className="mb-1.5 block text-[0.8125rem] font-medium text-text-muted"
      >
        Телефон
      </label>

      <div className="flex items-stretch">
        <span
          className="inline-flex items-center rounded-l-control border border-r-0 border-border bg-surface-sunken px-3.5 font-medium text-text-muted"
          aria-hidden="true"
        >
          +7
        </span>
        <input
          id="phone-input"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="999 123-45-67"
          value={formatForDisplay(digits)}
          onChange={handleChange}
          className={cn(inputClassName, 'rounded-l-none')}
          // Значение для формы отдаёт скрытое поле: в видимом лежит текст с
          // пробелами и дефисами, а серверу нужен строгий E.164.
          aria-describedby={`${name}-hint`}
          required
        />
      </div>

      <input type="hidden" name={name} value={digits.length === 10 ? `+7${digits}` : ''} />

      <p id={`${name}-hint`} className="mt-1.5 text-[0.8125rem] text-text-subtle">
        Десять цифр без кода страны
      </p>
    </div>
  );
}

/** 9991234567 → «999 123-45-67». Частичный ввод форматируется по мере набора. */
function formatForDisplay(digits: string): string {
  const code = digits.slice(0, 3);
  const block = digits.slice(3, 6);
  const pairOne = digits.slice(6, 8);
  const pairTwo = digits.slice(8, 10);

  let result = code;
  if (block) result += ` ${block}`;
  if (pairOne) result += `-${pairOne}`;
  if (pairTwo) result += `-${pairTwo}`;

  return result;
}
