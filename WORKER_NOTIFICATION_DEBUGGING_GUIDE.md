# Worker Notification Syncing - DEBUGGING GUIDE

## Status: Backend ✅ Working | Frontend ⚠️ Issue Found

The backend API is working correctly and returning messages. The issue is in the frontend display. Here's how to diagnose:

---

## Quick Diagnosis

### Step 1: Open Browser DevTools (F12 or Right-click → Inspect)

### Step 2: Go to Console Tab

You'll see console logs like:
```
[WorkerNotificationPanel] Fetching messages with params: {}
[WorkerNotificationPanel] Response status: 200 OK
[WorkerNotificationPanel] API returned: {messages: [...], count: 2}
[WorkerNotificationPanel] Transformed messages: {messages: [...], count: 2}
```

### Step 3: Look for Errors

Check for messages like:
- ❌ `Failed to fetch messages: 401 Unauthorized`
  - **Solution:** Auth token not being sent
  - **Check:** Network tab → look at Authorization header

- ❌ `Failed to fetch messages: 403 Forbidden`
  - **Solution:** User doesn't have permission
  - **Check:** Are you logged in as a support worker?

- ❌ `Error loading messages: ...`
  - **Solution:** Query error
  - **Check:** Read the error message details

---

## Expected Console Output (When Working)

When you open the notification panel:

```javascript
[WorkerNotificationPanel] Fetching messages with params: {}
[WorkerNotificationPanel] Response status: 200 OK
[WorkerNotificationPanel] API returned: {
  messages: [
    {id: "53d04497-...", title: "Test Message from Coordinator", ...},
    {id: "53879f73-...", title: "Credential expiring soon", ...}
  ],
  count: 2
}
[WorkerNotificationPanel] Transformed messages: {
  messages: [...],
  count: 2
}
```

---

## Step-by-Step Debugging

### 1. Check Network Request

**DevTools → Network Tab → Filter: "messages"**

Look for requests to `/api/worker/messages`

**Expected:**
- Status: `200 OK`
- Response Body:
  ```json
  {
    "messages": [
      {
        "id": "...",
        "alert_type": "coordinator_message",
        "title": "...",
        "message": "...",
        "severity": "high",
        "is_read": false,
        "created_at": "2026-06-21T..."
      }
    ],
    "count": 2
  }
  ```

**If Status is 401 or 403:**
1. Check Headers → Authorization
2. Reload page
3. Check if logged in (look for /api/auth/me response)

### 2. Check Component Rendering

**Open DevTools → React DevTools (if installed)**

Look for `WorkerNotificationPanel` component:
- `isLoading` should be false
- `error` should be null (if working)
- `messages` should have items

### 3. Check for Silent Errors

Look in console for:
- `Query error: ...`
- `API Error: ...`
- Any red error messages

### 4. Test API Directly

**In browser console:**
```javascript
fetch('/api/worker/messages', {
  credentials: 'include'
}).then(r => {
  console.log('Status:', r.status);
  return r.json();
}).then(data => {
  console.log('Data:', data);
}).catch(err => {
  console.error('Error:', err);
});
```

This will show the exact error or data returned.

---

## Current Test Data

**Created:** 2026-06-21 16:24:53 UTC

**Test Message Details:**
- Worker ID: `afb5c16f-879c-4dd5-b1ac-4308bba49d87`
- Organization: `a1111111-1111-1111-1111-111111111111`
- Title: "Test Message from Coordinator"
- Type: `coordinator_message`
- Severity: `high`
- **Is Read: FALSE** ← This should appear in the panel!

**To Verify Message Exists:**
```javascript
// In browser console:
fetch('/api/worker/messages', {credentials: 'include'})
  .then(r => r.json())
  .then(d => {
    console.log('Total messages:', d.count);
    console.log('Unread count:', d.messages.filter(m => !m.is_read).length);
    d.messages.forEach(m => console.log(`- ${m.title} (read: ${m.is_read})`));
  });
```

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "No messages yet" | Auth error silently failing | Check Network tab for 401/403 |
| Status 401 | Not logged in or token expired | Reload page, login again |
| Status 403 | Not a support_worker role | Log in as worker, not coordinator |
| Empty network request | CORS issue | Check browser console |
| Console shows error | See error message | Follow error-specific solution above |

---

## File Changes Made This Session

### Frontend
**File:** `artifacts/frontend/src/components/worker/WorkerNotificationPanel.tsx`

**Changes:**
1. ✅ Added console.log() statements to trace execution
2. ✅ Added error state to useOrgQuery hook
3. ✅ Added error display in UI (red box with error message)
4. ✅ Added credentials: "include" to fetch calls
5. ✅ Added explicit response data mapping
6. ✅ Improved error messages with full API response

**Why These Help:**
- Console logs show exactly what data is being fetched
- Error display shows if API returns error
- credentials: "include" ensures auth tokens are sent
- Explicit mapping catches data format issues

### Backend
**File:** `backend/supabase/migrations/050_fix_alerts_rls_policies.sql`

**Status:** Created, NOT YET APPLIED to database

**What It Does:**
- Adds SELECT policy so workers can see their messages
- Adds UPDATE policy so workers can mark as read
- Adds DELETE policy for cleanup

**Important:** This migration must be applied to the database for full functionality!

---

## How to Apply the Database Migration

### Option 1: Supabase Dashboard
1. Go to SQL Editor
2. Paste content of `050_fix_alerts_rls_policies.sql`
3. Click "RUN"

### Option 2: Command Line
```bash
psql "$SUPABASE_DB_URL" < backend/supabase/migrations/050_fix_alerts_rls_policies.sql
```

### Option 3: Migration Tool
```bash
cd /workspaces/Supabase-Python-Hub
./scripts/run-migrations.sh  # If you have a migration runner
```

**Verification After Migration:**
Run the diagnostic test:
```bash
python test_worker_messages_sync.py
```

Should show:
```
[5/5] Message details:
  Message 1:
    Title: Test Message from Coordinator
    Read: False
    ✓ Message 1 shown in database
```

---

## Next Steps

1. **Open Browser → DevTools (F12)**
2. **Go to Console tab**
3. **Open notification panel (click bell icon)**
4. **Look for console logs**
5. **Share the error or output**

---

## Still Not Working?

**Possible Causes (in order of likelihood):**

1. **auth/token issue**
   - Signs: Status 401 in Network tab
   - Fix: Reload page, log in again

2. **Wrong user role**
   - Signs: Logging in as coordinator instead of worker
   - Fix: Log in as support_worker role

3. **RLS policy not applied**
   - Signs: Database returns no data when queried as worker
   - Fix: Apply migration 050 to Supabase

4. **useOrgQuery hook issue**
   - Signs: API works but component doesn't display
   - Fix: Check if hook is properly fetching data

5. **Component error boundary**
   - Signs: Nothing displays, no console error
   - Fix: Check if error is being caught and hidden

---

## Recent Findings

**Verified Working:**
- ✅ Backend API returns correct data
- ✅ Database has test messages with recipient_user_id
- ✅ API query returns 2 messages for test worker
- ✅ 1 message is unread (new test message)
- ✅ Database connection working
- ✅ Supabase client working

**Issue:**
- ❌ Frontend panel shows "No messages"
- ❌ Despite backend returning messages
- ❌ Error or silent failure in frontend fetch/display

**Likely Root Cause:**
- `useOrgQuery` hook not properly executing the query
- OR fetch call failing with auth error
- OR error being caught and hidden

**Next Diagnostic Step:**
1. Check browser console for the new console.log messages
2. Share the console output
3. We can pinpoint the exact failure point

