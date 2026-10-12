import { forwardRef } from 'react';
import { Button, type ButtonProps } from './button';
import { Tooltip } from './tooltip';

type Props = Omit<ButtonProps, 'children' | 'aria-label'> & {
  /** Required: becomes aria-label and the tooltip. */
  label: string;
  icon: React.ReactNode;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, icon, variant = 'ghost', size = 'icon', tooltipSide, ...props },
  ref,
) {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <Button ref={ref} variant={variant} size={size} aria-label={label} {...props}>
        {icon}
      </Button>
    </Tooltip>
  );
});
