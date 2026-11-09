import { supabase } from '@/lib/supabase';

export const NOTIFICATION_SESSION_KEY = 'aprobados-session-id';

export function getOrCreateSessionId() {
  const stored = localStorage.getItem(NOTIFICATION_SESSION_KEY);
  if (stored) return stored;

  const newSession = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(NOTIFICATION_SESSION_KEY, newSession);
  return newSession;
}

export function notificationSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationSupported()) {
    return 'unsupported';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  return Notification.requestPermission();
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array | null) {
  if (!buffer) return null;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function registerBrowserPushSubscription(sessionId = getOrCreateSessionId()) {
  if (!notificationSupported() || Notification.permission !== 'granted') {
    throw new Error('Las notificaciones push no están autorizadas en este navegador.');
  }

  if (!('serviceWorker' in navigator)) {
    throw new Error('El navegador no soporta service workers para notificaciones web.');
  }

  try {
    await navigator.serviceWorker.ready;
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    const activeRegistration = registration ?? await navigator.serviceWorker.register('/sw.js');

    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? import.meta.env.VAPID_PUBLIC_KEY ?? '';
    if (!publicKey) {
      throw new Error('No hay una clave VAPID pública configurada.');
    }

    const subscription = await activeRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const rawKeys = subscription.getKey('p256dh');
    const rawAuth = subscription.getKey('auth');

    const payload = {
      session_id: sessionId,
      endpoint: subscription.endpoint,
      p256dh: arrayBufferToBase64(rawKeys),
      auth: arrayBufferToBase64(rawAuth),
      updated_at: new Date().toISOString(),
    };

    await supabase
      .from('user_subscriptions')
      .upsert(payload, { onConflict: 'endpoint' });

    return payload;
  } catch (error) {
    console.error('No se pudo registrar la subscripción push.', error);
    throw error;
  }
}

export async function sendApprovedSubmissionPushNotification(args: {
  subject: string;
  chair: string;
  sessionId?: string | null;
}) {
  try {
    const { data, error } = await supabase.functions.invoke('notify-approved-submission', {
      body: {
        subject: args.subject,
        chair: args.chair,
        session_id: args.sessionId ?? null,
        message: `¡Listo tu preguntero de ${args.chair}! Ya está disponible para jugar y rankear. 🎓`,
      },
    });

    if (error) {
      console.error('No se pudo disparar la notificación push desde Supabase:', error);
    }

    return { data, error };
  } catch (error) {
    console.error('No se pudo disparar la notificación push localmente:', error);
    return { data: null, error };
  }
}
