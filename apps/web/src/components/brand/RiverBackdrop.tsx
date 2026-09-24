/**
 * Фон фирменных плоскостей: русло реки между горами.
 *
 * Чистая геометрия вместо фотографии — в брендбуке требование «ничего
 * вылизанного», а стоковый снимок зала в подложке читается ровно наоборот.
 *
 * Два рисунка, а не один растянутый: у разворота входа плоскость высокая, у
 * баннера стартовой — широкая, и вертикальная река, растянутая вширь,
 * превращается в пятно. Рисуется белым с малой непрозрачностью, поэтому
 * кладётся на любой тёмный фон — изумруд платформы или цвет клуба.
 */
export function RiverBackdrop({ orientation = 'portrait' }: { orientation?: 'portrait' | 'landscape' }) {
  if (orientation === 'landscape') {
    return (
      <svg
        viewBox="0 0 1200 400"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <path
          d="M-60 330 C220 250 360 360 560 250 C760 140 900 230 1260 60"
          fill="none"
          stroke="white"
          strokeOpacity="0.07"
          strokeWidth="110"
          strokeLinecap="round"
        />
        <path
          d="M-60 330 C220 250 360 360 560 250 C760 140 900 230 1260 60"
          fill="none"
          stroke="white"
          strokeOpacity="0.1"
          strokeWidth="2"
        />
        <path
          d="M560 420 L680 280 L740 340 L840 210 L920 300 L1020 170 L1260 360"
          fill="none"
          stroke="white"
          strokeOpacity="0.08"
          strokeWidth="2"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 400 800"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <path
        d="M-40 820 C120 640 60 520 180 380 C280 260 240 140 330 -20"
        fill="none"
        stroke="white"
        strokeOpacity="0.07"
        strokeWidth="120"
        strokeLinecap="round"
      />
      <path
        d="M-40 820 C120 640 60 520 180 380 C280 260 240 140 330 -20"
        fill="none"
        stroke="white"
        strokeOpacity="0.1"
        strokeWidth="2"
      />
      <path
        d="M-40 700 L60 560 L110 620 L190 480 L250 570 L330 430 L440 560"
        fill="none"
        stroke="white"
        strokeOpacity="0.08"
        strokeWidth="2"
      />
    </svg>
  );
}
