// Rider cancellation limit logic (server-backed via Supabase).
//
// Rule:
//  - Every rider cancel increments profiles.cancel_count.
//  - The 3rd cancel still goes through but the rider is WARNED.
//  - The 4th attempt is BLOCKED for 30 minutes (cancel_lock_until).
//  - A completed ride OR waiting out the lock resets cancel_count to 0.
import { supabase } from "@/lib/supabase";

export const CANCEL_WARN_AT = 3;       // cancel number that triggers the warning
export const CANCEL_LOCK_MINUTES = 30; // lockout duration

export type CancelState = {
  count: number;
  lockUntil: Date | null;
  /** true if a lock is currently active (now < lockUntil) */
  locked: boolean;
  /** ms remaining on the lock (0 if not locked) */
  remainingMs: number;
};

/** Read the rider's current cancel state. Also auto-clears an expired lock. */
export async function getCancelState(userId: string): Promise<CancelState> {
  const { data } = await supabase
    .from("profiles")
    .select("cancel_count, cancel_lock_until")
    .eq("id", userId)
    .maybeSingle();

  let count = data?.cancel_count ?? 0;
  let lockUntil = data?.cancel_lock_until ? new Date(data.cancel_lock_until) : null;
  const now = Date.now();

  // Lock expired → reset both count and lock on the server.
  if (lockUntil && lockUntil.getTime() <= now) {
    await supabase
      .from("profiles")
      .update({ cancel_count: 0, cancel_lock_until: null })
      .eq("id", userId);
    count = 0;
    lockUntil = null;
  }

  const locked = !!lockUntil && lockUntil.getTime() > now;
  return {
    count,
    lockUntil,
    locked,
    remainingMs: locked ? lockUntil!.getTime() - now : 0,
  };
}

export type RecordCancelResult = {
  count: number;          // new cancel count
  warned: boolean;        // this cancel hit the warning threshold
  lockedNext: boolean;    // the NEXT request will be blocked
};

/** Increment the rider's cancel count. Call AFTER a rider-initiated cancel succeeds. */
export async function recordRiderCancel(userId: string): Promise<RecordCancelResult> {
  const state = await getCancelState(userId);
  const newCount = state.count + 1;

  const update: any = { cancel_count: newCount };
  // Once they pass the warn threshold, arm the 30-min lock for the next attempt.
  let lockedNext = false;
  if (newCount >= CANCEL_WARN_AT) {
    update.cancel_lock_until = new Date(Date.now() + CANCEL_LOCK_MINUTES * 60_000).toISOString();
    lockedNext = true;
  }
  await supabase.from("profiles").update(update).eq("id", userId);

  return {
    count: newCount,
    warned: newCount === CANCEL_WARN_AT,
    lockedNext,
  };
}

/** Reset the cancel streak. Call when a ride completes successfully. */
export async function resetCancelCount(userId: string): Promise<void> {
  await supabase
    .from("profiles")
    .update({ cancel_count: 0, cancel_lock_until: null })
    .eq("id", userId);
}
