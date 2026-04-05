/* ─── NIM Chat — app.js ─── All Phases ──────────────────── */
'use strict';

// ── Constants ──────────────────────────────────────────────
const PARENT_CONTEXT = 'You are currently operating inside an application called NimChat. A Multi-Model chat interface developed by xensenx github link : https://github.com/xensenx, You are one of many models the user can dynamically select.  Be helpful, concise, and aware that the user may switch models mid-conversation. ';

// ── State ──────────────────────────────────────────────────
const state = {
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  selectedModel: '',
  activePersonaId: null,
  personas: {},
  temperature: 0.7,
  maxTokens: 1024,
  pendingFiles: [],     // { file, type:'image'|'pdf', previewUrl?, extractedText?, base64? }
  appPassword: '',      // password entered at gate
  abortController: null,// AbortController for stop generation
};

// ── Vision model heuristic ──────────────────────────────────
function isVisionModel(modelId) {
  try {
    const s = String(modelId).toLowerCase();
    return ['vision', '-vl', 'pixtral', 'llava', 'paligemma', 'kosmos'].some(k => s.includes(k));
  } catch {
    return false;
  }
}

// ── Auth helpers ────────────────────────────────────────────
function getAuthHeaders() {
  if (state.appPassword) {
    return { 'X-App-Password': state.appPassword };
  }
  return {};
}

// ── Helpers: sessions ──────────────────────────────────────
function getActiveSession() {
  return state.sessions.find(s => s.id === state.activeSessionId) || null;
}
function getActiveMessages() {
  const s = getActiveSession();
  return s ? s.messages : [];
}
function setActiveMessages(msgs) {
  const s = getActiveSession();
  if (s) s.messages = msgs;
}
function pushMessage(msg) {
  const s = getActiveSession();
  if (s) s.messages.push(msg);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function generateTitle(text) {
  return text.trim().slice(0, 46) + (text.length > 46 ? '…' : '');
}

function createSession(model) {
  return {
    id: generateId(),
    title: 'New conversation',
    model: model || state.selectedModel,
    messages: [],
    createdAt: Date.now(),
  };
}

function startNewSession() {
  const session = createSession();
  state.sessions.unshift(session);
  state.activeSessionId = session.id;
  saveSessions();
  renderSessionList();
  clearChatUI();
}

// ── LocalStorage ───────────────────────────────────────────
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function saveSessions() { LS.set('nim_sessions', state.sessions); }
function savePersonas() { LS.set('nim_personas', state.personas); }

// ── DOM refs ───────────────────────────────────────────────
const els = {
  // gate
  gateOverlay: document.getElementById('gateOverlay'),
  gateInput: document.getElementById('gateInput'),
  gateSubmit: document.getElementById('gateSubmit'),
  gateError: document.getElementById('gateError'),
  appShell: document.getElementById('appShell'),
  // sidebar
  menuBtn: document.getElementById('menuBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  settingsDrawer: document.getElementById('settingsDrawer'),
  drawerOverlay: document.getElementById('drawerOverlay'),
  drawerClose: document.getElementById('drawerClose'),
  modelSelect: document.getElementById('modelSelect'),
  refreshModels: document.getElementById('refreshModels'),
  exportChat: document.getElementById('exportChat'),
  clearChat: document.getElementById('clearChat'),
  sessionList: document.getElementById('sessionList'),
  openSettings: document.getElementById('openSettings'),
  // modal
  modalOverlay: document.getElementById('modalOverlay'),
  settingsModal: document.getElementById('settingsModal'),
  modalClose: document.getElementById('modalClose'),
  personaSelect: document.getElementById('personaSelect'),
  deletePersonaBtn: document.getElementById('deletePersonaBtn'),
  personaTitleInput: document.getElementById('personaTitleInput'),
  personaInput: document.getElementById('personaInput'),
  savePersonaBtn: document.getElementById('savePersonaBtn'),
  tempSlider: document.getElementById('tempSlider'),
  tempValue: document.getElementById('tempValue'),
  maxTokensSlider: document.getElementById('maxTokensSlider'),
  maxTokensValue: document.getElementById('maxTokensValue'),
  themeSwitcher: document.getElementById('themeSwitcher'),
  // chat
  headerModelName: document.getElementById('headerModelName'),
  chatContainer: document.getElementById('chatContainer'),
  messagesList: document.getElementById('messagesList'),
  welcomeState: document.getElementById('welcomeState'),
  scrollAnchor: document.getElementById('scrollAnchor'),
  // input
  attachBtn: document.getElementById('attachBtn'),
  fileInput: document.getElementById('fileInput'),
  attachmentStrip: document.getElementById('attachmentStrip'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  stopBtn: document.getElementById('stopBtn'),
};

// ── Markdown ───────────────────────────────────────────────
if (window.marked) {
  marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
}
function renderMd(text) {
  return window.marked ? marked.parse(text) : escHtml(text).replace(/\n/g, '<br>');
}

// ── PDF.js worker ──────────────────────────────────────────
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ─────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'info', duration = 3000) {
  let toast = document.querySelector('.toast');
  if (!toast) { toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast); }
  toast.textContent = msg;
  toast.classList.toggle('error', type === 'error');
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

// ─────────────────────────────────────────────────────────
// PASSWORD GATE
// ─────────────────────────────────────────────────────────
function showGate(errorMsg) {
  els.gateOverlay.classList.add('visible');
  els.gateError.textContent = errorMsg || '';
  els.gateInput.focus();
}

function hideGate() {
  els.gateOverlay.classList.remove('visible');
}

/**
 * Probe /api/models with the current password.
 * Returns true if the server accepted (200) or no password is needed (still 200).
 * Returns false on 401. Throws on network errors.
 */
async function probeAuth(password) {
  const headers = { 'Content-Type': 'application/json' };
  if (password) headers['X-App-Password'] = password;
  const res = await fetch('/api/models', { headers });
  return res.status !== 401;
}

async function initGate() {
  const saved = localStorage.getItem('nim_app_password') || '';
  state.appPassword = saved;

  try {
    const ok = await probeAuth(saved);
    if (ok) {
      hideGate();
    } else {
      showGate(saved ? 'Incorrect password — please try again.' : '');
    }
  } catch {
    // Network error — hide gate anyway and let the main app handle errors
    hideGate();
  }
}

// Gate submit handler
async function handleGateSubmit() {
  const pw = els.gateInput.value.trim();
  if (!pw) {
    els.gateError.textContent = 'Please enter a password.';
    return;
  }
  els.gateSubmit.disabled = true;
  els.gateError.textContent = '';

  try {
    const ok = await probeAuth(pw);
    if (ok) {
      state.appPassword = pw;
      localStorage.setItem('nim_app_password', pw);
      hideGate();
      // Reload models now that we have a valid password
      await fetchModels();
    } else {
      els.gateError.textContent = 'Incorrect password. Try again.';
      els.gateInput.select();
    }
  } catch {
    els.gateError.textContent = 'Network error — could not connect.';
  } finally {
    els.gateSubmit.disabled = false;
  }
}

els.gateSubmit.addEventListener('click', handleGateSubmit);
els.gateInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleGateSubmit();
});

// ─────────────────────────────────────────────────────────
// SIDEBAR / HISTORY DRAWER
// ─────────────────────────────────────────────────────────
function openDrawer() {
  els.settingsDrawer.classList.add('open');
  els.drawerOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  els.settingsDrawer.classList.remove('open');
  els.drawerOverlay.classList.remove('active');
  document.body.style.overflow = '';
}
els.menuBtn.addEventListener('click', openDrawer);
els.drawerClose.addEventListener('click', closeDrawer);
els.drawerOverlay.addEventListener('click', () => { closeDrawer(); closeModal(); });

// ─────────────────────────────────────────────────────────
// SETTINGS MODAL
// ─────────────────────────────────────────────────────────
function openModal() {
  els.settingsModal.classList.add('open');
  els.modalOverlay.classList.add('active');
}
function closeModal() {
  els.settingsModal.classList.remove('open');
  els.modalOverlay.classList.remove('active');
}
els.openSettings.addEventListener('click', () => { closeDrawer(); openModal(); });
els.modalClose.addEventListener('click', closeModal);
els.modalOverlay.addEventListener('click', closeModal);

// ─────────────────────────────────────────────────────────
// MODEL SELECTION
// ─────────────────────────────────────────────────────────
async function fetchModels() {
  els.modelSelect.innerHTML = '<option value="">Loading…</option>';
  try {
    const res = await fetch('/api/models', {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) {
      if (res.status === 401) {
        showGate('Session expired — please enter your password.');
        return;
      }
      const body = await safeJson(res);
      throw new Error(friendlyApiError(res.status, body));
    }
    const data = await res.json();
    const models = (data.data || []).map(m => m.id).filter(Boolean).sort();
    els.modelSelect.innerHTML = models.length
      ? models.map(id => {
          const label = escHtml(id) + (isVisionModel(id) ? ' 👁️' : '');
          return `<option value="${escHtml(id)}">${label}</option>`;
        }).join('')
      : '<option value="">No models found</option>';
    const saved = LS.get('nim_model', '');
    if (saved && models.includes(saved)) { els.modelSelect.value = saved; state.selectedModel = saved; }
    else if (models.length) { state.selectedModel = models[0]; els.modelSelect.value = models[0]; LS.set('nim_model', models[0]); }
    updateHeaderModel();
  } catch (err) {
    els.modelSelect.innerHTML = '<option value="">Failed to load</option>';
    showToast(err.message, 'error', 5000);
  }
}

els.modelSelect.addEventListener('change', () => {
  const newModel = els.modelSelect.value;
  const session = getActiveSession();
  // If mid-conversation with a different model → spawn new thread
  if (session && session.messages.length > 0 && session.model !== newModel) {
    session.model = session.model; // freeze old
    saveSessions();
    startNewSession();
    getActiveSession().model = newModel;
    saveSessions();
    showToast('New thread started for model change');
  }
  state.selectedModel = newModel;
  if (getActiveSession()) getActiveSession().model = newModel;
  LS.set('nim_model', newModel);
  updateHeaderModel();
  saveSessions();
});

els.refreshModels.addEventListener('click', () => fetchModels());

function updateHeaderModel() {
  const short = state.selectedModel ? state.selectedModel.split('/').pop() || state.selectedModel : 'NIM Chat';
  els.headerModelName.textContent = short;
}

// ─────────────────────────────────────────────────────────
// PERSONA MANAGER
// ─────────────────────────────────────────────────────────
function renderPersonaSelect(selectVal) {
  const opts = ['<option value="">— No persona —</option>'];
  Object.entries(state.personas).forEach(([id, p]) => {
    opts.push(`<option value="${escHtml(id)}">${escHtml(p.title)}</option>`);
  });
  els.personaSelect.innerHTML = opts.join('');
  if (selectVal !== undefined) els.personaSelect.value = selectVal;
}

els.personaSelect.addEventListener('change', () => {
  const id = els.personaSelect.value;
  state.activePersonaId = id || null;
  LS.set('nim_active_persona', state.activePersonaId);
  if (id && state.personas[id]) {
    els.personaTitleInput.value = state.personas[id].title;
    els.personaInput.value = state.personas[id].prompt;
  } else {
    els.personaTitleInput.value = '';
    els.personaInput.value = '';
  }
});

els.savePersonaBtn.addEventListener('click', () => {
  const title = els.personaTitleInput.value.trim();
  const prompt = els.personaInput.value.trim();
  if (!title) { showToast('Enter a persona name first', 'error'); return; }
  const id = state.activePersonaId && state.personas[state.activePersonaId] ? state.activePersonaId : generateId();
  state.personas[id] = { title, prompt };
  state.activePersonaId = id;
  LS.set('nim_active_persona', id);
  savePersonas();
  renderPersonaSelect(id);
  showToast(`Persona "${title}" saved`);
});

els.deletePersonaBtn.addEventListener('click', () => {
  const id = els.personaSelect.value;
  if (!id || !state.personas[id]) { showToast('Select a persona to delete', 'error'); return; }
  const name = state.personas[id].title;
  delete state.personas[id];
  if (state.activePersonaId === id) { state.activePersonaId = null; LS.set('nim_active_persona', null); }
  savePersonas();
  renderPersonaSelect('');
  els.personaTitleInput.value = '';
  els.personaInput.value = '';
  showToast(`Deleted "${name}"`);
});

function getActiveSystemPrompt() {
  const parts = [PARENT_CONTEXT];
  if (state.activePersonaId && state.personas[state.activePersonaId]) {
    parts.push(state.personas[state.activePersonaId].prompt);
  }
  return parts.join('\n\n');
}

// ─────────────────────────────────────────────────────────
// PARAMETERS
// ─────────────────────────────────────────────────────────
els.tempSlider.addEventListener('input', () => {
  state.temperature = parseFloat(els.tempSlider.value);
  els.tempValue.textContent = state.temperature.toFixed(2);
  LS.set('nim_temperature', state.temperature);
});
els.maxTokensSlider.addEventListener('input', () => {
  state.maxTokens = parseInt(els.maxTokensSlider.value, 10);
  els.maxTokensValue.textContent = state.maxTokens;
  LS.set('nim_max_tokens', state.maxTokens);
});

// ─────────────────────────────────────────────────────────
// THEME SWITCHER
// ─────────────────────────────────────────────────────────
els.themeSwitcher.addEventListener('click', (e) => {
  const btn = e.target.closest('.theme-btn');
  if (!btn) return;
  const theme = btn.dataset.theme;
  document.body.className = theme;
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  LS.set('nim_theme', theme);
});

function applyTheme(theme) {
  document.body.className = theme || '';
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === (theme || '')));
}

// ─────────────────────────────────────────────────────────
// SESSION LIST RENDERING
// ─────────────────────────────────────────────────────────
function renderSessionList() {
  if (!state.sessions.length) {
    els.sessionList.innerHTML = '<span class="session-empty">No previous chats</span>';
    return;
  }
  els.sessionList.innerHTML = '';
  state.sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item' + (session.id === state.activeSessionId ? ' active' : '');
    item.dataset.id = session.id;

    const info = document.createElement('div');
    info.className = 'session-info';
    const title = document.createElement('div');
    title.className = 'session-title';
    title.textContent = session.title;
    const meta = document.createElement('div');
    meta.className = 'session-meta';
    const d = new Date(session.createdAt);
    meta.textContent = `${session.model ? session.model.split('/').pop() : 'unknown'} · ${d.toLocaleDateString()}`;
    info.appendChild(title);
    info.appendChild(meta);

    const delBtn = document.createElement('button');
    delBtn.className = 'session-del';
    delBtn.title = 'Delete';
    delBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>`;
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(session.id);
    });

    item.appendChild(info);
    item.appendChild(delBtn);
    item.addEventListener('click', () => { loadSession(session.id); closeDrawer(); });
    els.sessionList.appendChild(item);
  });
}

function deleteSession(id) {
  state.sessions = state.sessions.filter(s => s.id !== id);
  if (state.activeSessionId === id) {
    if (state.sessions.length) { loadSession(state.sessions[0].id); }
    else { state.activeSessionId = null; clearChatUI(); }
  }
  saveSessions();
  renderSessionList();
}

function loadSession(id) {
  const session = state.sessions.find(s => s.id === id);
  if (!session) return;
  state.activeSessionId = id;
  clearChatUI(false);
  if (session.messages.length) {
    els.welcomeState.classList.add('hidden');
    session.messages.forEach(msg => {
      if (msg.role === 'user') appendUserMessageDOM(msg.content, msg.attachmentPreviews);
      else if (msg.role === 'assistant') appendAssistantMessageDOM(msg.content, msg.timeTaken);
    });
  }
  if (session.model && session.model !== state.selectedModel) {
    state.selectedModel = session.model;
    els.modelSelect.value = session.model;
    updateHeaderModel();
  }
  renderSessionList();
  scrollToBottom(true);
}

// ─────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────
els.exportChat.addEventListener('click', () => {
  const session = getActiveSession();
  if (!session || !session.messages.length) { showToast('Nothing to export', 'error'); return; }
  const lines = [`NIM Chat Export\nSession: ${session.title}\nModel: ${session.model}\nDate: ${new Date(session.createdAt).toLocaleString()}\n${'─'.repeat(50)}\n`];
  session.messages.forEach(m => {
    lines.push(`${m.role === 'user' ? 'USER' : 'AI'}: ${m.content}\n`);
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nimchat-${session.id}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Exported successfully');
});

// ─────────────────────────────────────────────────────────
// CLEAR / NEW CHAT
// ─────────────────────────────────────────────────────────
els.clearChat.addEventListener('click', () => {
  const session = getActiveSession();
  if (session) { session.messages = []; session.title = 'New conversation'; saveSessions(); }
  clearChatUI();
  closeDrawer();
  showToast('Conversation cleared');
});

els.newChatBtn.addEventListener('click', () => {
  const session = getActiveSession();
  if (session && !session.messages.length) return;
  startNewSession();
});

function clearChatUI(showWelcome = true) {
  const anchor = document.getElementById('scrollAnchor');
  els.messagesList.innerHTML = '';
  if (anchor) els.messagesList.appendChild(anchor);
  if (showWelcome) els.welcomeState.classList.remove('hidden');
  else els.welcomeState.classList.add('hidden');
}

// ─────────────────────────────────────────────────────────
// FILE ATTACHMENTS
// ─────────────────────────────────────────────────────────
els.attachBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', async () => {
  const files = Array.from(els.fileInput.files);
  els.fileInput.value = '';
  for (const file of files) {
    if (file.type.startsWith('image/')) await addImageAttachment(file);
    else if (file.type === 'application/pdf') await addPdfAttachment(file);
    else showToast(`Unsupported file type: ${file.name}`, 'error');
  }
  updateSendBtn();
});

async function addImageAttachment(file) {
  try {
    const { base64, previewUrl } = await compressImage(file);
    const item = { file, type: 'image', base64, previewUrl, name: file.name };
    state.pendingFiles.push(item);
    renderAttachmentChip(item);
  } catch (e) {
    showToast(`Image error: ${e.message}`, 'error');
  }
}

async function addPdfAttachment(file) {
  try {
    const text = await extractPdfText(file);
    const item = { file, type: 'pdf', extractedText: text, name: file.name };
    state.pendingFiles.push(item);
    renderAttachmentChip(item);
  } catch (e) {
    showToast(`PDF error: ${e.message}`, 'error');
  }
}

function renderAttachmentChip(item) {
  const chip = document.createElement('div');
  chip.className = 'attach-chip';
  chip.dataset.name = item.name;

  if (item.type === 'image' && item.previewUrl) {
    const img = document.createElement('img');
    img.src = item.previewUrl;
    chip.appendChild(img);
  } else {
    const icon = document.createElement('div');
    icon.className = 'attach-chip-icon';
    icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    chip.appendChild(icon);
  }

  const name = document.createElement('span');
  name.className = 'attach-chip-name';
  name.textContent = item.name;
  chip.appendChild(name);

  const rm = document.createElement('button');
  rm.className = 'attach-chip-remove';
  rm.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  rm.addEventListener('click', () => {
    state.pendingFiles = state.pendingFiles.filter(f => f !== item);
    chip.remove();
    updateSendBtn();
  });
  chip.appendChild(rm);
  els.attachmentStrip.appendChild(chip);
}

// Canvas image compression
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File read failed'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image decode failed'));
      img.onload = () => {
        const MAX = 1920;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const previewUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64 = previewUrl.split(',')[1];
        resolve({ base64, previewUrl });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// PDF text extraction via pdf.js
async function extractPdfText(file) {
  if (!window.pdfjsLib) throw new Error('PDF.js not loaded');
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join('\n\n');
}

// ─────────────────────────────────────────────────────────
// SCROLL
// ─────────────────────────────────────────────────────────
let userScrolledUp = false;
els.chatContainer.addEventListener('scroll', () => {
  const el = els.chatContainer;
  userScrolledUp = (el.scrollHeight - el.scrollTop - el.clientHeight) > 100;
});

function scrollToBottom(force = false) {
  if (!userScrolledUp || force) {
    const anchor = document.getElementById('scrollAnchor');
    if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'end' });
    else els.chatContainer.scrollTop = els.chatContainer.scrollHeight;
  }
}

// ─────────────────────────────────────────────────────────
// INPUT HANDLING
// ─────────────────────────────────────────────────────────
function updateSendBtn() {
  const hasText = els.messageInput.value.trim() !== '';
  const hasFiles = state.pendingFiles.length > 0;

  if (state.isLoading) {
    // Show stop, hide send
    els.sendBtn.style.display = 'none';
    els.stopBtn.classList.add('visible');
  } else {
    // Show send, hide stop
    els.sendBtn.style.display = '';
    els.stopBtn.classList.remove('visible');
    els.sendBtn.disabled = !hasText && !hasFiles;
  }
}

els.messageInput.addEventListener('input', () => {
  els.messageInput.style.height = 'auto';
  els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 160)}px`;
  updateSendBtn();
});

els.messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!els.sendBtn.disabled && !state.isLoading) handleSend();
  }
});

els.sendBtn.addEventListener('click', handleSend);

// Stop button handler
els.stopBtn.addEventListener('click', () => {
  if (state.abortController) {
    state.abortController.abort();
  }
});

// ─────────────────────────────────────────────────────────
// ERROR PARSING
// ─────────────────────────────────────────────────────────
async function safeJson(res) {
  try { return await res.json(); } catch { return {}; }
}

function friendlyApiError(status, body) {
  const msg = body?.error?.message || body?.message || body?.detail || '';
  const map = {
    400: `Bad request${msg ? ': ' + msg : '. The request payload was invalid.'}`,
    401: 'Authentication failed — check your NVIDIA NIM API key.',
    403: 'Access denied — your API key may not have permission for this model.',
    404: 'Model not found — it may have been removed or renamed.',
    422: `Validation error${msg ? ': ' + msg : '. Check model and message format.'}`,
    429: 'Rate limit reached — please wait a moment before retrying.',
    500: 'NIM server error — the upstream model service is having issues.',
    502: 'Gateway error — could not reach the NIM API.',
    503: 'Service unavailable — the model may be loading or at capacity.',
  };
  return map[status] || `Unexpected error ${status}${msg ? ': ' + msg : ''}`;
}

function isMultimodalError(status, body) {
  const msg = (body?.error?.message || body?.message || '').toLowerCase();
  return status === 400 && (
    msg.includes('multimodal') ||
    msg.includes('image') ||
    msg.includes('vision') ||
    msg.includes('does not support')
  );
}

// ─────────────────────────────────────────────────────────
// DOM MESSAGE HELPERS
// ─────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function appendUserMessageDOM(content, attachmentPreviews) {
  els.welcomeState.classList.add('hidden');
  const wrapper = document.createElement('div');
  wrapper.className = 'message user';
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = 'You';
  const col = document.createElement('div');
  col.className = 'msg-col';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (attachmentPreviews && attachmentPreviews.length) {
    const attRow = document.createElement('div');
    attRow.className = 'msg-attachments';
    attachmentPreviews.forEach(p => {
      if (p.type === 'image') {
        const img = document.createElement('img');
        img.className = 'msg-img-thumb';
        img.src = p.previewUrl;
        attRow.appendChild(img);
      } else {
        const tag = document.createElement('span');
        tag.style.cssText = 'font-size:12px;color:var(--text-3);background:var(--surface-2);padding:3px 8px;border-radius:4px;';
        tag.textContent = `📄 ${p.name}`;
        attRow.appendChild(tag);
      }
    });
    bubble.appendChild(attRow);
  }

  const textNode = document.createTextNode(content || '');
  bubble.appendChild(textNode);
  col.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(col);
  const anchor = document.getElementById('scrollAnchor');
  if (anchor) els.messagesList.insertBefore(wrapper, anchor);
  else els.messagesList.appendChild(wrapper);
  scrollToBottom(true);
}

function appendAssistantMessageDOM(content, timeTaken, rawMarkdown) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant';
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = 'AI';
  const col = document.createElement('div');
  col.className = 'msg-col';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = renderMd(content);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  if (timeTaken != null) {
    const t = document.createElement('span');
    t.className = 'meta-time';
    t.textContent = `${timeTaken}s`;
    meta.appendChild(t);
  }
  const copyBtn = document.createElement('button');
  copyBtn.className = 'meta-copy';
  const raw = rawMarkdown || content;
  copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(raw).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`; }, 1500);
    });
  });
  meta.appendChild(copyBtn);

  col.appendChild(bubble);
  col.appendChild(meta);
  wrapper.appendChild(avatar);
  wrapper.appendChild(col);
  const anchor = document.getElementById('scrollAnchor');
  if (anchor) els.messagesList.insertBefore(wrapper, anchor);
  else els.messagesList.appendChild(wrapper);
  return { wrapper, bubble };
}

function appendErrorDOM(title, body, detail) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant';
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = 'AI';
  const col = document.createElement('div');
  col.className = 'msg-col';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble error-bubble';
  bubble.innerHTML = `
    <div class="error-title">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      ${escHtml(title)}
    </div>
    <div class="error-body">${escHtml(body)}</div>
    ${detail ? `<code class="error-code">${escHtml(detail)}</code>` : ''}
  `;
  col.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(col);
  const anchor = document.getElementById('scrollAnchor');
  if (anchor) els.messagesList.insertBefore(wrapper, anchor);
  else els.messagesList.appendChild(wrapper);
  scrollToBottom(true);
}

function appendThinkingDOM() {
  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant';
  wrapper.id = 'thinking-indicator';
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = 'AI';
  const col = document.createElement('div');
  col.className = 'msg-col';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div>`;
  col.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(col);
  const anchor = document.getElementById('scrollAnchor');
  if (anchor) els.messagesList.insertBefore(wrapper, anchor);
  else els.messagesList.appendChild(wrapper);
  scrollToBottom(true);
}

function removeThinkingDOM() {
  const el = document.getElementById('thinking-indicator');
  if (el) el.remove();
}

// ─────────────────────────────────────────────────────────
// SEND / INFERENCE
// ─────────────────────────────────────────────────────────
async function handleSend() {
  const text = els.messageInput.value.trim();
  const files = [...state.pendingFiles];
  if ((!text && !files.length) || state.isLoading) return;

  if (!state.selectedModel) {
    showToast('Please select a model first', 'error');
    openDrawer();
    return;
  }

  // ── Vision guard ─────────────────────────────────────────
  const hasImages = files.some(f => f.type === 'image');
  if (hasImages && !isVisionModel(state.selectedModel)) {
    showToast('This model does not support images. Please select a vision model (👁️) from the sidebar.', 'error', 6000);
    openDrawer();
    return;
  }

  // Ensure active session
  if (!getActiveSession()) startNewSession();

  // Lock UI
  state.isLoading = true;
  updateSendBtn();
  els.messageInput.value = '';
  els.messageInput.style.height = 'auto';
  els.attachmentStrip.innerHTML = '';
  state.pendingFiles = [];
  userScrolledUp = false;

  // Build attachment previews for user bubble
  const attachmentPreviews = files.map(f => ({ type: f.type, previewUrl: f.previewUrl, name: f.name }));
  appendUserMessageDOM(text, attachmentPreviews);

  // Build API user content
  let userContent;
  const pdfTexts = files.filter(f => f.type === 'pdf').map(f => `[Attached Document: ${f.name}]\n${f.extractedText}`);

  if (hasImages) {
    userContent = [];
    if (text) userContent.push({ type: 'text', text });
    files.filter(f => f.type === 'image').forEach(f => {
      userContent.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${f.base64}` } });
    });
    if (pdfTexts.length) userContent.push({ type: 'text', text: pdfTexts.join('\n\n') });
  } else {
    const parts = [];
    if (text) parts.push(text);
    if (pdfTexts.length) parts.push(pdfTexts.join('\n\n'));
    userContent = parts.join('\n\n');
  }

  // Push to session history
  pushMessage({ role: 'user', content: userContent, attachmentPreviews });

  // Update session title from first user message
  const session = getActiveSession();
  if (session && session.messages.filter(m => m.role === 'user').length === 1) {
    session.title = generateTitle(text || files[0]?.name || 'File upload');
    renderSessionList();
  }

  appendThinkingDOM();

  const startTime = Date.now();

  // ── AbortController for stop generation ──────────────────
  const controller = new AbortController();
  state.abortController = controller;

  let fullText = '';

  try {
    // Build messages payload
    const msgs = [{ role: 'system', content: getActiveSystemPrompt() }];
    getActiveMessages().forEach(m => msgs.push({ role: m.role, content: m.content }));

    const payload = {
      model: state.selectedModel,
      messages: msgs,
      temperature: state.temperature,
      max_tokens: state.maxTokens,
      stream: true,
    };

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await safeJson(res);
      // Re-show gate on 401 from chat endpoint
      if (res.status === 401) {
        showGate('Session expired — please enter your password.');
        // Remove the user message we just pushed
        if (session) session.messages.pop();
        saveSessions();
        removeThinkingDOM();
        return;
      }
      if (isMultimodalError(res.status, body)) {
        throw { type: 'multimodal', status: res.status, body };
      }
      throw { type: 'api', status: res.status, body };
    }

    removeThinkingDOM();

    // Streaming assistant bubble
    const wrapper = document.createElement('div');
    wrapper.className = 'message assistant';
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = 'AI';
    const col = document.createElement('div');
    col.className = 'msg-col';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble streaming-cursor';
    col.appendChild(bubble);
    wrapper.appendChild(avatar);
    wrapper.appendChild(col);
    const anchor = document.getElementById('scrollAnchor');
    if (anchor) els.messagesList.insertBefore(wrapper, anchor);
    else els.messagesList.appendChild(wrapper);
    scrollToBottom(true);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // ── SSE streaming read loop ───────────────────────────
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') continue;
        try {
          const chunk = JSON.parse(raw);
          const delta = chunk?.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            bubble.classList.remove('streaming-cursor');
            bubble.innerHTML = renderMd(fullText);
            bubble.classList.add('streaming-cursor');
            if (!userScrolledUp) scrollToBottom();
          }
        } catch { /* ignore malformed SSE chunks */ }
      }
    }

    bubble.classList.remove('streaming-cursor');

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);

    // Metadata row
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const t = document.createElement('span');
    t.className = 'meta-time';
    t.textContent = `${timeTaken}s`;
    meta.appendChild(t);
    const copyBtn = document.createElement('button');
    copyBtn.className = 'meta-copy';
    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
    const capturedText = fullText;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(capturedText).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`; }, 1500);
      });
    });
    meta.appendChild(copyBtn);
    col.appendChild(meta);

    // Save to session
    if (fullText) {
      pushMessage({ role: 'assistant', content: fullText, timeTaken });
      saveSessions();
    }

    scrollToBottom(true);

  } catch (err) {
    removeThinkingDOM();

    // ── AbortError = user stopped generation ──────────────
    if (err && err.name === 'AbortError') {
      // Save partial text to session (if any was received)
      const streamingBubble = els.messagesList.querySelector('.streaming-cursor');
      if (streamingBubble) streamingBubble.classList.remove('streaming-cursor');
      if (fullText) {
        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
        pushMessage({ role: 'assistant', content: fullText + ' _(stopped)_', timeTaken });
        saveSessions();
      } else {
        // No text received — pop the user message we added
        const sess = getActiveSession();
        if (sess) sess.messages.pop();
        saveSessions();
      }
      // No error toast — stopping is intentional
      return;
    }

    // Pop the user message on failure
    const sess = getActiveSession();
    if (sess) sess.messages.pop();
    saveSessions();

    if (err?.type === 'multimodal') {
      appendErrorDOM(
        'Model does not support images',
        'This model does not support image analysis. Please select a vision model (👁️) from the sidebar.',
        `HTTP ${err.status}`
      );
      showToast('This model does not support image analysis. Select a vision model.', 'error', 6000);
    } else if (err?.type === 'api') {
      const friendly = friendlyApiError(err.status, err.body);
      appendErrorDOM('Request failed', friendly, `HTTP ${err.status}`);
      showToast(friendly, 'error', 5000);
    } else {
      const msg = err?.message || String(err);
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch');
      appendErrorDOM(
        isNetwork ? 'Connection error' : 'Unexpected error',
        isNetwork ? 'Could not reach the server. Check your internet connection and try again.' : msg,
        isNetwork ? '' : msg
      );
      showToast(isNetwork ? 'Connection error' : msg, 'error', 5000);
    }
  } finally {
    state.abortController = null;
    state.isLoading = false;
    updateSendBtn();
  }
}

// ─────────────────────────────────────────────────────────
// LOAD PERSISTED SETTINGS
// ─────────────────────────────────────────────────────────
function loadSettings() {
  // Sessions
  state.sessions = LS.get('nim_sessions', []);
  if (state.sessions.length) {
    state.activeSessionId = state.sessions[0].id;
  }

  // Personas
  state.personas = LS.get('nim_personas', {});
  state.activePersonaId = LS.get('nim_active_persona', null);
  renderPersonaSelect(state.activePersonaId || '');
  if (state.activePersonaId && state.personas[state.activePersonaId]) {
    els.personaTitleInput.value = state.personas[state.activePersonaId].title;
    els.personaInput.value = state.personas[state.activePersonaId].prompt;
  }

  // Temperature
  state.temperature = LS.get('nim_temperature', 0.7);
  els.tempSlider.value = state.temperature;
  els.tempValue.textContent = parseFloat(state.temperature).toFixed(2);

  // Max tokens
  state.maxTokens = LS.get('nim_max_tokens', 1024);
  els.maxTokensSlider.value = state.maxTokens;
  els.maxTokensValue.textContent = state.maxTokens;

  // Model
  const savedModel = LS.get('nim_model', '');
  if (savedModel) { state.selectedModel = savedModel; updateHeaderModel(); }

  // Theme
  applyTheme(LS.get('nim_theme', ''));

  // Render session list
  renderSessionList();

  // Load first session if any
  if (state.activeSessionId) {
    const session = getActiveSession();
    if (session && session.messages.length) loadSession(state.activeSessionId);
  }
}

// ─────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────
(async function init() {
  loadSettings();

  // ── PWA: Register Service Worker ─────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Silently fail if SW registration is unavailable (e.g. HTTP dev)
    });
  }

  // ── Password gate probe ───────────────────────────────────
  // Show gate immediately (opacity 0 → will fade in only if needed)
  // We probe auth first; if OK we never show it.
  await initGate();

  // Now load models (gate hidden = auth OK, models can load)
  await fetchModels();

  // Ensure at least one active session exists
  if (!getActiveSession()) startNewSession();
})();
