import { describe, expect, it } from "vitest";
import { choiceOf, googleCalendarUrl, guestEmails, icsFile, isOnlineMode, outlookCalendarUrl } from "./meeting-booking";
import type { OrgEvent } from "@/services/hubService";

const event: OrgEvent = {
  id: "event-1",
  title: "NDIS plan review · Liam, Mitchell",
  event_date: "2026-11-20",
  start_time: "10:00",
  duration: "1 hour",
  event_type: "meeting",
  meeting_kind: "plan_review",
  meeting_mode: "video",
  participant_id: "participant-1",
  participant_name: "Liam Mitchell",
  attendees: [
    { email: "olivia@example.com", name: "Olivia Bennett", role: "You" },
    { email: "jess@example.com", name: "Jess Mitchell", role: "Guardian" },
  ],
};

const stamp = (s: string) => Date.parse(s.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z"));

describe("meeting formats", () => {
  it("treats only a video call as sent from the organiser's calendar", () => {
    expect(isOnlineMode("video")).toBe(true);
    expect(isOnlineMode("in_person")).toBe(false);
    expect(isOnlineMode("phone")).toBe(false);
    expect(isOnlineMode(null)).toBe(false);
  });
});

describe("calendar export", () => {
  it("uses the participant meeting type over the event type", () => {
    expect(choiceOf(event)).toBe("plan_review");
    expect(choiceOf({ event_type: "training", meeting_kind: null })).toBe("training");
  });

  it("leaves the organiser out of the guest list", () => {
    expect(guestEmails(event, "OLIVIA@example.com")).toEqual(["jess@example.com"]);
    expect(guestEmails({ attendees: [] })).toEqual([]);
  });

  it("opens Google Calendar with the length and the guests filled in", () => {
    const url = new URL(googleCalendarUrl(event, 60, ["jess@example.com"]));
    const [start, end] = url.searchParams.get("dates")!.split("/");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("add")).toBe("jess@example.com");
    expect(stamp(end) - stamp(start)).toBe(3_600_000);
  });

  it("opens Outlook with the guests filled in", () => {
    const url = new URL(outlookCalendarUrl(event, 45, ["jess@example.com", "tom@example.com"]));
    expect(url.searchParams.get("to")).toBe("jess@example.com,tom@example.com");
    expect(Date.parse(url.searchParams.get("enddt")!) - Date.parse(url.searchParams.get("startdt")!)).toBe(45 * 60_000);
  });

  it("names a phone call as the location", () => {
    const url = new URL(googleCalendarUrl({ ...event, meeting_mode: "phone", location: "0400 000 000" }, 30));
    expect(url.searchParams.get("location")).toBe("Phone call: 0400 000 000");
  });

  it("escapes text in the .ics file", () => {
    const ics = icsFile({ ...event, meeting_mode: "in_person", location: "12 Glenroy St, Woodville" }, 45);
    expect(ics).toContain("SUMMARY:NDIS plan review · Liam\\, Mitchell");
    expect(ics).toContain("LOCATION:12 Glenroy St\\, Woodville");
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
});
