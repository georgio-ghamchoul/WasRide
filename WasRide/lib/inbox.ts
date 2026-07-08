// Notification inbox: store + read notifications per user.
//
// The public.notifications table holds two kinds of rows:
//   - Broadcasts:  user_id IS NULL, filtered by `audience` (all/drivers/riders)
//   - Targeted:    user_id = a specific recipient (ride events, ban, chat, DMs)
//
// The unread badge is driven by profiles.notifications_read_at: anything created
// after that timestamp (and relevant to the user) counts as unread.
import { supabase } from "@/lib/supabase";

export type NotifType = "admin" | "ride" | "ban" | "chat" | "system";
export type Audience = "all" | "drivers" | "riders";

export type InboxItem = {
  id: string;
  title: string | null;
  body: string;
  type: NotifType;
  audience: Audience;
  user_id: string | null;
  created_at: string;
};

/** Insert a notification. Pass userId for a targeted row, or audience for a broadcast. */
export async function recordNotification(opts: {
  body: string;
  title?: string;
  userId?: string | null;
  audience?: Audience;
  type?: NotifType;
}): Promise<void> {
  const row: any = {
    body: opts.body,
    title: opts.title ?? null,
    type: opts.type ?? (opts.userId ? "system" : "admin"),
    audience: opts.audience ?? "all",
  };
  if (opts.userId) row.user_id = opts.userId;
  const { error } = await supabase.from("notifications").insert(row);
  if (error) console.log("recordNotification error:", error.message);
}

/** Fetch this user's inbox: broadcasts for their role + their targeted rows. */
export async function fetchInbox(userId: string, role: string): Promise<InboxItem[]> {
  // Audiences this user should see: 'all' + their own role bucket.
  const audiences: Audience[] = ["all", role === "driver" ? "drivers" : "riders"];
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, type, audience, user_id, created_at")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { console.log("fetchInbox error:", error.message); return []; }
  // Broadcasts must match the user's audience; targeted rows always pass.
  return (data || []).filter((n: any) => n.user_id === userId || audiences.includes(n.audience));
}

/** Count unread items (created after the user's last-read marker). */
export async function countUnread(userId: string, role: string): Promise<number> {
  const { data: prof } = await supabase
    .from("profiles")
    .select("notifications_read_at")
    .eq("id", userId)
    .maybeSingle();
  const readAt = prof?.notifications_read_at ? new Date(prof.notifications_read_at).getTime() : 0;
  const items = await fetchInbox(userId, role);
  return items.filter((n) => new Date(n.created_at).getTime() > readAt).length;
}

// Lightweight signal so the bell badge can clear the instant the inbox is read,
// instead of waiting for a screen-focus refresh (which could race the DB write).
type ReadListener = () => void;
const readListeners = new Set<ReadListener>();
export function onInboxRead(fn: ReadListener): () => void {
  readListeners.add(fn);
  return () => { readListeners.delete(fn); };
}

/** Mark everything read (called when the inbox is opened). */
export async function markInboxRead(userId: string): Promise<void> {
  await supabase
    .from("profiles")
    .update({ notifications_read_at: new Date().toISOString() })
    .eq("id", userId);
  readListeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}
