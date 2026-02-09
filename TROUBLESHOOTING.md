# Troubleshooting Guide

## Current Status

✅ **Backend is running** on http://localhost:3000
✅ **Frontend is running** on http://localhost:4200
✅ **Backend API is working** (tested with curl)
✅ **Logging is enabled** on backend

## How to Debug in Safari

1. **Enable Developer Tools** (if not already done):
   - Safari → Settings → Advanced
   - Check "Show features for web developers"

2. **Open Web Inspector**:
   - Press `⌘ + Option + I`
   - Or: Develop → Show Web Inspector

3. **Check Network Tab**:
   - Open http://localhost:4200 in Safari
   - Go to the **Network** tab in Web Inspector
   - Refresh the page (⌘ + R)
   - Look for requests to `localhost:3000/api/stocks`
   - If you see them: Click on the request to see the response
   - If you don't see them: Check the Console tab for errors

4. **Check Console Tab**:
   - Look for any red error messages
   - Common issues:
     - CORS errors (should be fixed, but check)
     - Network errors
     - TypeScript/Angular errors

## Expected Behavior

When you visit http://localhost:4200, you should see:

1. **In Network Tab**:
   - Request to `http://localhost:3000/api/stocks`
   - Status: 200 OK
   - Response: JSON array of stock data

2. **In Backend Terminal**:
   - Log message: `2026-XX-XX... - GET /api/stocks`

3. **On Page**:
   - Grid of 8 stock cards with real data
   - Apple, Google, Microsoft, Amazon, Tesla, NVIDIA, Meta, Netflix

## What to Check

### 1. Is the frontend making requests?
- Open Network tab in Safari
- Refresh the page
- Filter by "XHR" or "Fetch"
- Look for requests to localhost:3000

### 2. Are there CORS errors?
- Check Console for errors like:
  ```
  Access to fetch at 'http://localhost:3000/api/stocks' from origin 'http://localhost:4200'
  has been blocked by CORS policy
  ```
- This should NOT happen (CORS is enabled)

### 3. Are there other errors?
- Check Console for:
  - Angular errors (red text)
  - Network errors
  - 404 errors (wrong API endpoint)

## Manual Test

You can test the backend directly in Safari:

1. Open a new tab
2. Visit: http://localhost:3000/api/stocks
3. You should see JSON data with stock information

## If Nothing Shows Up

If you see a blank page or loading spinner that never ends:

1. Open Console (⌘ + Option + C)
2. Look for error messages
3. Check if there's a message like "Failed to fetch" or "Network error"

## Backend Logs

To see backend requests in real-time:

1. Open a terminal
2. Check the backend logs:
   ```bash
   tail -f /private/tmp/claude-501/-Users-tekvase-Desktop-Claude/tasks/b9895a2.output
   ```

Every request will be logged with timestamp and URL.

## Quick Fix Checklist

- [ ] Both servers are running (backend:3000, frontend:4200)
- [ ] Can access http://localhost:3000/api/health in browser (should show {"status":"ok"})
- [ ] Can access http://localhost:4200 in browser
- [ ] Web Inspector is open with Network tab visible
- [ ] Refreshed the page to trigger API calls
- [ ] Checked Console for error messages
