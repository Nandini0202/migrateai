import React, { useEffect, useState } from 'react';
import { getMigrationFiles } from '@/lib/api';

type FileStatus = 'converted' | 'warnings' | 'failed' | 'pending' | 'skipped' | 'unchanged' | 'manual_review' | 'verified';

interface FileRecord {
  path: string;
  status: FileStatus;
  originalSize?: number;
  convertedSize?: number;
}

interface Props {
  migrationId: string;
}

export default function FileExplorer({ migrationId }: Props) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchManifest() {
      setLoading(true);
      try {
        const manifest = await getMigrationFiles(migrationId);
        setFiles(manifest.files ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load file manifest');
      } finally {
        setLoading(false);
      }
    }
    fetchManifest();
  }, [migrationId]);

  const statusColor: Record<FileStatus, string> = {
    converted: 'bg-emerald-500',
    warnings: 'bg-amber-500',
    failed: 'bg-rose-500',
    pending: 'bg-slate-500',
    skipped: 'bg-slate-300',
    unchanged: 'bg-gray-500',
    manual_review: 'bg-indigo-500',
    verified: 'bg-teal-500',
  };

  if (loading) return <p className="text-sm text-zinc-400">Loading file manifest…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div className="mt-6 overflow-x-auto rounded border border-zinc-700 bg-zinc-900/50 p-4">
      <table className="w-full text-sm text-left text-zinc-300">
        <thead className="text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-2 py-1">File</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1">Original Size</th>
            <th className="px-2 py-1">Converted Size</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.path} className="border-b border-zinc-800">
              <td className="px-2 py-1 font-mono">{f.path}</td>
              <td className="px-2 py-1">
                <span className={`inline-block h-2 w-2 rounded-full mr-1 ${statusColor[f.status]}`}></span>
                {f.status.replace('_', ' ')}
              </td>
              <td className="px-2 py-1 text-right">{f.originalSize ?? '-'}
              </td>
              <td className="px-2 py-1 text-right">{f.convertedSize ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
