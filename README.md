# CodeFlow

A lightweight, real-time collaborative coding app. Share a room link, edit Python code together, and run it with shared output—no sign-up, no heavy IDE.

## What it does

- **Shared rooms** – Create or join a room by URL (e.g. `/r/demo`). Everyone in the room sees the same code and edits in real time.
- **Run code** – Run the current Python code with one click. Stdout, stderr, and exit code are shown to everyone in the room.
- **Minimal setup** – No accounts or database. Open the app, share the link, start coding.

## Why it was made

CodeFlow was built to let people **collaborate on code** without installing anything or using a full IDE. It’s a **lightweight option**: in-memory state, no auth, and a simple stack (Node, Socket.IO, static frontend) so you can run it locally or deploy it easily for pair programming, teaching, or quick shared snippets.

## Tech overview

- **Backend:** Node.js, Express, Socket.IO. Serves the frontend from `public/`, keeps room state in memory, runs Python via subprocess with time and size limits.
- **Frontend:** Plain HTML/CSS/JS (Bootstrap for layout). Connects to Socket.IO, syncs editor content and run output by room.

## Important files

Each important file has a short comment at the top describing its role. Summary:

| File | Role |
|------|------|
| `server.js` | Backend: static serving, Socket.IO rooms, Python execution, rate limits. |
| `public/index.html` | Main app shell: landing + in-app UI (editor, run button, output). |
| `public/client.js` | Frontend logic: Socket.IO connection, room from URL, editor sync, run request, output display. |
| `public/styles.css` | Layout and styling for landing and app (Bootstrap + custom). |
| `public/feedback.html` | Standalone feedback page; links back to app. |

## Run locally

```bash
npm install
node server.js
```

Open `http://localhost:3000`. Python 3 must be installed for the Run feature.

## Deploy

The app can be deployed to Fly.io (or similar) using a Dockerfile that includes both Node and Python. See the deployment notes in the repo or use the Dockerfile and `server.listen(PORT, '0.0.0.0', ...)` for cloud hosting.
