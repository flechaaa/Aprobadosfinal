import { useEffect, useMemo, useState } from 'react';
import { Trophy, X } from 'lucide-react';
import { loadRankings, type AggregatedRankingEntry, type RankingScope } from '@/utils/rankings';
import type { Chair, Subject, University } from '@/types';

interface RankingModalProps {
  open: boolean;
  chairId?: string | null;
  chairs?: Chair[];
  universities?: University[];
  subjects?: Subject[];
  onClose: () => void;
}

export function RankingModal({ open, chairId, chairs = [], universities = [], subjects = [], onClose }: RankingModalProps) {
  const [entries, setEntries] = useState<AggregatedRankingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<RankingScope>(chairId ? 'subject' : 'global');
  const [universityId, setUniversityId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [unit, setUnit] = useState('');

  const availableSubjects = useMemo(
    () => subjects.filter((subject) => !universityId || subject.university_id === universityId),
    [subjects, universityId],
  );

  useEffect(() => {
    if (!open) return;
    if (chairId) {
      const chair = chairs.find((item) => item.id === chairId);
      setSubjectId(chair?.subject_id ?? '');
      setScope('subject');
    }
  }, [chairs, chairId, open]);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    setLoading(true);
    setError('');
    loadRankings({ scope, universityId: universityId || null, subjectId: subjectId || null, unit: unit || null })
      .then((rows) => {
        if (!ignore) setEntries(rows);
      })
      .catch((loadError) => {
        if (!ignore) setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el ranking.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [open, scope, universityId, subjectId, unit]);

  if (!open) return null;

  const scopeLabel = scope === 'global' ? 'Global' : scope === 'university' ? 'Por universidad' : scope === 'subject' ? 'Por materia' : 'Por unidad';

  const selectScope = (nextScope: RankingScope) => {
    setScope(nextScope);
    if (nextScope === 'global') {
      setUniversityId('');
      setSubjectId('');
      setUnit('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-100"><Trophy className="h-6 w-6 text-teal-700" /></div>
            <div><p className="text-xs font-bold uppercase tracking-wide text-gray-500">Top 50</p><h3 className="text-xl font-extrabold text-gray-900">Ranking {scopeLabel}</h3></div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 px-6 pt-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['global', 'university', 'subject', 'unit'] as RankingScope[]).map((item) => (
              <button key={item} type="button" onClick={() => selectScope(item)} className={`rounded-xl px-3 py-2 text-sm font-bold ${scope === item ? 'bg-teal-700 text-white' : 'border border-teal-200 bg-white text-teal-700'}`}>
                {item === 'global' ? 'Global' : item === 'university' ? 'Universidad' : item === 'subject' ? 'Materia' : 'Unidad'}
              </button>
            ))}
          </div>

          {scope !== 'global' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(scope === 'university' || scope === 'subject' || scope === 'unit') && (
                <select value={universityId} onChange={(event) => { setUniversityId(event.target.value); setSubjectId(''); }} className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-teal-500">
                  <option value="">Todas las universidades</option>
                  {universities.map((university) => <option key={university.id} value={university.id}>{university.name}</option>)}
                </select>
              )}
              {(scope === 'subject' || scope === 'unit') && (
                <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-teal-500">
                  <option value="">Todas las materias</option>
                  {availableSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                </select>
              )}
              {scope === 'unit' && <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Unidad exacta" className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-teal-500" />}
            </div>
          )}
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
          {loading && <p className="text-sm font-semibold text-gray-500">Cargando ranking...</p>}
          {error && <p className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
          {!loading && !error && entries.length === 0 && <div className="rounded-2xl bg-teal-50 p-4 text-sm font-semibold text-teal-800">Aun no hay puntajes para este filtro.</div>}
          {!loading && !error && entries.length > 0 && (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div key={`${entry.player_name}-${entry.rank}`} className="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {entry.avatar_url ? <img src={entry.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white font-black text-teal-700 shadow-sm">#{entry.rank}</span>}
                    <div className="min-w-0"><p className="truncate text-sm font-bold text-gray-900">{entry.player_name || 'Jugador anonimo'}</p><p className="text-xs font-semibold text-gray-600">{entry.games_played} partidas | {entry.correct_answers}/{entry.questions_answered} correctas</p><p className="truncate text-[11px] text-gray-500">{entry.university_name || 'Universidad sin nombre'} | {entry.subject_name || 'Materia sin nombre'}{entry.unit ? ` | ${entry.unit}` : ''}</p></div>
                  </div>
                  <div className="ml-3 text-right"><span className="block text-lg font-black text-teal-700">{entry.total_score}</span><span className="text-[11px] font-bold uppercase text-gray-500">Puntos</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
