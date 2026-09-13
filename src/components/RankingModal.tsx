import { useEffect, useState } from 'react';
import { Trophy, X } from 'lucide-react';
import { loadGlobalRankingTopTen, loadRankingTopTen, type GlobalRankingEntry, type RankingEntry } from '@/utils/rankings';
import type { Chair } from '@/types';

interface RankingModalProps {
  open: boolean;
  chairId?: string | null;
  chairs?: Chair[];
  onClose: () => void;
}

export function RankingModal({ open, chairId, chairs = [], onClose }: RankingModalProps) {
  const [entries, setEntries] = useState<Array<RankingEntry | GlobalRankingEntry>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'global' | 'chair'>(chairId ? 'chair' : 'global');
  const [selectedChair, setSelectedChair] = useState<string>(chairId ?? '');

  useEffect(() => {
    if (!open) return;
    if (chairId) {
      setSelectedChair(chairId);
      setView('chair');
    } else {
      setView('global');
      setSelectedChair('');
    }
  }, [open, chairId]);

  useEffect(() => {
    if (!open) return;

    let ignore = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const rows = view === 'chair' && selectedChair ? await loadRankingTopTen(selectedChair) : await loadGlobalRankingTopTen();
        if (!ignore) setEntries(rows);
      } catch (err) {
        if (!ignore) setError(view === 'chair' ? 'No pudimos cargar el ranking de esta cátedra.' : 'No pudimos cargar el ranking global.');
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void load();
    return () => {
      ignore = true;
    };
  }, [open, view, selectedChair]);

  if (!open) return null;

  const isGlobal = view === 'global';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-100">
              <Trophy className="h-6 w-6 text-teal-700" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{isGlobal ? 'Global Top 50' : 'Top 10'}</p>
              <h3 className="text-xl font-extrabold text-gray-900">{isGlobal ? 'Ranking General' : 'Ranking por cátedra'}</h3>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setView('global')} className={`rounded-full px-4 py-2 text-sm font-bold ${isGlobal ? 'bg-teal-700 text-white' : 'border border-teal-200 text-teal-700 bg-white'}`}>Ranking General</button>
            <button type="button" onClick={() => setView('chair')} className={`rounded-full px-4 py-2 text-sm font-bold ${!isGlobal ? 'bg-teal-700 text-white' : 'border border-teal-200 text-teal-700 bg-white'}`}>Ranking por Cátedra</button>
          </div>

          {!isGlobal && (
            <div className="mt-3">
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Cátedra</label>
              <select value={selectedChair} onChange={(e) => setSelectedChair(e.target.value)} className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800 outline-none focus:border-teal-500">
                <option value="">Elegí una cátedra</option>
                {chairs.map((chair) => <option key={chair.id} value={chair.id}>{chair.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {loading && <p className="text-sm font-semibold text-gray-500">Cargando ranking…</p>}
          {error && <p className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}

          {!loading && !error && entries.length === 0 && (
            <div className="rounded-2xl bg-teal-50 p-4 text-sm font-semibold text-teal-800">
              {isGlobal ? 'Aún no hay puntajes globales. ¡Se el primero!' : 'Aún no hay puntajes para esta cátedra. ¡Se el primero!'}
            </div>
          )}

          {!loading && entries.length > 0 && (
            <div className="space-y-3">
              {entries.map((entry, index) => {
                const gEntry = entry as GlobalRankingEntry;
                const universityName = gEntry.universityName ?? 'Universidad sin nombre';
                const subjectName = gEntry.subjectName ?? 'Materia sin nombre';
                const chairName = gEntry.chairName ?? 'Cátedra sin nombre';

                return (
                  <div key={`${entry.player_name}-${entry.created_at}-${index}`} className="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white font-black text-teal-700 shadow-sm">
                        #{index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{entry.player_name}</p>
                        <p className="text-xs font-semibold text-gray-600">
                          <span className="font-bold text-gray-700">Materia:</span> {subjectName} | <span className="font-bold text-gray-700">Cátedra:</span> {chairName}
                        </p>
                        <p className="text-[11px] font-medium text-gray-500">
                          <span className="font-bold text-gray-700">Universidad:</span> {universityName}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="block text-lg font-black text-teal-700">{entry.score}</span>
                      <span className="text-[11px] font-bold uppercase text-gray-500">Puntos</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
