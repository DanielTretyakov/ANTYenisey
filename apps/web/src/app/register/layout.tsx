import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Подпись вкладки: страница клиентская, и задать её сама не может. */
export const metadata: Metadata = { title: 'Регистрация' };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
