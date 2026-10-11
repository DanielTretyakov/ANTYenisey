const LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Слова, без которых код клуба короче и не теряет смысла: «КНТ «Столбы»» → «stolby». */
const NOISE = new Set(['кнт', 'ант', 'клуб', 'академия', 'настольного', 'тенниса', 'нт']);

/**
 * Код клуба по названию — подсказка в форме заведения (11.10.2026): «КНТ
 * «Столбы»» → «stolby». Правило формы то же, что у CHECK `Tenant_slug_format`;
 * владелец платформы может поправить подсказку руками.
 */
export function suggestSlug(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[«»"'“”]/g, ' ')
    .split(/[^a-zа-яё0-9]+/)
    .filter(Boolean);
  const meaningful = words.filter((word) => !NOISE.has(word));

  return (meaningful.length > 0 ? meaningful : words)
    .map((word) => [...word].map((char) => LATIN[char] ?? char).join(''))
    .join('-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
}
