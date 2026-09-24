'use client';

import type { ReactNode } from 'react';
import { CabinetEditShell } from '@/components/cabinet/CabinetEdit';

export default function CabinetEditLayout({ children }: { children: ReactNode }) {
  return <CabinetEditShell>{children}</CabinetEditShell>;
}
