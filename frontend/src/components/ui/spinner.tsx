import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Only inside buttons and small inline spots; areas that load use <Skeleton>. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <LoaderCircle
      className={cn('size-4 animate-spin motion-reduce:animate-none', className)}
      strokeWidth={1.75}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}
