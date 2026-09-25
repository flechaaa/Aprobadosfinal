import { useEffect, useState } from 'react';
import { X, ChevronRight, ArrowLeft, Trophy, CheckCircle2, XCircle } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { loadGameHistory, type GameHistoryEntry } from '@/utils/gameHistory';

interface GameHistoryModalProps {
  open: boolean;
  onClose: () => void;
}

export function GameHistoryModal({ open, onClose }: GameHistoryModalProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [entries, setEntries] = useState<GameHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<GameHistoryEntry | null>(null);

  const [email, setEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [authError, setAuthError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!open || !session) return;
    setLoading(true);
    loadGameHistory()
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [open, session]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setEmail('');
      setMagicLinkSent(false);
      setAuthError('');
    }
  }, [open]);

  const handleSendMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
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
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="w-full max-w-lg max-h-[85vh] overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            {selected && (
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <h2 className="text-lg font-extrabold text-gray-900">{selected ? 'Repaso de la partida' : 'Mi historial'}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(85vh-64px)] overflow-y-auto p-6">
          {!session ? (
            magicLinkSent ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-teal-600" />
                <p className="font-bold text-gray-800">¡Listo! Revisá tu email</p>
                <p className="mt-1 text-sm text-gray-500">
                  Te mandamos un link a <span className="font-semibold text-gray-700">{email}</span>. Abrilo para ver tu historial.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSendMagicLink}>
                <p className="font-bold text-gray-800">Registrate para ver tu historial de partidas</p>
                <p className="mt-1 text-sm text-gray-500">Es gratis, sin necesidad de contraseña — solo tu email.</p>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@email.com"
                  className="mt-4 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                />
                {authError && <p className="mt-2 text-xs font-semibold text-red-600">{authError}</p>}
                <button
                  type="submit"
                  disabled={sending || !email.trim()}
                  className="mt-4 w-full rounded-xl bg-teal-600 px-4 py-3 font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? 'Enviando...' : 'Enviarme el link para entrar'}
                </button>
              </form>
            )
          ) : selected ? (
            <div className="space-y-3">
              <div className="rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-600 p-4 text-white">
                <p className="text-xs font-black uppercase tracking-wide text-teal-100">
                  {[selected.university_name, selected.subject_name, selected.chair_name].filter(Boolean).join(' · ') || 'Partida rápida'}
                </p>
                <p className="mt-1 text-2xl font-black">{selected.score} pts</p>
                <p className="text-xs text-teal-100">{selected.correct_answers} de {selected.total_questions} correctas · {new Date(selected.created_at).toLocaleDateString('es-AR')}</p>
              </div>

              {selected.questions.map((q, index) => (
                <div key={index} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-start gap-2">
                    {q.correct ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                    )}
                    <p className="text-sm font-semibold text-gray-800">{q.pregunta}</p>
                  </div>
                  <div className="mt-2 space-y-1 pl-6">
                    {q.opciones.map((opcion, optIndex) => (
                      <p
                        key={optIndex}
                        className={`text-xs ${
                          optIndex === q.correcta
                            ? 'font-bold text-teal-700'
                            : optIndex === q.selectedIndex
                              ? 'font-bold text-red-600 line-through'
                              : 'text-gray-500'
                        }`}
                      >
                        {String.fromCharCode(65 + optIndex)}. {opcion}
                      </p>
                    ))}
                  </div>
                  {q.explicacion && (
                    <p className="mt-2 border-t border-gray-200 pt-2 pl-6 text-xs text-gray-600">{q.explicacion}</p>
                  )}
                </div>
              ))}
            </div>
          ) : loading ? (
            <p className="py-10 text-center text-sm font-semibold text-gray-400">Cargando...</p>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center">
              <Trophy className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="font-bold text-gray-700">Todavía no jugaste ninguna partida registrada</p>
              <p className="mt-1 text-sm text-gray-400">Cuando termines una partida y la guardes en el ranking, va a aparecer acá.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelected(entry)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition hover:border-teal-200 hover:bg-teal-50/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-gray-800">
                      {[entry.university_name, entry.subject_name, entry.chair_name].filter(Boolean).join(' · ') || 'Partida rápida'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {entry.correct_answers}/{entry.total_questions} correctas · {new Date(entry.created_at).toLocaleDateString('es-AR')}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-sm font-black text-teal-700">{entry.score} pts</span>
                    <ChevronRight className="h-4 w-4 text-gray-300" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
