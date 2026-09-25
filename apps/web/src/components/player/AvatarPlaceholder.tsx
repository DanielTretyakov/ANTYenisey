import type { Gender } from '@yenisey/types';

/**
 * Рисованная заглушка вместо фотографии (решение владельца от 25.09.2026):
 * мужчина или женщина по полу человека, а без пола — нейтральный силуэт.
 * Серый кружок с инициалами читался как «что-то не загрузилось».
 *
 * Краски — из темы: фон и футболка берут акцент клуба, поэтому на странице
 * клуба заглушка в его цветах. Кожа и волосы — постоянные: от темы они не
 * зависят, как не зависит лицо на фотографии.
 */
export function AvatarPlaceholder({ gender }: { gender: Gender | null }) {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <rect width="120" height="120" fill="color-mix(in oklab, var(--accent) 14%, var(--surface-raised))" />
      {gender === null ? <Silhouette /> : <Person gender={gender} />}
    </svg>
  );
}

const SKIN = '#eec1a0';
const SKIN_SHADE = '#dfa987';
const HAIR = '#3b2b24';

function Person({ gender }: { gender: Gender }) {
  const female = gender === 'FEMALE';

  return (
    <>
      {/* Длинные волосы — позади головы и плеч. */}
      {female && (
        <path
          d="M36 62 C33 36 46 28 60 28 C75 28 87 36 84 62 L88 96 C80 101 71 99 66 94 L54 94 C49 99 40 101 32 96 Z"
          fill={HAIR}
        />
      )}

      {/* Плечи в спортивной футболке цвета клуба. */}
      <path d="M16 120 C16 99 34 88 60 88 C86 88 104 99 104 120 Z" fill="var(--accent)" />
      <path d="M44 90 C49 99 71 99 76 90" fill="none" stroke="color-mix(in oklab, var(--accent) 60%, #000)" strokeWidth="3" />

      {/* Шея и голова. */}
      <path d="M51 74 H69 V90 C63 95 57 95 51 90 Z" fill={SKIN_SHADE} />
      <circle cx="39.5" cy="60" r="4.5" fill={SKIN_SHADE} />
      <circle cx="80.5" cy="60" r="4.5" fill={SKIN_SHADE} />
      <ellipse cx="60" cy="58" rx="20" ry="23" fill={SKIN} />

      {/* Причёска спереди. */}
      {female ? (
        <path d="M40 57 C40 40 50 33 61 33 C72 33 81 41 80 56 C73 47 63 44 53 48 C47 50 43 53 40 57 Z" fill={HAIR} />
      ) : (
        <path d="M39 56 C37 38 48 31 60 31 C73 31 83 38 81 55 C78 47 71 42 60 42 C49 42 43 47 39 56 Z" fill={HAIR} />
      )}

      {/* Лицо — две точки и улыбка: этого хватает, чтобы кружок стал человеком. */}
      <circle cx="52.5" cy="61" r="2" fill={HAIR} />
      <circle cx="67.5" cy="61" r="2" fill={HAIR} />
      <path d="M53.5 69.5 Q60 75 66.5 69.5" fill="none" stroke={HAIR} strokeWidth="2.2" strokeLinecap="round" />
    </>
  );
}

/** Пол не указан — силуэт без лица, в приглушённом цвете. */
function Silhouette() {
  const paint = 'color-mix(in oklab, var(--accent) 38%, var(--surface-raised))';

  return (
    <>
      <path d="M16 120 C16 99 34 88 60 88 C86 88 104 99 104 120 Z" fill={paint} />
      <circle cx="60" cy="56" r="22" fill={paint} />
    </>
  );
}
