'use client';

import type { FamilyChild } from '@yenisey/types';
import { Tab } from '@/components/ui/Tab';
import { cn } from '@/lib/cn';

/**
 * «Я / Коля / Петя» — за кого родитель записывает, отменяет и смотрит.
 *
 * Показывается, только когда есть кого выбирать: у человека без детей лишний
 * переключатель из одного пункта был бы шумом.
 */
export function PersonSwitch({
  people,
  selected,
  onChoose,
  className,
}: {
  /** Дети, за которых можно действовать. */
  people: FamilyChild[];
  selected: FamilyChild | null;
  onChoose: (id: string | null) => void;
  className?: string;
}) {
  if (people.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="mr-1 text-[0.8125rem] text-text-muted">Действую за:</span>
      <Tab active={selected === null} onClick={() => onChoose(null)}>
        себя
      </Tab>
      {people.map((child) => (
        <Tab key={child.id} active={selected?.id === child.id} onClick={() => onChoose(child.id)}>
          {firstName(child.fullName)}
        </Tab>
      ))}
    </div>
  );
}

/** «Родителев Коля Олегович» → «Коля»: в переключателе фамилия у всех одна. */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[1] ?? fullName;
}
