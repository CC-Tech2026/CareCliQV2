import { workerFetch } from "@/lib/worker-fetch";

export type WorkerProfile = {
  id: string;
  email: string;
  full_name?: string | null;
  role: string;
  organization_id?: string | null;
  phone?: string | null;
  business_name?: string | null;
  profile_photo_url?: string | null;
  employee_id?: string | null;
  membership_role?: string | null;
};

export function getWorkerProfile() {
  return workerFetch<WorkerProfile>("/api/users/me");
}
