// POST { message_id }    The sender's app calls this right after a chat message is saved. We push a notification to the OTHER person's devices
//                        (phone lock screen, desktop), so it arrives even when Affinix is closed.
// POST { action: "key" } Returns the public VAPID key the browser needs to subscribe (so the key lives in one place: the function's secrets).
//
// Security: the caller must be signed in AND be the sender of that very message, which must be fresh (a minute or two) and not deleted.
// So nobody can use this to spam a stranger or to replay an old message. A muted conversation sends nothing.
// Secrets (supabase secrets set): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { jsonResponse, handleOptions } from "../_shared/cors.ts";

const MAX_AGE_MS = 2 * 60 * 1000;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  try {
    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@affinix.space";
    if (!publicKey || !privateKey) return jsonResponse({ error: "push_not_configured" }, 503);

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: auth } = await admin.auth.getUser(jwt);
    const me = auth?.user?.id;
    if (!me) return jsonResponse({ error: "not_authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    if (body.action === "key") return jsonResponse({ publicKey });

    const messageId = typeof body.message_id === "string" ? body.message_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) return jsonResponse({ error: "bad_message_id" }, 400);

    const { data: msg } = await admin.from("messages")
      .select("id, conversation_id, sender_id, body, attachment_path, deleted_at, created_at").eq("id", messageId).maybeSingle();
    if (!msg || msg.sender_id !== me) return jsonResponse({ error: "forbidden" }, 403);
    if (msg.deleted_at) return jsonResponse({ ok: true, skipped: "deleted" });
    if (Date.now() - new Date(msg.created_at).getTime() > MAX_AGE_MS) return jsonResponse({ ok: true, skipped: "stale" });

    const { data: conv } = await admin.from("conversations").select("user_a, user_b").eq("id", msg.conversation_id).maybeSingle();
    if (!conv) return jsonResponse({ error: "forbidden" }, 403);
    const to = conv.user_a === me ? conv.user_b : conv.user_a;

    const { data: pref } = await admin.from("conversation_prefs").select("muted").eq("conversation_id", msg.conversation_id).eq("user_id", to).maybeSingle();
    if (pref?.muted) return jsonResponse({ ok: true, skipped: "muted" });

    const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", to);
    if (!subs?.length) return jsonResponse({ ok: true, sent: 0 });

    const { data: sender } = await admin.from("profiles").select("full_name").eq("id", me).maybeSingle();
    const text = (msg.body ?? "").trim();
    const preview = msg.attachment_path ? `📷 ${text}`.trim() : text;
    const payload = JSON.stringify({
      title: sender?.full_name || "Affinix",
      body: preview.length > 120 ? `${preview.slice(0, 120)}…` : preview,
      tag: `dm:${msg.conversation_id}`,
      url: `./#/app/messages?c=${msg.conversation_id}`,
    });

    webpush.setVapidDetails(subject, publicKey, privateKey);
    let sent = 0;
    const gone: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high" });
        sent += 1;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.id); // the device unsubscribed or the app was removed
      }
    }));
    if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
    return jsonResponse({ ok: true, sent, removed: gone.length });
  } catch (err) {
    return jsonResponse({ error: "unexpected", detail: String(err) }, 500);
  }
});
