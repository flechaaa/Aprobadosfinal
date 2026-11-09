import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Play, X } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { AuthForm } from '@/components/AuthForm';
import { AutocompleteField } from '@/components/AutocompleteField';
import type { PlaySelection } from '@/utils/playSelection';
import type { Chair, Subject, University } from '@/types';

interface PlaySelectionModalProps {
  open: boolean;
  initialName?: string;
  initialSelection?: PlaySelection;
  universities: University[];
  subjects: Subject[];
  chairs: Chair[];
  onClose: () => void;
  onStart: (name: string, selection: PlaySelection) => void;
}

function normalizeValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ');
}

export function PlaySelectionModal({
  open,
  initialName = '',
  initialSelection,
  universities,
  subjects,
  chairs,
  onClose,
  onStart,
}: PlaySelectionModalProps) {
  const [name, setName] = useState(initialName);
  const [universityName, setUniversityName] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [selectedChairIds, setSelectedChairIds] = useState<string[]>([]);
  const [unitName, setUnitName] = useState('');

  const [session, setSession] = useState<Session | null>(null);
  const [freshUser, setFreshUser] = useState<Session['user'] | null>(null);

  useEffect(() => {
    const syncUser = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      const { data: userData } = await supabase.auth.getUser();
      setFreshUser(userData.user ?? null);
    };
    void syncUser();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      supabase.auth.getUser().then(({ data }) => setFreshUser(data.user ?? null));
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const authDisplayName = (freshUser?.user_metadata?.display_name as string | undefined)?.trim() || '';

  useEffect(() => {
    if (authDisplayName) setName(authDisplayName);
  }, [authDisplayName]);

  const hasPlayedFreeGame =
    typeof window !== 'undefined' && localStorage.getItem('aprobados_has_played_free_game') === 'true';
  const requiresSignIn = hasPlayedFreeGame && !session;

  const universityId = useMemo(
    () => universities.find((u) => normalizeValue(u.name) === normalizeValue(universityName))?.id ?? '',
    [universities, universityName],
  );

  const exactSubjectId = useMemo(
    () => subjects.find((s) => normalizeValue(s.name) === normalizeValue(subjectName) && s.university_id === universityId)?.id ?? '',
    [subjects, subjectName, universityId],
  );

  const subjectId = useMemo(
    () => universityId && !subjectName.trim() ? 'all' : exactSubjectId,
    [universityId, subjectName, exactSubjectId],
  );

  const availableSubjects = useMemo(
    () => subjects.filter((subject) => subject.university_id === universityId),
    [subjects, universityId],
  );

  const availableChairs = useMemo(
    () => subjectId && subjectId !== 'all' ? chairs.filter((chair) => chair.subject_id === subjectId) : [],
    [chairs, subjectId],
  );

  // Solo cuentan los parciales que realmente pertenecen a la materia elegida.
  const selectedChairs = selectedChairIds.filter((id) => availableChairs.some((chair) => chair.id === id));
  // Sin parciales elegidos = todos los de la materia. Con varios, el primero es la referencia.
  const chairId = subjectId === 'all' ? 'all' : subjectId ? (selectedChairs[0] ?? 'all') : '';

  const toggleChair = (id: string) => {
    setSelectedChairIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  useEffect(() => {
    if (!open) return;

    setName(initialName);
    setUniversityName(initialSelection ? universities.find((u) => u.id === initialSelection.universityId)?.name ?? '' : '');
    setSubjectName(initialSelection ? subjects.find((s) => s.id === initialSelection.subjectId)?.name ?? '' : '');
    const previousPartialId = initialSelection?.partialId || initialSelection?.chairId || '';
    setSelectedChairIds(
      initialSelection?.chairIds?.length
        ? initialSelection.chairIds
        : previousPartialId && previousPartialId !== 'all'
          ? [previousPartialId]
          : [],
    );
    setUnitName(initialSelection?.unitId ?? '');
  }, [open, initialName, initialSelection, universities, subjects, chairs]);

  if (!open) return null;

  const isReady = Boolean(universityId && subjectId && chairId);
  const startLabel = isReady ? 'Comenzar partida' : 'Elegí una universidad válida';

  const handleStart = () => {
    if (!isReady) return;
    onStart(name.trim() || 'Anónimo', {
      universityId,
      subjectId,
      partialId: chairId,
      chairId,
      unitId: unitName.trim() || null,
      chairIds: selectedChairs.length > 1 ? selectedChairs : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg max-h-[92vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl animate-pop-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-teal-600 to-emerald-600">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-100">Jugar</p>
            <h2 className="text-xl font-extrabold text-white">
              {requiresSignIn ? 'Registrate para seguir' : 'Elegí tu clasificación'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-white/90 hover:bg-white/10 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-80px)] overflow-y-auto px-6 py-5 pb-20 space-y-4">
          {requiresSignIn ? (
            <AuthForm
              heading="¡Registrate para participar del ranking y compartir con tus amigos!"
              subheading="Es gratis: solo necesitás un email y una contraseña."
            />
          ) : (
            <>
          <div>
            {authDisplayName ? (
              <div className="rounded-xl border-2 border-teal-100 bg-teal-50/50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-teal-600">Jugás como</p>
                <p className="text-sm font-bold text-gray-800">{authDisplayName}</p>
              </div>
            ) : (
              <>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Nombre</label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="¿Cómo te llamás?"
                  maxLength={20}
                  className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors focus:border-teal-500"
                />
              </>
            )}
          </div>

          <AutocompleteField
            label="Universidad"
            value={universityName}
            onChange={setUniversityName}
            suggestions={universities.map((university) => university.name)}
            placeholder="Ej: Universidad de Buenos Aires"
            maxLength={200}
          />

          <AutocompleteField
            label="Materia"
            value={subjectName}
            onChange={setSubjectName}
            suggestions={availableSubjects.map((subject) => subject.name)}
            placeholder="Ej: Medicina"
            maxLength={200}
            disabled={!universityId}
          />

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">
              Parciales{selectedChairs.length > 1 ? ` (${selectedChairs.length} elegidos)` : ''}
            </label>
            {!subjectId || subjectId === 'all' ? (
              <p className="rounded-xl border-2 border-dashed border-gray-200 px-4 py-3 text-xs text-gray-400">
                Elegí una materia para ver sus parciales.
              </p>
            ) : availableChairs.length === 0 ? (
              <p className="rounded-xl border-2 border-dashed border-gray-200 px-4 py-3 text-xs text-gray-400">
                Esta materia todavía no tiene parciales cargados.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {availableChairs.map((chair) => {
                    const active = selectedChairs.includes(chair.id);
                    return (
                      <button
                        key={chair.id}
                        type="button"
                        onClick={() => toggleChair(chair.id)}
                        aria-pressed={active}
                        className={`rounded-full border-2 px-3.5 py-2 text-xs font-bold transition ${
                          active
                            ? 'border-teal-600 bg-teal-600 text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-teal-300'
                        }`}
                      >
                        {active && '\u2713 '}
                        {chair.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-gray-400">
                  {selectedChairs.length === 0
                    ? 'Podés elegir uno o varios. Si no elegís ninguno, juegan todos.'
                    : 'Tocá otro para sumarlo, o tocá uno elegido para sacarlo.'}
                </p>
              </>
            )}
          </div>

          <AutocompleteField
            label="Unidad"
            value={unitName}
            onChange={setUnitName}
            suggestions={[]}
            placeholder="Ej: Unidad 1, Microbiología"
            maxLength={200}
          />

          <div className="border-t border-slate-200 pt-4">
            {!isReady && (
              <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
                Faltan campos obligatorios
              </p>
            )}

            <button
              type="button"
              onClick={handleStart}
              disabled={!isReady}
              className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-black py-4 rounded-2xl transition-all shadow-lg hover:shadow-xl disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-400 disabled:text-gray-600"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <Play className="h-5 w-5" fill="currentColor" />
                {startLabel}
                {isReady && <ArrowRight className="h-4 w-4" />}
              </span>
            </button>
          </div>
            </>
          )}
        </div>
        </div>
      </div>
  );
}
