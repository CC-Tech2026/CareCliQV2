import { useCallback, useState } from "react";

import { reauthenticate } from "@/lib/security-api";
import { hasFreshMobileReauth, persistMobileReauthSession } from "@/lib/session";

type PendingAction<T> = {
  action: () => Promise<T>;
  resolve: (value: T | undefined) => void;
  reject: (error: unknown) => void;
};

export function useReAuth() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction<unknown> | null>(null);

  const requireReAuth = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      if (await hasFreshMobileReauth()) return await action();
    } catch (err) {
      throw err;
    }

    setError(null);
    setOpen(true);
    return new Promise<T | undefined>((resolve, reject) => {
      setPending({
        action: async () => action(),
        resolve: (value) => resolve(value as T | undefined),
        reject,
      });
    });
  }, []);

  const cancel = useCallback(() => {
    pending?.resolve(undefined);
    setOpen(false);
    setPending(null);
    setError(null);
  }, [pending]);

  const submit = useCallback(
    async (password: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await reauthenticate(password);
        await persistMobileReauthSession(result.reauth_token, result.reauthenticated_until);
        setOpen(false);
        const next = pending;
        setPending(null);
        if (next) {
          try {
            const value = await next.action();
            next.resolve(value);
          } catch (err) {
            next.reject(err);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Re-authentication failed");
      } finally {
        setBusy(false);
      }
    },
    [pending],
  );

  return {
    open,
    busy,
    error,
    requireReAuth,
    cancel,
    submit,
  };
}
