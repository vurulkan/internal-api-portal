import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Badge, Button, cn } from '../components/ui';
import { ApiSummary } from '../services/api';

type Props = {
  apis: ApiSummary[];
  refresh: () => void;
};

export function DashboardPage({ apis, refresh }: Props) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    apis.forEach((api) => {
      (api.tags ?? []).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
    });
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [apis]);

  const filteredApis = useMemo(() => {
    if (selectedTags.length === 0) return apis;
    return apis.filter((api) => selectedTags.some((tag) => (api.tags ?? []).includes(tag)));
  }, [apis, selectedTags]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API Catalog</h1>
          <p className="mt-1 text-sm text-gray-500">
            Only APIs granted through application permissions are listed here.
          </p>
        </div>
        <Button variant="secondary" onClick={refresh} className="shrink-0">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Tag filters */}
      {tagCounts.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Filter by category</p>
          <div className="flex flex-wrap gap-2">
            {tagCounts.map(([tag, count]) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  selectedTags.includes(tag)
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                )}
              >
                {tag} <span className="opacity-70">({count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedTags.length > 0 && (
        <p className="mb-4 text-sm text-gray-500">Showing APIs matching any selected tag.</p>
      )}

      {/* API grid */}
      {filteredApis.length === 0 ? (
        <div className="mt-12 flex flex-col items-center justify-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-500">No APIs matched the selected tags.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredApis.map((api) => (
            <ApiCard key={api.id} api={api} />
          ))}
        </div>
      )}
    </div>
  );
}

function ApiCard({ api }: { api: ApiSummary }) {
  const accessLabel = api.canInvoke ? 'View + Invoke' : api.canView ? 'View only' : 'Restricted';
  const accessVariant = api.canInvoke ? 'green' : api.canView ? 'blue' : 'gray';

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      {/* Top row */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-gray-900">{api.name}</h3>
          <p className="mt-0.5 text-sm text-gray-500 line-clamp-2">
            {api.description || 'No description provided.'}
          </p>
        </div>
        <Badge variant={api.isActive ? 'green' : 'red'} className="shrink-0">
          {api.isActive ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      {/* Tags */}
      {(api.tags ?? []).length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {api.tags.map((tag) => (
            <Badge key={tag} variant="gray">{tag}</Badge>
          ))}
        </div>
      )}

      {/* Meta */}
      <div className="mb-4 space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-gray-400">Owner</span>
          <span className="text-gray-700">{api.ownerTeam || 'Unassigned'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-gray-400">Access</span>
          <Badge variant={accessVariant}>{accessLabel}</Badge>
        </div>
      </div>

      {/* Action */}
      <div className="mt-auto">
        <Link
          to={`/apis/${api.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          Open
        </Link>
      </div>
    </div>
  );
}
