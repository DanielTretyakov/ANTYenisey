import type { Gender } from '@yenisey/types';
import { cn } from '@/lib/cn';

export const GENDER_LABEL: Record<Gender, string> = { MALE: 'Мужской', FEMALE: 'Женский' };

/**
 * Пол — две кнопки-переключателя на обычных радиокнопках: формы регистрации,
 * личных данных и учётки ребёнка читают поля из `FormData`, и значение
 * приходит под именем `gender` без своего состояния.
 *
 * Зачем спрашиваем — сказано рядом: без этого вопрос о поле в форме
 * записи на тренировку выглядел бы лишним.
 */
export function GenderField({
  defaultValue = null,
  label = 'Пол',
  hint = 'По нему рисуем картинку профиля, пока нет фотографии.',
}: {
  defaultValue?: Gender | null;
  label?: string;
  hint?: string;
}) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-1.5 block text-[0.8125rem] font-medium text-text-muted">{label}</legend>
      <div className="inline-flex rounded-control border border-border bg-surface-raised p-1">
        {(['MALE', 'FEMALE'] as const).map((value) => (
          <label key={value} className="cursor-pointer">
            <input
              type="radio"
              name="gender"
              value={value}
              defaultChecked={defaultValue === value}
              required
              className="peer sr-only"
            />
            <span
              className={cn(
                'block rounded-[0.375rem] px-4 py-1.5 text-[0.9375rem] text-text-muted transition-colors',
                'peer-checked:bg-surface-accent-soft peer-checked:text-text-accent',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]',
              )}
            >
              {GENDER_LABEL[value]}
            </span>
          </label>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-[0.8125rem] text-text-subtle">{hint}</p>}
    </fieldset>
  );
}

/** Значение из формы — или null, если человек не выбрал (браузер не пустит, но всё же). */
export function genderFrom(form: FormData): Gender | null {
  const value = form.get('gender');

  return value === 'MALE' || value === 'FEMALE' ? value : null;
}
