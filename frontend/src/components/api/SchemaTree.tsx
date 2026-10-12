import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { mergeAllOf, refName, resolveRef, schemaTypes, typeLabel, type Schema, type SpecObject } from '@/lib/openapi';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui';
import { Markdown } from './Markdown';

const MAX_DEPTH = 10;

/**
 * A schema as nested, expandable lists (disclosure buttons): property name, type, required, constraints,
 * description. A $ref already open on the current branch is shown as "circular"
 * instead of being expanded again.
 */
export function SchemaTree({ spec, schema, mode }: { spec: SpecObject; schema: Schema; mode: 'request' | 'response' }) {
  return (
    <div className="rounded-md border border-border text-[13px]">
      <SchemaChildren spec={spec} schema={schema} mode={mode} depth={0} ancestors={[]} />
    </div>
  );
}

function children(spec: SpecObject, raw: Schema) {
  const schema = mergeAllOf(spec, raw);
  const types = schemaTypes(schema);
  if (types.includes('array')) {
    const items = mergeAllOf(spec, schema.items ?? {});
    return {
      schema: items,
      required: new Set<string>(items.required ?? []),
      properties: (items.properties ?? {}) as Record<string, Schema>,
      variants: items.oneOf ?? items.anyOf,
    };
  }
  return {
    schema,
    required: new Set<string>(schema.required ?? []),
    properties: (schema.properties ?? {}) as Record<string, Schema>,
    variants: schema.oneOf ?? schema.anyOf,
  };
}

function SchemaChildren({
  spec,
  schema,
  mode,
  depth,
  ancestors,
}: {
  spec: SpecObject;
  schema: Schema;
  mode: 'request' | 'response';
  depth: number;
  ancestors: string[];
}) {
  const { t } = useTranslation();
  const { properties, required, variants } = children(spec, schema);
  const entries = Object.entries(properties).filter(([, p]) => {
    const r = resolveRef(spec, p);
    return !((mode === 'request' && r?.readOnly) || (mode === 'response' && r?.writeOnly));
  });
  if (Array.isArray(variants) && variants.length && entries.length === 0) {
    return (
      <div className="space-y-1 p-2">
        <p className="text-xs text-muted-foreground">{t('schema.oneOf')}</p>
        {variants.map((v: Schema, i: number) => (
          <div key={i} className="rounded-md border border-border">
            <p className="border-b border-border px-2 py-1 font-mono text-xs">
              {typeLabel(spec, v) || t('schema.variant', { n: i + 1 })}
            </p>
            <SchemaChildren spec={spec} schema={v} mode={mode} depth={depth + 1} ancestors={ancestors} />
          </div>
        ))}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <p className="px-3 py-2 font-mono text-xs text-muted-foreground">{typeLabel(spec, schema) || t('schema.any')}</p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {entries.map(([name, prop]) => (
        <PropertyRow
          key={name}
          spec={spec}
          name={name}
          prop={prop}
          required={required.has(name)}
          mode={mode}
          depth={depth}
          ancestors={ancestors}
        />
      ))}
    </ul>
  );
}

function PropertyRow({
  spec,
  name,
  prop,
  required,
  mode,
  depth,
  ancestors,
}: {
  spec: SpecObject;
  name: string;
  prop: Schema;
  required: boolean;
  mode: 'request' | 'response';
  depth: number;
  ancestors: string[];
}) {
  const { t } = useTranslation();
  const ref = refName(prop) ?? refName(resolveRef(spec, prop)?.items);
  const circular = !!ref && ancestors.includes(ref);
  const resolved = mergeAllOf(spec, prop);
  const nested = children(spec, prop);
  const expandable =
    !circular && depth < MAX_DEPTH && (Object.keys(nested.properties).length > 0 || Array.isArray(nested.variants));
  const [open, setOpen] = useState(depth < 1);
  const constraints = [
    resolved.format && `format: ${resolved.format}`,
    resolved.minimum !== undefined && `≥ ${resolved.minimum}`,
    resolved.maximum !== undefined && `≤ ${resolved.maximum}`,
    resolved.minLength !== undefined && `minLength ${resolved.minLength}`,
    resolved.maxLength !== undefined && `maxLength ${resolved.maxLength}`,
    resolved.pattern && `pattern ${resolved.pattern}`,
    resolved.default !== undefined && `${t('schema.default')}: ${JSON.stringify(resolved.default)}`,
  ].filter(Boolean) as string[];

  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-start gap-1.5 px-2 py-1.5" style={{ paddingLeft: `${8 + depth * 14}px` }}>
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? t('schema.collapse', { name }) : t('schema.expand', { name })}
            className="mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono font-medium break-token">
              {name}
              {required && (
                <span className="text-destructive" aria-label={t('schema.required')}>
                  *
                </span>
              )}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{typeLabel(spec, prop)}</span>
            {circular && <Badge variant="outline">{t('schema.circular')}</Badge>}
            {resolved.deprecated && <Badge variant="warning">{t('catalog.deprecated')}</Badge>}
            {resolved.readOnly && <Badge variant="outline">{t('schema.readOnly')}</Badge>}
            {resolved.writeOnly && <Badge variant="outline">{t('schema.writeOnly')}</Badge>}
          </p>
          {resolved.description && (
            <Markdown className="mt-0.5 text-[13px] text-muted-foreground">{resolved.description}</Markdown>
          )}
          {Array.isArray(resolved.enum) && (
            <p className="mt-0.5 flex flex-wrap gap-1 text-xs">
              <span className="text-muted-foreground">{t('schema.oneOfValues')}</span>
              {resolved.enum.map((v: unknown) => (
                <code key={String(v)} className="rounded bg-muted px-1 font-mono">
                  {JSON.stringify(v)}
                </code>
              ))}
            </p>
          )}
          {constraints.length > 0 && (
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{constraints.join(' · ')}</p>
          )}
        </div>
      </div>
      {expandable && open && (
        <SchemaChildren
          spec={spec}
          schema={prop}
          mode={mode}
          depth={depth + 1}
          ancestors={ref ? [...ancestors, ref] : ancestors}
        />
      )}
    </li>
  );
}
