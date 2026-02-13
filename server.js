// server.js
// Minimal CodeFlow backend:
// - Serves a static frontend from ./public
// - Uses Socket.IO for realtime collaborative editing
// - Keeps all room state in memory (no database)
// - Executes Python code on demand with a strict 3-second timeout

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { spawn } = require('child_process'); // Used to execute user-provided Python code

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Safety and rate-limiting constants (in-memory, no external deps) ---
const MAX_CODE_SIZE = 50_000;
const MAX_OUTPUT_SIZE = 50_000;
const MAX_CONCURRENT_RUNS = 5;
const RATE_LIMIT_RUNS_PER_MINUTE = 20;

// Feedback form URL: override with process.env.FEEDBACK_URL if set.
const DEFAULT_FEEDBACK_URL = 'https://forms.gle/61ZU2RKBF9qAC9nZ6';
const FEEDBACK_URL = process.env.FEEDBACK_URL || DEFAULT_FEEDBACK_URL;

// Room URLs: serve the SPA so /r/room-abc123 loads the app and client can parse roomId.
// Must be registered before express.static so it takes precedence.
app.get('/r/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Feedback: redirect to Google Form (single config; open in new tab from button).
app.get('/feedback', (req, res) => {
  res.redirect(FEEDBACK_URL);
});

// Serve static files from the "public" directory (frontend lives there).
app.use(express.static('public'));

// All room state lives purely in memory as a simple JavaScript object.
// - Keys are room IDs (strings).
// - Each value is an object with:
//   - code: the full text currently in the room's editor
//   - running: true while a run is in progress (one run per room at a time)
//   - lastRunResult: { status, stdout, stderr, exitCode, truncated } for the latest run
//
// NOTE: This is intentionally ephemeral—restarting the server will clear everything.
const rooms = {};

// Map socket.id -> roomId so we can broadcast userCount on disconnect.
const socketIdToRoom = {};
// Per-room user count so we don't rely on adapter timing at disconnect.
const roomUserCount = {};

// Per-IP rate limit for run: { ip: { count, resetAt } }. Reset after 1 minute.
const runRateByIp = {};

// Global concurrent runs cap.
let activeRuns = 0;

/**
 * Helper to get or create a room entry.
 * This keeps room initialization in exactly one place.
 */
function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      code: 'print("Hello from CodeFlow")',
      running: false,
      lastRunResult: null
    };
  }
  return rooms[roomId];
}

/**
 * Truncate a string to maxLen and append a suffix if truncated.
 */
function truncateOutput(str, maxLen) {
  if (typeof str !== 'string') return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n... (output truncated)';
}

/**
 * Run arbitrary Python code using the system Python 3 interpreter.
 * - Sends code via stdin so multiline and special characters are safe.
 * - Captures stdout and stderr separately. Enforces a 3-second timeout.
 *
 * @param {string} code - Python source code to execute.
 * @param {(result: { stdout, stderr, exitCode, timedOut, signal, errorMessage? }) => void} done - Callback with structured result.
 */
function runPython(code, done) {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const child = spawn(pythonCmd, ['-u'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('error', (err) => {
    done({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      signal: null,
      errorMessage: `Failed to start Python: ${err.message}. Make sure Python 3 is installed and in your PATH.`
    });
  });

  const timeoutMs = 3000;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);

  child.on('close', (exitCode, signal) => {
    clearTimeout(timeoutId);
    done({
      stdout,
      stderr,
      exitCode: exitCode ?? null,
      timedOut,
      signal: signal || null
    });
  });

  child.stdin.write(code, (err) => {
    if (err) {
      clearTimeout(timeoutId);
      done({
        stdout: '',
        stderr: '',
        exitCode: null,
        timedOut: false,
        signal: null,
        errorMessage: `Error writing code to Python: ${err.message}`
      });
      return;
    }
    child.stdin.end();
  });
}

// Set up the Socket.IO connection handler.
// Each new browser tab that connects will trigger this function once.
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // When a client wants to join a logical "room" (e.g. "demo"),
  // we add the socket to that Socket.IO room and send back the current state.
  socket.on('joinRoom', (payload) => {
    const roomId = payload && payload.roomId ? String(payload.roomId) : 'demo';
    const room = getOrCreateRoom(roomId);

    socket.join(roomId);
    socketIdToRoom[socket.id] = roomId;
    roomUserCount[roomId] = (roomUserCount[roomId] || 0) + 1;

    console.log(`Socket ${socket.id} joined room ${roomId}`);

    socket.emit('roomState', {
      code: room.code,
      lastRunResult: room.lastRunResult
    });

    io.to(roomId).emit('userCount', { count: roomUserCount[roomId] });
  });

  // When a client has new code text, it sends the full content.
  // Reject updates that exceed max code size.
  socket.on('codeChange', (payload) => {
    if (!payload || !payload.roomId) return;

    const roomId = String(payload.roomId);
    const code = typeof payload.code === 'string' ? payload.code : '';

    if (code.length > MAX_CODE_SIZE) {
      socket.emit('codeTooLong', { max: MAX_CODE_SIZE });
      return;
    }

    const room = getOrCreateRoom(roomId);
    room.code = code;

    socket.to(roomId).emit('codeUpdate', { code });
  });

  // When a client clicks "Run", execute code with one run per room and safety guards.
  socket.on('runCode', (payload) => {
    if (!payload || !payload.roomId) return;

    const roomId = String(payload.roomId);
    const code =
      typeof payload.code === 'string'
        ? payload.code
        : getOrCreateRoom(roomId).code;

    const room = getOrCreateRoom(roomId);

    if (room.running) {
      io.to(roomId).emit('runStatus', { status: 'Running' });
      return;
    }

    if (code.length > MAX_CODE_SIZE) {
      io.to(roomId).emit('runResult', {
        status: 'Error',
        stdout: '',
        stderr: 'Code exceeds maximum size.',
        exitCode: null,
        truncated: false
      });
      return;
    }

    const ip = socket.handshake.address || socket.request?.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    if (!runRateByIp[ip]) runRateByIp[ip] = { count: 0, resetAt: now + 60_000 };
    const bucket = runRateByIp[ip];
    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + 60_000;
    }
    if (bucket.count >= RATE_LIMIT_RUNS_PER_MINUTE) {
      io.to(roomId).emit('runResult', {
        status: 'Error',
        stdout: '',
        stderr: 'Rate limit exceeded. Try again in a minute.',
        exitCode: null,
        truncated: false
      });
      return;
    }
    if (activeRuns >= MAX_CONCURRENT_RUNS) {
      io.to(roomId).emit('runResult', {
        status: 'Error',
        stdout: '',
        stderr: 'Server busy. Too many concurrent runs. Try again shortly.',
        exitCode: null,
        truncated: false
      });
      return;
    }

    room.running = true;
    bucket.count += 1;
    activeRuns += 1;
    io.to(roomId).emit('runStatus', { status: 'Running' });
    console.log(`Running code for room ${roomId}`);

    runPython(code, (result) => {
      room.running = false;
      activeRuns = Math.max(0, activeRuns - 1);

      if (result.errorMessage) {
        room.lastRunResult = {
          status: 'Error',
          stdout: '',
          stderr: result.errorMessage,
          exitCode: null,
          truncated: false
        };
        io.to(roomId).emit('runResult', room.lastRunResult);
        return;
      }

      let stdout = result.stdout || '';
      let stderr = result.stderr || '';
      const timedOut = result.timedOut;
      const exitCode = result.exitCode;
      let truncated = false;

      if (stdout.length > MAX_OUTPUT_SIZE) {
        stdout = truncateOutput(stdout, MAX_OUTPUT_SIZE);
        truncated = true;
      }
      if (stderr.length > MAX_OUTPUT_SIZE) {
        stderr = truncateOutput(stderr, MAX_OUTPUT_SIZE);
        truncated = true;
      }
      if (timedOut && !stderr.trim()) {
        stderr = `Execution timed out after 3000 ms.`;
      }

      const status = timedOut || (exitCode !== null && exitCode !== 0) ? 'Error' : 'Done';
      room.lastRunResult = {
        status,
        stdout,
        stderr,
        exitCode: exitCode ?? (timedOut ? -1 : 0),
        truncated
      };
      io.to(roomId).emit('runResult', room.lastRunResult);
    });
  });

  socket.on('clearOutput', (payload) => {
    if (!payload || !payload.roomId) return;
    const roomId = String(payload.roomId);
    const room = getOrCreateRoom(roomId);
    room.lastRunResult = null;
    io.to(roomId).emit('outputCleared');
  });

  // When a client asks for the current count (e.g. tab became visible), send it.
  socket.on('userCountRequest', (payload) => {
    const roomId = payload && payload.roomId ? String(payload.roomId) : null;
    if (!roomId) return;
    const count = roomUserCount[roomId] ?? 0;
    socket.emit('userCount', { count });
  });

  socket.on('disconnect', () => {
    const roomId = socketIdToRoom[socket.id];
    delete socketIdToRoom[socket.id];
    if (roomId) {
      roomUserCount[roomId] = Math.max(0, (roomUserCount[roomId] || 1) - 1);
      const count = roomUserCount[roomId];
      socket.to(roomId).emit('userCount', { count });
    }
    console.log('Client disconnected:', socket.id);
  });
});

// Start the HTTP server.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CodeFlow server listening on http://localhost:${PORT}`);
});

