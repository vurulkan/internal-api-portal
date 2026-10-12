import { createContext, useContext, useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ShellContextValue = {
  panelTarget: HTMLElement | null;
  registerPanel: (id: string, title: string) => void;
  unregisterPanel: (id: string) => void;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

/**
 * Page content for the section panel (catalog filters, an API's operations, the
 * admin sections). Rendered into the shell's panel, or into the navigation drawer
 * on small screens; the page keeps the state.
 */
export function SectionPanel({ title, children }: { title: string; children: ReactNode }) {
  const shell = useContext(ShellContext);
  const id = useId();
  const register = shell?.registerPanel;
  const unregister = shell?.unregisterPanel;
  useEffect(() => {
    register?.(id, title);
    return () => unregister?.(id);
  }, [id, title, register, unregister]);
  if (!shell?.panelTarget) return null;
  return createPortal(children, shell.panelTarget);
}
