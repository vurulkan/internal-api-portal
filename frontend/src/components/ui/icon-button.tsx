import { forwardRef } from 'react';
import { Button, type ButtonProps } from './button';
import { Tooltip } from './tooltip';

type Props = Omit<ButtonProps, 'children' | 'aria-label'> & {
  /** Required: becomes aria-label and the tooltip. */
  label: string;
  icon: React.ReactNode;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** Shown in the tooltip, e.g. "⌘ K". */
  shortcut?: string;
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, icon, variant = 'ghost', size = 'icon', tooltipSide, shortcut, ...props },
  ref,
) {
  const content = shortcut ? (
    <span className="flex items-center gap-2">
      {label}
      <span className="flex gap-0.5 opacity-80">
        {shortcut.split(' ').map((k) => (
          <kbd key={k} className="rounded border border-current/30 px-1 font-mono text-[10px]">
            {k}
          </kbd>
        ))}
      </span>
    </span>
  ) : (
    label
  );
  return (
    <Tooltip content={content} side={tooltipSide}>
      <Button ref={ref} variant={variant} size={size} aria-label={label} {...props}>
        {icon}
      </Button>
    </Tooltip>
  );
});
