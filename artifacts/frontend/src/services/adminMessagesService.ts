import { jsonFetch } from "@/services/http";

export type MessageCategory = "service" | "news";
export type MessageChannel = "email" | "in_app";
export type StaffRole = "managing_director" | "support_coordinator" | "support_worker";
export type StatusFilter = "trial" | "paying" | "free_access" | "not_billed" | "needs_attention" | "payment_trouble";

export type Audience = {
  orgs: "all" | "status" | "selected";
  status?: StatusFilter | null;
  org_ids: string[];
  roles: StaffRole[];
};

export type MessageDraft = {
  subject: string;
  body: string;
  category: MessageCategory;
  channels: MessageChannel[];
  button_label?: string | null;
  button_url?: string | null;
};

export type MessageTemplate = { key: string; name: string; category: MessageCategory; subject: string; body: string };

export type AudiencePreview = {
  org_count: number;
  organizations: string[];
  recipient_count: number;
  will_email: number;
  opted_out: number;
  by_role: Partial<Record<StaffRole, number>>;
  sample: { to: string; organisation: string; subject: string; text: string };
  email_delivery: { status: string; message: string };
};

export type DeliveryCounts = Partial<Record<"queued" | "sent" | "failed" | "in_app_only" | "opted_out", number>>;

export type SentMessage = {
  id: string;
  subject: string;
  category: MessageCategory;
  channels: MessageChannel[];
  audience: Audience & { status?: StatusFilter | null };
  status: "sending" | "sent";
  recipient_count: number;
  org_count: number;
  created_at: string;
  sent_at: string | null;
  delivery: DeliveryCounts;
};

export type MessageRecipient = {
  id: string;
  organization_id: string | null;
  organization_name: string;
  email: string;
  full_name: string | null;
  role: string | null;
  status: keyof DeliveryCounts;
  error: string | null;
  sent_at: string | null;
};

export type MessageDetail = SentMessage & {
  body: string;
  button_label: string | null;
  button_url: string | null;
  recipients: MessageRecipient[];
};

export type Banner = {
  id: string;
  message: string;
  tone: "info" | "warning";
  audience: "everyone" | "directors";
  link_label: string | null;
  link_url: string | null;
  starts_at: string;
  ends_at: string;
};

export type PlatformActivity = {
  action_type: string;
  actor_name: string;
  organization_id: string | null;
  organization_name: string;
  after_state: Record<string, unknown> | null;
  details: { reason?: string } | null;
  created_at: string;
};

export type SystemStatus = {
  email: { status: string; message: string; queue: { pending?: number; sent?: number; failed?: number; max_size?: number } };
  database: { checked: boolean | null; up_to_date: boolean | null; pending: string[]; latest_migration: number | null };
  stripe: { mode: "live" | "test" | "not_set" };
  reminders: { scheduler_on: boolean };
  site: { url: string };
  counts: { organizations: number | null; active_staff: number };
  checked_at: string;
};

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

export const getMessageTemplates = () => jsonFetch<{ templates: MessageTemplate[] }>("/api/admin/messages/templates");
export const previewMessage = (message: MessageDraft, audience: Audience) =>
  jsonFetch<AudiencePreview>("/api/admin/messages/preview", post({ message, audience }));
export const sendTestMessage = (message: MessageDraft) =>
  jsonFetch<{ to: string; status: string; message: string }>("/api/admin/messages/test", post(message));
export const sendMessage = (message: MessageDraft, audience: Audience) =>
  jsonFetch<{ id: string; recipient_count: number; org_count: number; queued: number; failed: number }>("/api/admin/messages", post({ message, audience }));
export const listMessages = () => jsonFetch<{ messages: SentMessage[]; needs_migration: boolean }>("/api/admin/messages");
export const getMessage = (id: string) => jsonFetch<MessageDetail>(`/api/admin/messages/${id}`);
export const retryMessage = (id: string) => jsonFetch<{ requeued: number }>(`/api/admin/messages/${id}/retry`, { method: "POST" });

export const listBanners = () => jsonFetch<{ banners: Banner[]; needs_migration: boolean }>("/api/admin/banners");
export const createBanner = (b: Omit<Banner, "id" | "starts_at"> & { starts_at?: string }) =>
  jsonFetch<Banner>("/api/admin/banners", post(b));
export const endBanner = (id: string) => jsonFetch<{ ok: boolean }>(`/api/admin/banners/${id}/end`, { method: "POST" });

export const getPlatformActivity = (organizationId?: string) =>
  jsonFetch<{ activity: PlatformActivity[] }>(`/api/admin/activity${organizationId ? `?organization_id=${organizationId}` : ""}`);
export const getSystemStatus = () => jsonFetch<SystemStatus>("/api/admin/system");

export const getCurrentBanners = () => jsonFetch<{ banners: Banner[] }>("/api/platform/banners");
