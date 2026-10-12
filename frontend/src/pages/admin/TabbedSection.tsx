import { Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LoadingRegion, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';

export type SectionTab = { id: string; label: string; Component: LazyExoticComponent<ComponentType> };

/** A section made of tabs (Identity, Settings); the open tab is ?tab= in the URL. */
export function TabbedSection({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const current = tabs.find((tab) => tab.id === params.get('tab')) ?? tabs[0];
  if (!current) return null;
  return (
    <Tabs
      value={current.id}
      onValueChange={(id) => {
        const next = new URLSearchParams(params);
        next.set('tab', id);
        setParams(next, { replace: true });
      }}
    >
      <TabsList label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id}>
          {tab.id === current.id && (
            <Suspense
              fallback={
                <LoadingRegion aria-label={t('common.loading')}>
                  <Skeleton className="h-72" />
                </LoadingRegion>
              }
            >
              <tab.Component />
            </Suspense>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
