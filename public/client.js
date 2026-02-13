// client.js – CodeFlow frontend logic.
// Core: Connects to Socket.IO; reads room from URL (/r/:roomId or ?room=); joins room, syncs editor
// and run output with server; handles Create Room (redirect to /r/:id), Run button, copy link, connection status.

const socket = io();

const landingSection = document.getElementById('landing');
const appSection = document.getElementById('app');
const startCollabButton = document.getElementById('start-collab-button');
const copyLinkButtonApp = document.getElementById('copy-link-button-app');
const shareableLinkInput = document.getElementById('shareable-link');
const roomLabel = document.getElementById('room-label');
const userCountEl = document.getElementById('user-count');
const editor = document.getElementById('editor');
const runButton = document.getElementById('run-button');
const runStatusEl = document.getElementById('run-status');
const outputStdout = document.getElementById('output-stdout');
const outputStderr = document.getElementById('output-stderr');
const outputExit = document.getElementById('output-exit');
const outputTruncated = document.getElementById('output-truncated');
const outputInputTip = document.getElementById('output-input-tip');
const copyFeedback = document.getElementById('copy-feedback');
const clearOutputButton = document.getElementById('clear-output-button');
const connectionStatus = document.getElementById('connection-status');

let currentRoomId = null;
let runStatus = 'idle'; // 'idle' | 'running' | 'done' | 'error'

// Prefer pathname /r/:id; fallback to query ?room=
function getRoomFromUrl() {
  const path = window.location.pathname;
  if (path.startsWith('/r/')) {
    const id = path.slice(3).trim();
    return id.length > 0 ? id : null;
  }
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (!room) return null;
  const trimmed = room.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Only used when we enter a room via ?room= (keep URL in sync). Not used for /r/:roomId.
function setRoomInUrl(roomId) {
  const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
  window.history.replaceState(null, '', url);
}

function generateRoomId() {
  return `room-${Math.random().toString(36).slice(2, 8)}`;
}

function showLanding() {
  landingSection.style.display = 'flex';
  appSection.style.display = 'none';
  roomLabel.textContent = '';
}

function enterRoom(roomId) {
  currentRoomId = roomId;
  // Update URL to /r/:roomId without reload so shareable link is correct and refresh keeps you in room.
  const url = `${window.location.origin}/r/${currentRoomId}`;
  window.history.replaceState(null, '', url);
  shareableLinkInput.value = url;

  landingSection.style.display = 'none';
  appSection.style.display = 'flex';

  roomLabel.textContent = `Room: ${currentRoomId}`;

  socket.emit('joinRoom', { roomId: currentRoomId });
}

function setRunStatus(status) {
  runStatus = status;
  runStatusEl.textContent = status === 'idle' ? 'Idle' : status === 'running' ? 'Running' : status === 'done' ? 'Done' : 'Error';
  runButton.disabled = status === 'running';
}

function renderOutput(result) {
  if (!result) {
    outputStdout.textContent = '';
    outputStderr.textContent = '';
    outputExit.textContent = '';
    outputTruncated.textContent = '';
    outputInputTip.style.display = 'none';
    outputInputTip.textContent = '';
    return;
  }
  outputStdout.textContent = result.stdout || '';
  outputStderr.textContent = result.stderr || '';
  outputExit.textContent = result.exitCode != null ? `Exit code: ${result.exitCode}` : '';
  outputTruncated.textContent = result.truncated ? '(output truncated)' : '';
  const showInputTip = result.stderr && result.stderr.includes('EOF when reading a line');
  if (showInputTip) {
    outputInputTip.textContent = 'Tip: input() isn\'t supported here. Use variables or a list of values instead.';
    outputInputTip.style.display = 'block';
  } else {
    outputInputTip.style.display = 'none';
    outputInputTip.textContent = '';
  }
}

function clearOutputUI() {
  renderOutput(null);
}

// A small helper to debounce a high-frequency function call.
// We use this so that typing in the textarea doesn't emit a
// Socket.IO event for every single keystroke.
function debounce(fn, delayMs) {
  let timeoutId;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

// Emit the current editor content to the server.
// This function will be wrapped in a debounce.
function sendCodeChange() {
  if (!currentRoomId) return;

  socket.emit('codeChange', {
    roomId: currentRoomId,
    code: editor.value
  });
}

// Create a debounced version of sendCodeChange with a 250ms delay.
const debouncedSendCodeChange = debounce(sendCodeChange, 250);

// Create Room: stay on same page, show app immediately (no redirect). Update URL so shareable link is /r/:roomId.
startCollabButton.addEventListener('click', () => {
  const newRoomId = generateRoomId();
  enterRoom(newRoomId);
});

function showCopyFeedback(message, isError) {
  copyFeedback.textContent = message;
  copyFeedback.className = 'copy-feedback small ' + (isError ? 'text-danger' : 'text-success');
  copyFeedback.style.visibility = 'visible';
  clearTimeout(copyFeedback._hideTimer);
  copyFeedback._hideTimer = setTimeout(() => {
    copyFeedback.textContent = '';
    copyFeedback.style.visibility = 'hidden';
  }, 2500);
}

function copyCurrentLink() {
  const link = shareableLinkInput?.value || window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(() => {
      showCopyFeedback('Link copied');
    }).catch(() => {
      showCopyFeedback('Couldn\'t copy', true);
    });
  } else {
    showCopyFeedback('Couldn\'t copy', true);
  }
}

copyLinkButtonApp.addEventListener('click', copyCurrentLink);
clearOutputButton.addEventListener('click', () => {
  if (!currentRoomId) return;
  socket.emit('clearOutput', { roomId: currentRoomId });
});

// As the user types in the textarea, we send debounced updates.
// NOTE: This demo uses "last write wins". When remote updates arrive,
// they will overwrite the entire textarea content, which can move the cursor.
// That is acceptable for this MVP.
editor.addEventListener('input', () => {
  debouncedSendCodeChange();
});

runButton.addEventListener('click', () => {
  if (!currentRoomId) {
    alert('Start collaborating (to enter a room) before running code.');
    return;
  }
  if (runStatus === 'running') return;
  socket.emit('runCode', { roomId: currentRoomId, code: editor.value });
});

// --- Socket.IO event handlers ---

// Basic connection status indicators.
socket.on('connect', () => {
  connectionStatus.textContent = 'Connected';
  connectionStatus.style.color = '#22c55e';
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'Disconnected';
  connectionStatus.style.color = '#f97316';
});

socket.on('roomState', (state) => {
  if (typeof state.code === 'string') editor.value = state.code;
  renderOutput(state.lastRunResult || null);
  setRunStatus(state.lastRunResult ? (state.lastRunResult.status === 'Error' ? 'error' : 'done') : 'idle');
});

// When another client changes the code, we are notified via "codeUpdate".
socket.on('codeUpdate', (payload) => {
  if (!payload || typeof payload.code !== 'string') return;

  // Only update the textarea if the content is actually different.
  // This avoids some unnecessary cursor jumps.
  if (editor.value !== payload.code) {
    editor.value = payload.code;
  }
});

socket.on('runStatus', (payload) => {
  if (payload && payload.status === 'Running') setRunStatus('running');
});

socket.on('runResult', (payload) => {
  if (!payload) return;
  setRunStatus(payload.status === 'Error' ? 'error' : 'done');
  renderOutput(payload);
});

socket.on('outputCleared', () => {
  clearOutputUI();
  setRunStatus('idle');
});

socket.on('userCount', (payload) => {
  const n = payload && typeof payload.count === 'number' ? payload.count : 0;
  userCountEl.textContent = n === 1 ? '1 user in room' : `${n} users in room`;
});

// On first load:
// - If the URL already has ?room=..., go straight into that room (no extra clicks).
// - Otherwise, show the clean landing page.
window.addEventListener('load', () => {
  const existingRoom = getRoomFromUrl();

  if (existingRoom) {
    // Link already contains a room; immediately join it.
    enterRoom(existingRoom);
  } else {
    // No room in the URL: show landing.
    showLanding();
  }
});

// When user switches back to this tab, request current count so we show the right number
// even if the disconnect event was delayed or the broadcast didn't arrive.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentRoomId) {
    socket.emit('userCountRequest', { roomId: currentRoomId });
  }
});

