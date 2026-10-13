import type { ReactNode } from 'react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  children,
  className,
  align = 'end',
}: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={6}
        data-animate
        className={cn(
          'z-55 min-w-48 rounded-md border border-border bg-card p-1 text-card-foreground shadow-lg',
          className,
        )}
      >
        {children}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}

const itemClasses =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:shrink-0';

export function DropdownMenuItem({
  children,
  onSelect,
  destructive,
  disabled,
  asChild,
}: {
  children: ReactNode;
  onSelect?: (event: Event) => void;
  destructive?: boolean;
  disabled?: boolean;
  asChild?: boolean;
}) {
  return (
    <MenuPrimitive.Item
      onSelect={onSelect}
      disabled={disabled}
      asChild={asChild}
      className={cn(itemClasses, destructive && 'text-destructive')}
    >
      {children}
    </MenuPrimitive.Item>
  );
}

export function DropdownMenuRadioItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <MenuPrimitive.RadioItem value={value} className={cn(itemClasses, 'pl-7')}>
      <MenuPrimitive.ItemIndicator className="absolute left-2">
        <Check aria-hidden="true" strokeWidth={2} />
      </MenuPrimitive.ItemIndicator>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <MenuPrimitive.Label className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
      {children}
    </MenuPrimitive.Label>
  );
}

export function DropdownMenuSeparator() {
  return <MenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />;
}

export const DropdownMenuSub = MenuPrimitive.Sub;

export function DropdownMenuSubTrigger({ children }: { children: ReactNode }) {
  return (
    <MenuPrimitive.SubTrigger className={cn(itemClasses, 'data-[state=open]:bg-muted')}>
      {children}
    </MenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ children }: { children: ReactNode }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent
        sideOffset={4}
        data-animate
        className="z-55 min-w-40 rounded-md border border-border bg-card p-1 text-card-foreground shadow-lg"
      >
        {children}
      </MenuPrimitive.SubContent>
    </MenuPrimitive.Portal>
  );
}
