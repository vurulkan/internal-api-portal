import type { ApiAccess, ApiDefinition, ApiDefinitionPayload } from '@/lib/api';

export type ApiForm = {
  id?: number;
  name: string;
  slug: string;
  description: string;
  internalOpenapiUrl: string;
  internalBaseUrl: string;
  isActive: boolean;
  tryItEnabled: boolean;
  allowedMethods: string[];
  allowedPathPrefixes: string[];
  ownerTeam: string;
  tags: string[];
  ownerGroupId: number | null;
  allowedRequestHeaders: string[];
  forwardAllXHeaders: boolean;
  // value '' keeps the stored value of an existing header
  injectHeaders: { name: string; value: string }[];
  rateLimitPerMinute: string;
  timeoutSeconds: string;
  access: ApiAccess[];
};

export type ApiFormErrors = Partial<Record<keyof ApiForm, string>>;
export type SetField = <K extends keyof ApiForm>(key: K, value: ApiForm[K]) => void;

export const EMPTY_API: ApiForm = {
  name: '',
  slug: '',
  description: '',
  internalOpenapiUrl: '',
  internalBaseUrl: '',
  isActive: true,
  tryItEnabled: true,
  allowedMethods: [],
  allowedPathPrefixes: [],
  ownerTeam: '',
  tags: [],
  ownerGroupId: null,
  allowedRequestHeaders: [],
  forwardAllXHeaders: false,
  injectHeaders: [],
  rateLimitPerMinute: '0',
  timeoutSeconds: '0',
  access: [],
};

export function toApiForm(a: ApiDefinition, access: ApiAccess[]): ApiForm {
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description ?? '',
    internalOpenapiUrl: a.internalOpenapiUrl ?? '',
    internalBaseUrl: a.internalBaseUrl ?? '',
    isActive: a.isActive,
    tryItEnabled: a.tryItEnabled,
    allowedMethods: a.allowedMethods ?? [],
    allowedPathPrefixes: a.allowedPathPrefixes ?? [],
    ownerTeam: a.ownerTeam ?? '',
    tags: a.tags ?? [],
    ownerGroupId: a.ownerGroupId ?? null,
    allowedRequestHeaders: a.allowedRequestHeaders ?? [],
    forwardAllXHeaders: a.forwardAllXHeaders ?? false,
    injectHeaders: (a.injectHeaderNames ?? []).map((name) => ({ name, value: '' })),
    rateLimitPerMinute: String(a.rateLimitPerMinute ?? 0),
    timeoutSeconds: String(a.timeoutSeconds ?? 0),
    access: access.map(({ groupId, level }) => ({ groupId, level })),
  };
}

export function toPayload(f: ApiForm): ApiDefinitionPayload {
  return {
    name: f.name.trim(),
    slug: f.slug.trim(),
    description: f.description.trim(),
    internalOpenapiUrl: f.internalOpenapiUrl.trim(),
    internalBaseUrl: f.internalBaseUrl.trim(),
    isActive: f.isActive,
    tryItEnabled: f.tryItEnabled,
    allowedMethods: f.allowedMethods.map((m) => m.toUpperCase()),
    allowedPathPrefixes: f.allowedPathPrefixes,
    ownerTeam: f.ownerTeam.trim(),
    tags: f.tags,
    ownerGroupId: f.ownerGroupId,
    allowedRequestHeaders: f.allowedRequestHeaders,
    forwardAllXHeaders: f.forwardAllXHeaders,
    injectHeaders: f.injectHeaders.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value })),
    rateLimitPerMinute: Number(f.rateLimitPerMinute) || 0,
    timeoutSeconds: Number(f.timeoutSeconds) || 0,
  };
}

/** "Payments API v2" → "payments-api-v2". */
export function slugify(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

const absoluteUrl = (v: string) => {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

type Messages = { required: string; url: string; slug: string; range: string };

/** The source fields (name, slug, URLs). */
export function validateSource(f: ApiForm, m: Messages): ApiFormErrors {
  const e: ApiFormErrors = {};
  if (!f.name.trim()) e.name = m.required;
  if (!f.slug.trim()) e.slug = m.required;
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(f.slug.trim())) e.slug = m.slug;
  if (!f.internalOpenapiUrl.trim()) e.internalOpenapiUrl = m.required;
  else if (!absoluteUrl(f.internalOpenapiUrl)) e.internalOpenapiUrl = m.url;
  if (!f.internalBaseUrl.trim()) e.internalBaseUrl = m.required;
  else if (!absoluteUrl(f.internalBaseUrl)) e.internalBaseUrl = m.url;
  return e;
}

/** The try-it policy limits. */
export function validatePolicy(f: ApiForm, m: Messages): ApiFormErrors {
  const e: ApiFormErrors = {};
  const rate = Number(f.rateLimitPerMinute);
  if (!Number.isInteger(rate) || rate < 0 || rate > 10000) e.rateLimitPerMinute = m.range;
  const timeout = Number(f.timeoutSeconds);
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 300) e.timeoutSeconds = m.range;
  return e;
}
