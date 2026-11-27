import { jsonFetch } from "@/services/http";

/** The topic a block belongs to ("Compliance", "Incidents"...), so an answer
 * that drew on several tools can show its detail grouped. Older saved
 * answers have none. */
interface BlockBase {
  section?: string;
}

export interface StatBlock extends BlockBase {
  type: "stat";
  label: string;
  value: number | string | null;
  /** A number reads as "/ 90 target"; text is shown as written, e.g. "48% of plan time". */
  target?: number | string | null;
}

export interface TableBlock extends BlockBase {
  type: "table";
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export interface BarChartBlock extends BlockBase {
  type: "bar_chart";
  title: string;
  x_key: string;
  series: { key: string; label: string }[];
  data: Record<string, string | number>[];
}

export interface DownloadBlock extends BlockBase {
  type: "download";
  title: string;
  url: string;
  count?: number | null;
}

/** A report, template or letter Quill wrote, in Markdown. */
export interface DocumentBlock extends BlockBase {
  type: "document";
  title: string;
  document_type: "report" | "template" | "letter" | "checklist" | "summary" | "other";
  content: string;
}

export type ChatBlock = StatBlock | TableBlock | BarChartBlock | DownloadBlock | DocumentBlock;

/** This person's Quill credits (GET /api/chatbox/credits). */
export interface QuillCredits {
  period_start: string;
  renews_on: string;
  allowance: number;
  allowance_used: number;
  allowance_left: number;
  org_allowance: number;
  org_used: number;
  topup_balance: number;
  remaining: number;
  can_ask: boolean;
  paused_reason: string | null;
  pack: { credits: number; price_cents: number; currency: string; gst_added: boolean };
  packs_left_this_month: number;
}

export function getQuillCredits() {
  return jsonFetch<QuillCredits>("/api/chatbox/credits");
}

/** Starts Stripe Checkout for one credit pack; resolves to the Checkout URL. */
export async function startQuillTopUp(returnPath: string) {
  const res = await jsonFetch<{ checkout_url: string }>("/api/chatbox/credits/top-up", {
    method: "POST",
    body: JSON.stringify({ return_path: returnPath }),
  });
  return res.checkout_url;
}

export interface ChatResponse {
  reply: string;
  thread_id: string;
  blocks: ChatBlock[];
  /** Questions to offer next, chosen by the backend from the tools that answered. */
  suggestions?: string[];
  /** The asker's balance after this answer. */
  credits?: QuillCredits | null;
}

export function sendChatMessage(
  message: string,
  threadId?: string,
  signal?: AbortSignal,
  answerStyle?: "brief" | "detailed",
) {
  return jsonFetch<ChatResponse>("/api/chatbox/chat", {
    method: "POST",
    body: JSON.stringify({ message, thread_id: threadId, answer_style: answerStyle }),
    signal,
  });
}

export interface ThreadSummary {
  thread_id: string;
  title: string | null;
  updated_at: string;
  message_count: number;
}

export interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  /** The answer's tables and charts; empty for questions and older answers. */
  blocks?: ChatBlock[];
}

export function listChatThreads() {
  return jsonFetch<ThreadSummary[]>("/api/chatbox/threads");
}

export function getChatThreadMessages(threadId: string) {
  return jsonFetch<ThreadMessage[]>(`/api/chatbox/threads/${threadId}/messages`);
}

export function deleteChatThread(threadId: string) {
  return jsonFetch<void>(`/api/chatbox/threads/${threadId}`, { method: "DELETE" });
}

export function clearChatHistory() {
  return jsonFetch<void>("/api/chatbox/threads", { method: "DELETE" });
}
