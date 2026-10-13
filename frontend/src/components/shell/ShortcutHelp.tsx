import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { modKey } from '@/lib/shortcuts';
import { Dialog, Kbd } from '@/components/ui';
import { VersionLine } from './ProjectLink';

type Row = { label: string; keys: ReactNode };

const keys = (...parts: string[]) => (
  <>
    {parts.map((part, i) =>
      part === '+' || part === 'then' || part === 'or' ? (
        <span key={i} className="text-xs">
          {part}
        </span>
      ) : (
        <Kbd key={i}>{part}</Kbd>
      ),
    )}
  </>
);

/** "?": every keyboard shortcut, by where it works. */
export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const sections: { title: string; rows: Row[] }[] = [
    {
      title: t('help.everywhere'),
      rows: [
        { label: t('help.palette'), keys: keys(modKey, 'K') },
        { label: t('help.focusSearch'), keys: keys('/') },
        { label: t('help.showHelp'), keys: keys('?') },
        { label: t('help.goCatalog'), keys: keys('G', 'then', 'C') },
        { label: t('help.goAdmin'), keys: keys('G', 'then', 'A') },
        { label: t('help.closeOverlay'), keys: keys('Esc') },
        { label: t('help.skipToContent'), keys: keys('Tab') },
      ],
    },
    {
      title: t('help.onPages'),
      rows: [
        { label: t('help.tabs'), keys: keys('[', ']') },
        { label: t('help.moveInLists'), keys: keys('J', 'K', '↵') },
        { label: t('help.pages'), keys: keys('N', 'P') },
        { label: t('help.deleteRow'), keys: keys('D') },
        { label: t('help.favorite'), keys: keys('F') },
      ],
    },
    {
      title: t('help.tryIt'),
      rows: [
        { label: t('help.send'), keys: keys(modKey, '↵') },
        { label: t('help.copyCurl'), keys: keys(modKey, '⇧', 'C') },
      ],
    },
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('help.title')}
      description={t('help.description')}
      className="max-w-xl"
    >
      <div className="space-y-4">
        {sections.map((section, index) => (
          <section key={section.title} aria-labelledby={`help-section-${index}`}>
            <h3
              id={`help-section-${index}`}
              className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            >
              {section.title}
            </h3>
            <dl className="mt-1 divide-y divide-border text-sm">
              {section.rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-2">
                  <dt>{row.label}</dt>
                  <dd className="flex shrink-0 items-center gap-1 text-muted-foreground">{row.keys}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">{t('help.layoutNote')}</p>
        <VersionLine className="border-t border-border pt-3" />
      </div>
    </Dialog>
  );
}
