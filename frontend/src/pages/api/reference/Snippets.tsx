import { useTranslation } from 'react-i18next';
import { snippet, SNIPPET_LANGUAGES, type SnippetInput } from '@/lib/openapi';
import { CodeBlock, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';

const NAMES = { curl: 'cURL', fetch: 'fetch', httpie: 'HTTPie', go: 'Go' };

/** The same request as code. Secrets and headers the portal adds are placeholders. */
export function Snippets({ input }: { input: SnippetInput }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="snippets-heading" className="space-y-2">
      <h3 id="snippets-heading" className="text-sm font-semibold">
        {t('api.snippets')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {input.baseUrl ? t('api.snippetsManager') : t('api.snippetsViewer')}
      </p>
      <Tabs defaultValue="curl">
        <TabsList label={t('api.snippets')}>
          {SNIPPET_LANGUAGES.map((lang) => (
            <TabsTrigger key={lang} value={lang}>
              {NAMES[lang]}
            </TabsTrigger>
          ))}
        </TabsList>
        {SNIPPET_LANGUAGES.map((lang) => (
          <TabsContent key={lang} value={lang}>
            <CodeBlock code={snippet(lang, input)} label={NAMES[lang]} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
