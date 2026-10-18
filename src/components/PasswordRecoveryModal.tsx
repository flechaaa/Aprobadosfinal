import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const MIN_PASSWORD_LENGTH = 6;

/**
 * Se muestra solo cuando la persona vuelve desde el link del email de
 * "Olvidé mi contraseña". Va montado una vez en App.tsx.
 */
export function PasswordRecoveryModal() {
  // El link de recuperación trae "type=recovery" en la URL: lo leemos de entrada
  // para no perder el evento si Supabase lo procesa antes de que montemos el listener.
  const [open, setOpen] = useState(() => window.location.hash.includes('type=recovery'));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setOpen(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
      setTimeout(() => {
        setOpen(false);
        window.history.replaceState({}, '', window.location.pathname);
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña. Probá de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const inputClass =
    'w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        {done ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-teal-600" />
            <p className="font-bold text-gray-900">¡Contraseña actualizada!</p>
            <p className="mt-1 text-sm text-gray-500">Ya podés seguir jugando con tu cuenta.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <h2 className="text-xl font-extrabold text-gray-900">Elegí tu nueva contraseña</h2>
            <input
              type="password"
              required
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={`Nueva contraseña (mínimo ${MIN_PASSWORD_LENGTH} caracteres)`}
              autoComplete="new-password"
              className={inputClass}
            />
            <input
              type="password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Repetí la contraseña"
              autoComplete="new-password"
              className={inputClass}
            />
            {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy || !password || !confirm}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3.5 font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar contraseña'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
