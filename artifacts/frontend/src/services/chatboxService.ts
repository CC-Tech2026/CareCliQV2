import { jsonFetch } from "@/services/http";

export interface StatBlock {
  type: "stat";
  label: string;
  value: number | string | null;
  target?: number | null;
}

export interface TableBlock {
  type: "table";
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export interface BarChartBlock {
  type: "bar_chart";
  title: string;
  x_key: string;
  series: { key: string; label: string }[];
  data: Record<string, string | number>[];
}

export interface DownloadBlock {
  type: "download";
  title: string;
  url: string;
  count?: number | null;
}

export type ChatBlock = StatBlock | TableBlock | BarChartBlock | DownloadBlock;

export interface ChatResponse {
  reply: string;
  thread_id: string;
  blocks: ChatBlock[];
}

export function sendChatMessage(message: string, threadId?: string) {
  return jsonFetch<ChatResponse>("/api/chatbox/chat", {
    method: "POST",
    body: JSON.stringify({ message, thread_id: threadId }),
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
