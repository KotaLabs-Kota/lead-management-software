import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageMeta } from '@/lib/types';

export function Pagination({
  page,
  onChange,
}: {
  page: PageMeta;
  onChange: (page: number) => void;
}) {
  if (page.totalPages <= 1) {
    return (
      <p className="text-sm text-slate-500">
        Showing {page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1}–
        {Math.min(page.total, page.page * page.pageSize)} of {page.total}
      </p>
    );
  }

  const button =
    'inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-slate-500">
        Page {page.page} of {page.totalPages} · {page.total} records
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={button}
          disabled={page.page <= 1}
          onClick={() => onChange(page.page - 1)}
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <button
          type="button"
          className={button}
          disabled={page.page >= page.totalPages}
          onClick={() => onChange(page.page + 1)}
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
