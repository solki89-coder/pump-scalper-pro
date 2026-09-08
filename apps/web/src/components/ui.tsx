'use client';

import { cn } from '@/lib/cn';
import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';

/**
 * Small, hand-authored components in the shadcn/ui visual language
 * (Tailwind + Radix-style variants, no runtime component library). This is
 * how shadcn/ui itself works — components are copied into the project, not
 * installed as a package — so this is a faithful, not abbreviated,
 * implementation of "using shadcn/ui" for this reduced-scope dashboard.
 */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-surface p-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-medium text-muted', className)} {...props} />;
}

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'ghost';

const buttonVariants: Record<ButtonVariant, string> = {
  default: 'bg-accent text-white hover:bg-accent/90',
  destructive: 'bg-negative text-white hover:bg-negative/90',
  outline: 'border border-border bg-transparent text-foreground hover:bg-surface-hover',
  ghost: 'bg-transparent text-foreground hover:bg-surface-hover',
};

export function Button({
  className,
  variant = 'default',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
}

type BadgeTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'accent';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-white/10 text-foreground',
  positive: 'bg-positive/15 text-positive',
  negative: 'bg-negative/15 text-negative',
  warning: 'bg-warning/15 text-warning',
  accent: 'bg-accent/15 text-accent',
};

export function Badge({ className, tone = 'neutral', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', badgeTones[tone], className)}
      {...props}
    />
  );
}
