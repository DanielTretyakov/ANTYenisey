import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>Енисей</h1>
      <p>Академия настольного тенниса. Запись на тренировки, турниры и аренда столов.</p>
      <p className="hint">
        <Link href="/login">Войти</Link> · <Link href="/register">Регистрация</Link>
      </p>
    </main>
  );
}
