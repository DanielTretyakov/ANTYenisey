import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-card border border-border bg-surface-raised shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="border-b border-border px-6 py-5">
      <h2 className="text-lg">{title}</h2>
      {description && <p className="mt-1 text-[0.875rem] text-text-muted">{description}</p>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-6 py-5', className)}>{children}</div>;
}
