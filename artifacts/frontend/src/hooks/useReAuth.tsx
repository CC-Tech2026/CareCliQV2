import { useCallback, useState } from "react";
import { CCQ_REAUTH_TOKEN_KEY, CCQ_REAUTH_UNTIL_KEY } from "@/lib/storage-keys";
import { ReAuthModal } from "@/components/auth/ReAuthModal";
import { reauthenticate } from "@/services/securityService";

function hasFreshReauth() {
  const token = localStorage.getItem(CCQ_REAUTH_TOKEN_KEY);
  const until = localStorage.getItem(CCQ_REAUTH_UNTIL_KEY);
  return Boolean(token && until && new Date(until).getTime() > Date.now() + 5000);
}

export function useReAuth() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | {
    action: () => Promise<unknown>;
    resolve: (value: unknown) => void;
  }>(null);

  const requireReAuth = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (hasFreshReauth()) return action();
    setError(null);
    setOpen(true);
    return new Promise<T | undefined>((resolve) => {
      setPending({
        action: async () => action(),
        resolve: (value) => resolve(value as T | undefined),
      });
    });
  }, []);

  const submit = useCallback(async (password: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await reauthenticate(password);
      localStorage.setItem(CCQ_REAUTH_TOKEN_KEY, result.reauth_token);
      localStorage.setItem(CCQ_REAUTH_UNTIL_KEY, result.reauthenticated_until);
      setOpen(false);
      const next = pending;
      setPending(null);
      if (next) {
        try {
          const value = await next.action();
          next.resolve(value);
        } catch {
          next.resolve(undefined);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-authentication failed");
    } finally {
      setBusy(false);
    }
  }, [pending]);

  const cancel = useCallback(() => {
    pending?.resolve(undefined);
    setOpen(false);
    setPending(null);
    setError(null);
  }, [pending]);

  const modal = <ReAuthModal open={open} busy={busy} error={error} onCancel={cancel} onSubmit={submit} />;
  return { requireReAuth, modal };
}
