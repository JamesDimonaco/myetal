/**
 * Tiny class-merger used by the shadcn-ui primitives in
 * `src/components/ui/`. `clsx` resolves conditional class lists; `tw-merge`
 * dedupes conflicting Tailwind utilities so a component's variant can override
 * a base class (e.g. `cn('px-4', isWide && 'px-6')` → `px-6`).
 *
 * Lives in `lib/` because component primitives import from this path by
 * convention — keeping the helper next to it would create a circular feel.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
