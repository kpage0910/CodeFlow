# CodeFlow

A simple, real-time collaborative coding app.
Create a room, share one link, write Python together, and run code with shared output.

## Overview

CodeFlow helps people code together without setup friction.
Instead of sharing screens or installing heavy tools, everyone joins the same room and sees the same editor live.

## Why This Project

I built this to make collaboration fast and accessible for:

- Pair programming
- Teaching and tutoring
- Quick debugging sessions
- Sharing small code ideas

The goal was to keep things focused: no accounts, no database, no unnecessary complexity.

## Core User Flow

1. Create or open a room URL (example: `/r/demo-room`)
2. Share the room link
3. Everyone edits the same Python code in real time
4. Click **Run**
5. Everyone sees the same output (stdout, stderr, exit code)

## System Design (High Level)

The architecture is intentionally lightweight:

- **Frontend:** Plain HTML/CSS/JavaScript with Bootstrap for UI
- **Backend:** Node.js + Express + Socket.IO
- **Execution:** Python runs in a subprocess with timeout and size limits
- **State:** In-memory room state (resets when the server restarts)

## Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | HTML, CSS, JavaScript, Bootstrap | User interface and room interactions |
| Backend | Node.js, Express, Socket.IO | Realtime syncing and room management |
| Runtime | Python 3 | Executes code submitted from the editor |

## Key Features

- Real-time shared editing
- Shared room links
- One-click Python execution
- Shared output panel for all users in the room
- Basic execution safeguards (limits and rate control)

## Project Structure

| File | Role |
| --- | --- |
| `server.js` | Backend server, Socket.IO rooms, Python execution, safety limits |
| `public/index.html` | App layout (landing page + editor/output interface) |
| `public/client.js` | Client logic for room sync, run requests, and output updates |
| `public/styles.css` | App styling and responsive layout |

## Run Locally

### Requirements

- Node.js + npm
- Python 3

### Steps

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Current Scope

This is an MVP focused on one clear workflow: collaborate on Python code in real time.
It is designed to be easy to run, easy to understand, and easy to iterate on.

## Future Improvements

Possible next steps:

- Persistent rooms (database-backed)
- Multi-language support
- Optional authentication
- Better run history and collaboration insights
