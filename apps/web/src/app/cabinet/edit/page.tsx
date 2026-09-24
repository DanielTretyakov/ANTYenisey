'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FIRST_SECTION, sectionHref } from '@/components/cabinet/sections';

/** Редактор без раздела — первый раздел, с тем же `?for=`, если он был. */
export default function CabinetEditIndex() {
  const router = useRouter();

  useEffect(() => {
    const forPerson = new URLSearchParams(window.location.search).get('for');
    router.replace(sectionHref(FIRST_SECTION, forPerson));
  }, [router]);

  return null;
}
