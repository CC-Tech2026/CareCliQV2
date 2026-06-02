import { jsonFetch } from "@/services/http";

export type ReAuthResponse = {
  reauthenticated: boolean;
  reauthenticated_until: string;
  reauth_token: string;
};

export function reauthenticate(password: string) {
  return jsonFetch<ReAuthResponse>("/api/security/reauthenticate", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}
