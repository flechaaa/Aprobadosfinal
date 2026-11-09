import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Mode = 'signin' | 'signup' | 'forgot';

interface AuthFormProps {
  /** Mensaje de contexto que se muestra arriba (por qué conviene registrarse). */
  heading?: string;
  subheading?: string;
  defaultMode?: 'signin' | 'signup';
}

const MIN_PASSWORD_LENGTH = 6;

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email o contraseña incorrectos.';
  if (m.includes('email not confirmed')) return 'Todavía no confirmaste tu email. Revisá tu bandeja de entrada (y el spam).';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Ese email ya está registrado. Iniciá sesión o recuperá tu contraseña.';
  if (m.includes('password should be at least')) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (m.includes('rate limit') || m.includes('too many')) return 'Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.';
  if (m.includes('invalid email') || m.includes('unable to validate email')) return 'El email no es válido.';
  return message;
}

export function AuthForm({ heading, subheading, defaultMode = 'signup' }: AuthFormProps) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const redirectTo = `${window.location.origin}${window.location.pathname}`;

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setInfo('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const cleanEmail = email.trim();
    if (!cleanEmail) return;

    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (signInError) throw signInError;
        // La sesión nueva la detectan las pantallas con onAuthStateChange.
      } else if (mode === 'signup') {
        const name = displayName.trim().slice(0, 50);
        if (!name) throw new Error('Elegí un nombre o apodo para el ranking.');
        if (password.length < MIN_PASSWORD_LENGTH) {
          throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { display_name: name }, emailRedirectTo: redirectTo },
        });
        if (signUpError) throw signUpError;

        // Con "Confirm email" activo, un email ya registrado devuelve un usuario sin identidades.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw new Error('Ese email ya está registrado. Iniciá sesión o recuperá tu contraseña.');
        }

        if (!data.session) {
          // Requiere confirmar el email antes de poder entrar.
          setPassword('');
          setMode('signin');
          setInfo('¡Cuenta creada! Te mandamos un email para confirmarla. Cuando lo confirmes, volvé e iniciá sesión.');
        }
      } else {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
        if (resetError) throw resetError;
        setInfo('Si ese email tiene una cuenta, te mandamos un link para elegir una nueva contraseña.');
      }
    } catch (err) {
      setError(translateAuthError(err instanceof Error ? err.message : 'Ocurrió un error. Probá de nuevo.'));
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors focus:border-teal-500';

  const submitLabel = mode === 'signin' ? 'Iniciar sesión' : mode === 'signup' ? 'Crear cuenta' : 'Enviarme el link';
  const busyLabel = mode === 'forgot' ? 'Enviando...' : 'Un momento...';

  return (
    <div>
      {heading && <p className="font-bold text-gray-900">{heading}</p>}
      {subheading && <p className="mt-1 text-sm text-gray-500">{subheading}</p>}

      {mode !== 'forgot' ? (
        <div className="mt-4 flex gap-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
              mode === 'signup' ? 'bg-white text-teal-700 shadow' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Crear cuenta
          </button>
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
              mode === 'signin' ? 'bg-white text-teal-700 shadow' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Ya tengo cuenta
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-600">
          Ingresá tu email y te mandamos un link para elegir una nueva contraseña.
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        {mode === 'signup' && (
          <input
            type="text"
            required
            maxLength={50}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Tu nombre o apodo (se ve en el ranking)"
            autoComplete="nickname"
            className={inputClass}
          />
        )}

        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="tu@email.com"
          autoComplete="email"
          className={inputClass}
        />

        {mode !== 'forgot' && (
          <input
            type="password"
            required
            minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === 'signup' ? `Contraseña (mínimo ${MIN_PASSWORD_LENGTH} caracteres)` : 'Contraseña'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            className={inputClass}
          />
        )}

        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
        {info && <p className="rounded-xl bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700">{info}</p>}

        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 py-3.5 font-bold text-white shadow-lg transition-all hover:from-teal-700 hover:to-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {busyLabel}
            </>
          ) : (
            submitLabel
          )}
        </button>
      </form>

      {mode === 'signin' && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => switchMode('forgot')}
            className="text-xs font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800"
          >
            ¿Olvidaste tu contraseña?
          </button>
          <p className="mt-1 text-[11px] text-gray-400">
            ¿Te registraste antes con el link por email? Tocá "Olvidaste tu contraseña" para crear una.
          </p>
        </div>
      )}

      {mode === 'forgot' && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className="text-xs font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800"
          >
            Volver a iniciar sesión
          </button>
        </div>
      )}
    </div>
  );
}
