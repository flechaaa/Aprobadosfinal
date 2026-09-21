import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Play, X, CheckCircle2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { AutocompleteField } from '@/components/AutocompleteField';
import type { TaxonomySelection } from '@/components/TaxonomyPicker';
import type { Chair, Subject, University } from '@/types';

interface PlaySelectionModalProps {
  open: boolean;
  initialName?: string;
  initialSelection?: TaxonomySelection;
  universities: University[];
  subjects: Subject[];
  chairs: Chair[];
  onClose: () => void;
  onStart: (name: string, selection: TaxonomySelection) => void;
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
  const [chairName, setChairName] = useState('');
  const [useUnit, setUseUnit] = useState(false);
  const [unitName, setUnitName] = useState('');

  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [authError, setAuthError] = useState('');
  const [sendingLink, setSendingLink] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const hasPlayedFreeGame =
    typeof window !== 'undefined' && localStorage.getItem('aprobados_has_played_free_game') === 'true';
  const requiresSignIn = hasPlayedFreeGame && !session;

  const handleSendMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || sendingLink) return;
    setSendingLink(true);
    setAuthError('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
      });
      if (error) throw error;
      setMagicLinkSent(true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'No se pudo enviar el link. Probá de nuevo.');
    } finally {
      setSendingLink(false);
    }
  };

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

  const exactChairId = useMemo(
    () => chairs.find((c) => normalizeValue(c.name) === normalizeValue(chairName) && c.subject_id === subjectId)?.id ?? '',
    [chairs, chairName, subjectId],
  );

  const chairId = useMemo(
    () => subjectId === 'all' || (subjectId && !chairName.trim()) ? 'all' : exactChairId,
    [subjectId, chairName, exactChairId],
  );

  const availableSubjects = useMemo(
    () => subjects.filter((subject) => subject.university_id === universityId),
    [subjects, universityId],
  );

  const availableChairs = useMemo(
    () => subjectId && subjectId !== 'all' ? chairs.filter((chair) => chair.subject_id === subjectId) : [],
    [chairs, subjectId],
  );

  useEffect(() => {
    if (!open) return;

    setName(initialName);
    setUniversityName(initialSelection ? universities.find((u) => u.id === initialSelection.universityId)?.name ?? '' : '');
    setSubjectName(initialSelection ? subjects.find((s) => s.id === initialSelection.subjectId)?.name ?? '' : '');
    const previousPartialId = initialSelection?.partialId || initialSelection?.chairId || '';
    setChairName(initialSelection ? chairs.find((c) => c.id === previousPartialId)?.name ?? '' : '');
    setUseUnit(Boolean(initialSelection?.unitId && initialSelection.unitId.trim()));
    setUnitName(initialSelection?.unitId ?? '');
  }, [open, initialName, initialSelection, universities, subjects, chairs]);

  if (!open) return null;

  const isReady = Boolean(universityId && subjectId && chairId);
  const startLabel = isReady ? 'Comenzar partida' : 'Elegi una universidad valida';

  const handleStart = () => {
    if (!isReady) return;
    onStart(name.trim() || 'AnÃ³nimo', {
      universityId,
      subjectId,
      partialId: chairId,
      chairId,
      unitId: useUnit ? unitName.trim() || null : null,
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
            magicLinkSent ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-teal-600" />
                <p className="font-bold text-gray-800">¡Listo! Revisá tu email</p>
                <p className="mt-1 text-sm text-gray-500">
                  Te mandamos un link a <span className="font-semibold text-gray-700">{email}</span>. Abrilo desde este mismo dispositivo para entrar y seguir jugando.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSendMagicLink} className="space-y-3">
                <div className="mb-1 text-center">
                  <p className="font-bold text-gray-800">¡Registrate para participar del ranking y compartir con tus amigos!</p>
                  <p className="mt-1 text-sm text-gray-500">
                    Es gratis, sin necesidad de contraseña — solo tu email.
                  </p>
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@email.com"
                  className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors focus:border-teal-500"
                />
                {authError && <p className="text-xs font-semibold text-red-600">{authError}</p>}
                <button
                  type="submit"
                  disabled={sendingLink || !email.trim()}
                  className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-black py-4 rounded-2xl transition-all shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingLink ? 'Enviando...' : 'Enviarme el link para entrar'}
                </button>
              </form>
            )
          ) : (
            <>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="¿Cómo te llamás?"
              maxLength={20}
              className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors focus:border-teal-500"
            />
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

          <AutocompleteField
            label="Parcial"
            value={chairName}
            onChange={setChairName}
            suggestions={availableChairs.map((chair) => chair.name)}
            placeholder="Ej: Primer Parcial"
            maxLength={200}
            disabled={!subjectId || subjectId === 'all'}
          />

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center gap-3 text-sm font-bold text-gray-700">
              <input
                type="checkbox"
                checked={useUnit}
                onChange={(event) => {
                  setUseUnit(event.target.checked);
                  if (!event.target.checked) setUnitName('');
                }}
                className="h-4 w-4 accent-teal-600"
              />
              Agregar unidad (opcional)
            </label>
            {useUnit && (
              <div className="mt-3">
                <AutocompleteField
                  label="Unidad"
                  value={unitName}
                  onChange={setUnitName}
                  suggestions={[]}
                  placeholder="Ej: Unidad 1, MicrobiologÃ­a"
                  maxLength={200}
                />
              </div>
            )}
          </div>

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
