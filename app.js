/* ─── NIM Chat — app.js ──────────────────────────────────── */
'use strict';

// ── State ──────────────────────────────────────────────────
const state = {
  messages: [],       // Full conversation history (including system)
  isLoading: false,
  selectedModel: '',
  persona: '',
  temperature: 0.7,
  maxTokens: 1024,
};

// ── DOM refs ───────────────────────────────────────────────
const els = {
  menuBtn:         document.getElementById('menuBtn'),
  newChatBtn:      document.getElementById('newChatBtn'),
  settingsDrawer:  document.getElementById('settingsDrawer'),
  drawerOverlay:   document.getElementById('drawerOverlay'),
  drawerClose:     document.getElementById('drawerClose'),
  modelSelect:     document.getElementById('modelSelect'),
  refreshModels:   document.getElementById('refreshModels'),
  personaInput:    document.getElementById('personaInput'),
  tempSlider:      document.getElementById('tempSlider'),
  tempValue:       document.getElementById('tempValue'),
  maxTokensSlider: document.getElementById('maxTokensSlider'),
  maxTokensValue:  document.getElementById('maxTokensValue'),
  clearChat:       document.getElementById('clearChat'),
  headerModelName: document.getElementById('headerModelName'),
  chatContainer:   document.getElementById('chatContainer'),
  messagesList:    document.getElementById('messagesList'),
  welcomeState:    document.getElementById('welcomeState'),
  messageInput:    document.getElementById('messageInput'),
  sendBtn:         document.getElementById('sendBtn'),
};

// ── Markdown config ────────────────────────────────────────
if (window.marked) {
  marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false,
  });
}

// ── LocalStorage helpers ───────────────────────────────────
const LS = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ── Toast notification ─────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400);
}

// ── Settings Drawer ────────────────────────────────────────
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
els.drawerOverlay.addEventListener('click', closeDrawer);

// ── Model Selection ────────────────────────────────────────
async function fetchModels() {
  els.modelSelect.innerHTML = '<option value="">Loading…</option>';
  try {
    const res = await fetch('/api/models');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const models = (data.data || [])
      .map(m => m.id)
      .filter(Boolean)
      .sort();

    els.modelSelect.innerHTML = models.length
      ? models.map(id => `<option value="${escHtml(id)}">${escHtml(id)}</option>`).join('')
      : '<option value="">No models found</option>';

    // Restore saved selection
    const saved = LS.get('nim_model', '');
    if (saved && models.includes(saved)) {
      els.modelSelect.value = saved;
      state.selectedModel = saved;
    } else if (models.length) {
      state.selectedModel = models[0];
      els.modelSelect.value = models[0];
      LS.set('nim_model', models[0]);
    }
    updateHeaderModel();
  } catch (err) {
    els.modelSelect.innerHTML = '<option value="">Failed to load</option>';
    showToast('Could not fetch models');
    console.error('Model fetch error:', err);
  }
}

els.modelSelect.addEventListener('change', () => {
  state.selectedModel = els.modelSelect.value;
  LS.set('nim_model', state.selectedModel);
  updateHeaderModel();
});

els.refreshModels.addEventListener('click', () => fetchModels());

function updateHeaderModel() {
  const short = state.selectedModel
    ? state.selectedModel.split('/').pop() || state.selectedModel
    : 'NIM Chat';
  els.headerModelName.textContent = short;
}

// ── Persona ────────────────────────────────────────────────
els.personaInput.addEventListener('input', () => {
  state.persona = els.personaInput.value.trim();
  LS.set('nim_persona', state.persona);
});

// ── Parameters ────────────────────────────────────────────
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

// ── Clear / New Chat ───────────────────────────────────────
function clearConversation() {
  state.messages = [];
  els.messagesList.innerHTML = '';
  els.welcomeState.classList.remove('hidden');
  showToast('Conversation cleared');
}

els.clearChat.addEventListener('click', () => {
  clearConversation();
  closeDrawer();
});

els.newChatBtn.addEventListener('click', clearConversation);

// ── Input auto-resize ──────────────────────────────────────
els.messageInput.addEventListener('input', () => {
  els.messageInput.style.height = 'auto';
  els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 160)}px`;
  els.sendBtn.disabled = els.messageInput.value.trim() === '' || state.isLoading;
});

els.messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!els.sendBtn.disabled) handleSend();
  }
});

els.sendBtn.addEventListener('click', handleSend);

// ── Scroll helpers ─────────────────────────────────────────
let userScrolledUp = false;

els.chatContainer.addEventListener('scroll', () => {
  const el = els.chatContainer;
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  userScrolledUp = distFromBottom > 80;
});

function scrollToBottom(force = false) {
  if (!userScrolledUp || force) {
    els.chatContainer.scrollTop = els.chatContainer.scrollHeight;
  }
}

// ── Escape HTML ────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Render message bubble ──────────────────────────────────
function createMessageEl(role, content, isStreaming = false) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? 'You' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (isStreaming) bubble.classList.add('streaming-cursor');

  if (role === 'user') {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = window.marked ? marked.parse(content) : escHtml(content).replace(/\n/g, '<br>');
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  return { wrapper, bubble };
}

function appendUserMessage(content) {
  els.welcomeState.classList.add('hidden');
  const { wrapper } = createMessageEl('user', content);
  els.messagesList.appendChild(wrapper);
  scrollToBottom(true);
}

function appendThinking() {
  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant';
  wrapper.id = 'thinking-indicator';

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = `
    <div class="thinking-dots">
      <span></span><span></span><span></span>
    </div>`;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  els.messagesList.appendChild(wrapper);
  scrollToBottom(true);
  return wrapper;
}

function removeThinking() {
  const el = document.getElementById('thinking-indicator');
  if (el) el.remove();
}

// ── Build messages array ───────────────────────────────────
function buildMessages(userText) {
  const msgs = [];
  if (state.persona) {
    msgs.push({ role: 'system', content: state.persona });
  }
  msgs.push(...state.messages);
  msgs.push({ role: 'user', content: userText });
  return msgs;
}

// ── Send & Inference ───────────────────────────────────────
async function handleSend() {
  const text = els.messageInput.value.trim();
  if (!text || state.isLoading) return;

  if (!state.selectedModel) {
    showToast('Please select a model first');
    openDrawer();
    return;
  }

  // UI: lock
  state.isLoading = true;
  els.sendBtn.disabled = true;
  els.messageInput.value = '';
  els.messageInput.style.height = 'auto';
  userScrolledUp = false;

  // Render user message
  appendUserMessage(text);

  // Optimistically push to history
  state.messages.push({ role: 'user', content: text });

  // Show thinking
  const thinkingEl = appendThinking();
  scrollToBottom(true);

  try {
    const payload = {
      model: state.selectedModel,
      messages: buildMessages(text).slice(0, -1).concat([{ role: 'user', content: text }]),
      // Re-use already-pushed user; rebuild cleanly:
      temperature: state.temperature,
      max_tokens: state.maxTokens,
      stream: true,
    };

    // Rebuild correctly (include system + history)
    payload.messages = [];
    if (state.persona) payload.messages.push({ role: 'system', content: state.persona });
    // history is state.messages which already has the new user turn pushed
    payload.messages.push(...state.messages);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API error ${res.status}: ${errText}`);
    }

    removeThinking();

    // Create assistant bubble
    const { wrapper, bubble } = createMessageEl('assistant', '', true);
    els.messagesList.appendChild(wrapper);
    scrollToBottom(true);

    let fullText = '';
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream') || res.body) {
      // Stream parsing
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') continue;
          try {
            const chunk = JSON.parse(raw);
            const delta = chunk?.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              bubble.classList.remove('streaming-cursor'); // remove before re-render
              bubble.innerHTML = window.marked
                ? marked.parse(fullText)
                : escHtml(fullText).replace(/\n/g, '<br>');
              bubble.classList.add('streaming-cursor');
              if (!userScrolledUp) scrollToBottom();
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } else {
      // Non-streaming fallback
      const data = await res.json();
      fullText = data?.choices?.[0]?.message?.content || '';
      bubble.innerHTML = window.marked
        ? marked.parse(fullText)
        : escHtml(fullText).replace(/\n/g, '<br>');
    }

    // Remove cursor
    bubble.classList.remove('streaming-cursor');

    // Save assistant turn
    if (fullText) {
      state.messages.push({ role: 'assistant', content: fullText });
    }

    scrollToBottom(true);

  } catch (err) {
    removeThinking();
    // Remove the user message from history on failure to avoid broken state
    state.messages.pop();

    const errorWrapper = document.createElement('div');
    errorWrapper.className = 'message assistant';
    const errAvatar = document.createElement('div');
    errAvatar.className = 'msg-avatar';
    errAvatar.textContent = 'AI';
    const errBubble = document.createElement('div');
    errBubble.className = 'msg-bubble';
    errBubble.style.color = 'var(--danger)';
    errBubble.style.fontSize = '13.5px';
    errBubble.textContent = `Error: ${err.message}`;
    errorWrapper.appendChild(errAvatar);
    errorWrapper.appendChild(errBubble);
    els.messagesList.appendChild(errorWrapper);
    scrollToBottom(true);

    console.error('Chat error:', err);
    showToast('Request failed — check console');
  } finally {
    state.isLoading = false;
    els.sendBtn.disabled = els.messageInput.value.trim() === '';
  }
}

// ── Load persisted settings ────────────────────────────────
function loadSettings() {
  // Persona
  state.persona = LS.get('nim_persona', '');
  els.personaInput.value = state.persona;

  // Temperature
  state.temperature = LS.get('nim_temperature', 0.7);
  els.tempSlider.value = state.temperature;
  els.tempValue.textContent = parseFloat(state.temperature).toFixed(2);

  // Max tokens
  state.maxTokens = LS.get('nim_max_tokens', 1024);
  els.maxTokensSlider.value = state.maxTokens;
  els.maxTokensValue.textContent = state.maxTokens;

  // Model name shown in header (actual value restored after fetchModels)
  const savedModel = LS.get('nim_model', '');
  if (savedModel) {
    state.selectedModel = savedModel;
    updateHeaderModel();
  }
}

// ── Init ───────────────────────────────────────────────────
(async function init() {
  loadSettings();
  await fetchModels();
})();
