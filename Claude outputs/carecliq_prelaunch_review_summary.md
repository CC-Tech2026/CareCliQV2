# CareCliQ Pre-Launch Review — Summary for Supervisor

**What I did:** As part of getting ready for launch, I logged into the live dev site (carecliq-dev.pages.dev) and clicked through the main sections a real user would use — Hub, Dashboard, Billing, Incidents, and Compliance — to look for anything that would confuse or worry a customer. I also tested what happens when someone tries to log in from scratch (a brand new browser session, no saved login), since that's the very first experience every new customer will have.

**How I tested it:** I used a browser automation tool that clicks, types, and takes screenshots the same way a person using a mouse and keyboard would. I visually inspected what came back, and for the login issue specifically, I also checked the browser's technical logs (console errors) and network activity to see whether the login attempt even reached our server — it didn't, which is a stronger signal than just "it looked stuck."

**Important caveat to flag up front:** I'm not a formal QA tester and this wasn't an exhaustive test suite — it was a manual walkthrough. Everything below should be independently verified by someone on the dev team before we treat it as confirmed. I've noted my confidence level on each item.

---

## Top priority — needs verification today

**1. New users may not be able to log in.**
When I opened the site in a browser with no saved login (simulating a brand-new customer), clicking "Sign In" did nothing — no error, no page change, and no request was even sent to the server. Pressing Enter to submit the form also did nothing. I only saw this in a fresh session; my other testing was done in an already-logged-in session, so I can't rule out that this is specific to how the automated tool interacts with the page rather than a bug every real user would hit.
*Confidence: Medium — worth someone manually testing in an incognito window today, before anything else on this list.*

**2. "Forgot password?" doesn't do anything.**
Same fresh session — clicking it doesn't open a reset flow or navigate anywhere. If a real customer forgets their password, they currently have no way to recover their account.
*Confidence: Medium-high (clear, repeatable, no response observed).*

**3. Broken pages have no way back.**
Some direct links (e.g., a Participants page URL) show a "Page Not Found" screen — that's fine on its own, but the page's own "Go to Dashboard" button, which is supposed to rescue the user, also doesn't do anything. So a user who lands on an error page is stuck.
*Confidence: High — directly observed and repeatable.*

---

## Should fix before launch — visible to every user

**4. The numbers on the sidebar don't match reality.**
The left menu shows "157" next to Compliance and "12" next to Incidents, but when you open those sections, the actual counts don't match (Incidents only lists 4 items, for example). This is the kind of thing that makes an app feel untrustworthy the moment someone notices — like your phone showing "20 unread" when your inbox is empty.
*Confidence: High — directly observed with screenshots.*

**5. Compliance alerts are cut off mid-sentence.**
On the main Hub page, some compliance warnings just stop with "..." partway through, like "Reportable incident: Fall..." — you can't read the rest without doing something else first. Since these are safety/compliance-related alerts, hiding the ending is a real risk, not just a cosmetic issue.
*Confidence: High.*

**6. A raw database field name is showing instead of a proper label.**
One item shows the text "ndis_screening" (the internal computer name) instead of something like "NDIS Screening." Small thing, but it looks unfinished.
*Confidence: High.*

**7. The notification bell is stuck on "80."**
It didn't change no matter which page I was on. Either it's not counting correctly or it's not wired up yet.
*Confidence: Medium — I only checked across a handful of pages in one session, didn't confirm root cause.*

---

## Worth a look, lower urgency

**8. A compliance score didn't match the checkmarks.**
One staff member had every certification marked complete and current, but their overall compliance score was only 54.8/100 — seems like the scoring formula might have a bug. Worth having whoever owns that logic double check it.
*Confidence: Medium — I observed the mismatch but didn't investigate the underlying formula.*

**9. Placeholder-looking name in the dashboard.**
One entry just says "Worker" instead of a real name. I traced it and it looks like it's actually someone's test-data last name (e.g., "Amara Worker"), not a broken field — but it reads as broken to anyone glancing at it, so it's worth swapping in more realistic sample names before demos.
*Confidence: Medium — plausible explanation found, not fully confirmed.*

---

## Not yet resolved / needs follow-up

- I couldn't confirm or rule out sideways-scrolling layout issues on the Dashboard.
- I wasn't able to properly test how the site looks on a phone screen — the tool I used to simulate a smaller screen didn't actually change what was displayed. Recommend someone check this manually on an actual phone before launch.

---

**Suggested next step:** Have someone from engineering manually try logging in from a fresh/incognito browser today to confirm or rule out item #1 — that one has the highest potential impact if it's real. The rest can be triaged in the normal pre-launch bug review.
