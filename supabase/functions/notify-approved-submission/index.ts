import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

deno.serve(async (req) => {
  try {
    const body = await req.json();
    const subject = String(body.subject || 'tu materia');
    const chair = String(body.chair || 'tu cátedra');
    const sessionId = body.session_id || null;
    const message = String(body.message || `¡Listo tu preguntero de ${chair}! Ya está disponible para jugar y rankear. 🎓`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const vapidKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceRole || !vapidKey || !vapidPublic) {
      return new Response(JSON.stringify({ ok: false, error: 'VAPID o Supabase configurado incompleto.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRole);

    let query = supabase.from('user_subscriptions').select('endpoint, p256dh, auth');
    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }

    const { data: subs, error } = await query;
    if (error || !subs || subs.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, error: error?.message || 'Sin subscripciones registradas.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const payload = {
      title: 'Aprobados',
      body: `¡Listo tu preguntero de ${chair}! Ya está disponible para jugar y rankear. 🎓`,
      data: { url: '/', subject, chair },
    };

    const webPush = await import('https://esm.sh/web-push@3.0.1');
    const webPushClient = webPush.default || webPush;
    webPushClient.setVapidDetails('mailto:admin@aprobados.app', vapidPublic, vapidKey);

    const sent = await Promise.allSettled(
      subs.map(async (sub: any) => {
        const endpoint = sub.endpoint;
        const keys = {
          p256dh: sub.p256dh,
          auth: sub.auth,
        };
        await webPushClient.sendNotification({ endpoint, keys }, JSON.stringify(payload));
      })
    );

    const ok = sent.filter((r) => r.status === 'fulfilled').length;
    return new Response(JSON.stringify({ ok: true, sent: ok, message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'Error en edge function.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
