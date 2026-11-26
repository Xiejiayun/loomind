import { useCallback, useEffect, useRef, useState } from "react";
import { getWebMessages } from "../i18n.js";
import type { Session } from "./shared.js";

export async function authRequest<T>(route: string, method: "POST" | "GET" = "POST", body?: unknown): Promise<T> {
  const t = getWebMessages().login;
  let response: Response;
  try {
    response = await fetch(`/api/auth/${route}`, {
      method, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000),
      ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error(t.authConnectError);
  }
  const data = await response.json().catch(() => { throw new Error(t.authUnavailableError); });
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : t.authFailedError);
  return data;
}

export function useSession() {
  const [session, setSession] = useState<Session>();
  const [sessionError, setSessionError] = useState("");
  const version = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);

  const refresh = useCallback(async () => {
    const requestVersion = ++version.current;
    try {
      const next = await authRequest<Session>("session", "GET");
      if (requestVersion === version.current) { setSession(next); setSessionError(""); }
    } catch {
      if (requestVersion !== version.current) return;
      setSessionError(getWebMessages().login.sessionCheckError);
      setSession((previous) => previous && (!previous.expiresAt || previous.expiresAt > Date.now()) ? previous : { user: null, expiresAt: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("loomind-auth");
      channel.current.onmessage = refresh;
    }
    window.addEventListener("focus", refresh);
    return () => {
      ++version.current;
      window.removeEventListener("focus", refresh);
      channel.current?.close();
      channel.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (!session?.expiresAt) return;
    const timer = window.setTimeout(refresh, Math.max(0, session.expiresAt - Date.now() + 1000));
    return () => window.clearTimeout(timer);
  }, [session?.expiresAt, refresh]);

  const changeSession = useCallback((next: Session) => {
    ++version.current;
    setSessionError("");
    setSession(next);
    channel.current?.postMessage("changed");
  }, []);
  return { session, changeSession, sessionError, refresh };
}
