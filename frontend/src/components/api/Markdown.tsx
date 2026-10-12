import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';

// Spec descriptions are CommonMark (+ tables). Raw HTML in them is dropped, link
// URLs go through react-markdown's sanitizer (no javascript:), links open apart.
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-link underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]">{children}</code>,
  pre: ({ children }) => (
    <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-auto">
      <table className="text-[13px] [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1">
        {children}
      </table>
    </div>
  ),
  h1: ({ children }) => <p className="font-semibold">{children}</p>,
  h2: ({ children }) => <p className="font-semibold">{children}</p>,
  h3: ({ children }) => <p className="font-semibold">{children}</p>,
  img: () => null,
};

/** Renders a spec description; anything that isn't text (some specs put objects there) renders nothing. */
export function Markdown({ children, className }: { children: unknown; className?: string }) {
  if (typeof children !== 'string' || !children.trim()) return null;
  return (
    <div
      className={cn(
        'space-y-2 text-sm leading-relaxed text-foreground break-token [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
