import { useOutletContext } from 'react-router';
import type { ApiDefinition } from '@/lib/api';
import type { NormalizedSpec } from '@/lib/openapi';
import type { useApiSpec } from '@/hooks/queries';

export type ApiWorkspace = {
  apiDef: ApiDefinition;
  /** The slug (or id) in the URL. */
  ref: string;
  spec: NormalizedSpec | null;
  specQuery: ReturnType<typeof useApiSpec>;
  base: string;
};

export function useApiWorkspace() {
  return useOutletContext<ApiWorkspace>();
}

/** URL of one operation: /apis/payments/operations/createCharge */
export function operationPath(base: string, key: string) {
  return `${base}/operations/${encodeURIComponent(key)}`;
}
