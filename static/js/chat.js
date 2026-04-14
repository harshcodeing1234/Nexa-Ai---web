// ═══ STATE & MODELS ═══════════════════════════════════════════════════════════
const state = {
  currentChatId: null,
  currentModel: 'nexa-pro',
  currentTheme: localStorage.getItem('nexa_theme') || 'dark',
  allChats: [],
  tasks: [],
  isLoggedIn: false,
  isSending: false,
  isRecording: false,
  speakerEnabled: true,
  webSearchEnabled: false,
  recognition: null,
  csrfToken: null,
  sessionId: localStorage.getItem('nexa_session_id') || Math.random().toString(36).substring(7),
  searchDebounceTimer: null,
  editingMsgId: null,
  ctxMenuChatId: null,
  renamingChatId: null,
  selectedPriority: 'normal'
};

const MODELS = {
  'nexa-pro': { name: 'Nexa Pro', icon: '🧠', model: 'Meta-Llama-3.1-405B-Instruct' },
  'nexa-flash': { name: 'Nexa Flash', icon: '⚡', model: 'Meta-Llama-3.1-8B-Instruct' },
  'nexa-vision': { name: 'Nexa Vision', icon: '👁️', model: 'Qwen2-VL-72B-Instruct' },
  'nexa-code': { name: 'Nexa Code', icon: '💻', model: 'Qwen2.5-Coder-32B-Instruct' },
  'nexa-research': { name: 'Nexa Research', icon: '🔬', model: 'QwQ-32B-Preview' }
};

window.state = state;
window.MODELS = MODELS;

// ═══ API HELPERS ══════════════════════════════════════════════════════════════
async function fetchCSRFToken() {
  try {
    const res = await fetch('/api/csrf-token');
    const data = await res.json();
    state.csrfToken = data.csrf_token;
  } catch(e) {
    console.error('Failed to fetch CSRF token:', e);
  }
}

async function fetchJSON(url, method = 'GET', body = null) {
  const opts = { method, headers: {} };
  if (state.csrfToken && method !== 'GET') opts.headers['X-CSRF-Token'] = state.csrfToken;
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

window.fetchJSON = fetchJSON;

// ═══ ERROR BOUNDARY ═══════════════════════════════════════════════════════════
function initErrorBoundary() {
  window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
    fetch('/api/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken || '' },
      body: JSON.stringify({ error: e.error?.message || 'Unknown error', stack: e.error?.stack })
    }).catch(() => {});
  });
  
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    fetch('/api/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken || '' },
      body: JSON.stringify({ error: e.reason?.message || 'Promise rejection', stack: e.reason?.stack })
    }).catch(() => {});
  });
}

// Define functions in global scope by assigning to window
// This allows inline onclick="functionName()" to work with ES6 modules

// ═══ INIT ═════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  initErrorBoundary();
  await fetchCSRFToken();
  applyTheme(state.currentTheme);
  setTimeGreeting();
  await checkAuth();
  await loadChats();
  await loadTasks();
  initSpeechRecognition();
  updateModelUI();
  updateModeUI();
  switchInterface();

  document.getElementById('speaker-btn').classList.add('active');

  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('sidebar-open-btn').style.display = 'flex';
  }

  if (state.isLoggedIn && state.allChats.length > 0) {
    // Don't auto-open any chat, just show welcome screen
    document.getElementById('welcome-screen').style.display = 'flex';
  }

  // Global click: close menus
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ctx-menu') && !e.target.closest('.chat-item-btn'))
      document.getElementById('chat-ctx-menu').classList.add('hidden');
  });
  document.querySelectorAll('.overlay').forEach(el => {
    el.addEventListener('click', (e) => { if (e.target === el) el.classList.add('hidden'); });
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', handleGlobalKeys);
  
  // Register service worker for offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/sw.js').catch(() => {});
  }
});

window.handleGlobalKeys = async function(e) {
  const tag = document.activeElement.tagName;
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay:not(.hidden)').forEach(el => el.classList.add('hidden'));
    document.getElementById('chat-ctx-menu').classList.add('hidden');
    if (!inInput) document.getElementById('message-input').value = '';
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'n' && !inInput) { e.preventDefault(); newChat(); }
    if (e.key === '/') { e.preventDefault(); openModal('shortcuts-modal'); }
    if (e.key === 'k') { e.preventDefault(); document.getElementById('chat-search').focus(); }
    if (e.key === 'e' && state.currentChatId) { e.preventDefault(); openModal('export-modal'); }
    if (e.key === 'b') { e.preventDefault(); toggleSidebar(); }
  }
  if (e.key === 'Enter' && !inInput) {
    if (!document.getElementById('rename-modal').classList.contains('hidden')) confirmRename();
    if (!document.getElementById('task-modal').classList.contains('hidden')) confirmAddTask();
    if (!document.getElementById('edit-msg-modal').classList.contains('hidden')) confirmEditMsg();
  }
}

// ═══ AUTH ═════════════════════════════════════════════════════════════════════
window.checkAuth = async function() {
  const d = await fetchJSON('/api/me');
  state.isLoggedIn = d.logged_in;
  if (d.logged_in) {
    const letter = d.name[0].toUpperCase();
    document.getElementById('sidebar-username').textContent = d.name;
    document.getElementById('sidebar-mode').textContent = d.email || 'Logged in';
    document.getElementById('automation-sidebar-username').textContent = d.name;
    document.getElementById('diary-sidebar-username').textContent = d.name;
    
    // Set avatar
    const sidebarAvatar = document.getElementById('sidebar-avatar');
    const headerAvatar = document.getElementById('header-avatar-letter');
    const automationAvatar = document.getElementById('automation-sidebar-avatar');
    const diaryAvatar = document.getElementById('diary-sidebar-avatar');
    
    if (d.photo) {
      [sidebarAvatar, headerAvatar, automationAvatar, diaryAvatar].forEach(av => {
        if (av) {
          av.style.backgroundImage = `url(${d.photo})`;
          av.style.backgroundSize = 'cover';
          av.style.backgroundPosition = 'center';
          av.textContent = '';
        }
      });
    } else {
      [sidebarAvatar, headerAvatar, automationAvatar, diaryAvatar].forEach(av => {
        if (av) {
          av.style.backgroundImage = 'none';
          av.textContent = letter;
        }
      });
    }
    
    document.getElementById('header-auth-btn').style.background = 'linear-gradient(135deg,#63b3ed,#9f7aea)';
    document.getElementById('header-auth-btn').style.color = '#fff';
    document.getElementById('logout-btn').style.display = 'flex';
    document.getElementById('automation-logout-btn').style.display = 'flex';
    document.getElementById('diary-logout-btn').style.display = 'flex';
    if (d.theme) applyTheme(d.theme);
  } else {
    document.getElementById('sidebar-username').textContent = 'Guest Mode';
    document.getElementById('sidebar-mode').textContent = 'Not signed in';
    document.getElementById('automation-sidebar-username').textContent = 'Guest Mode';
    document.getElementById('diary-sidebar-username').textContent = 'Guest Mode';
    document.getElementById('logout-btn').style.display = 'none';
    document.getElementById('automation-logout-btn').style.display = 'none';
    document.getElementById('diary-logout-btn').style.display = 'none';
  }
}

window.doLogout = async function() {
  await fetchJSON('/api/logout', 'POST');
  location.href = '/auth';
}

// ═══ THEME ════════════════════════════════════════════════════════════════════
window.applyTheme = function(theme) {
  state.currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('nexa_theme', theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
  document.getElementById('theme-dark-btn')?.classList.toggle('active', theme === 'dark');
  document.getElementById('theme-light-btn')?.classList.toggle('active', theme === 'light');
}
window.toggleTheme = function() { applyTheme(state.currentTheme === 'dark' ? 'light' : 'dark'); }
window.setTheme = function(t) { applyTheme(t); }

// ═══ SIDEBAR ══════════════════════════════════════════════════════════════════
window.toggleSidebar = function() {
  const sidebar = document.getElementById('sidebar');
  const openBtn = document.getElementById('sidebar-open-btn');
  const backdrop = document.getElementById('sidebar-backdrop');
  sidebar.classList.toggle('collapsed');
  const collapsed = sidebar.classList.contains('collapsed');
  if (openBtn) openBtn.style.display = collapsed ? 'flex' : 'none';
  if (backdrop) backdrop.classList.toggle('visible', !collapsed && window.innerWidth <= 768);
}

// Auto-collapse sidebar on mobile when clicking entry/chat
window.autoCollapseSidebar = function() {
  if (window.innerWidth <= 768) {
    toggleSidebar();
  }
}

// ═══ MODEL ════════════════════════════════════════════════════════════════════
window.openModelPicker = function() {
  document.getElementById('model-overlay').classList.remove('hidden');
  document.querySelectorAll('.model-option').forEach(el =>
    el.classList.toggle('selected', el.dataset.model === state.currentModel));
}
window.closeModelPicker = function() { document.getElementById('model-overlay').classList.add('hidden'); }
window.selectModel = function(el) {
  state.currentModel = el.dataset.model;
  closeModelPicker();
  updateModelUI();
  if (state.currentChatId)
    fetchJSON(`/api/chats/${state.currentChatId}`, 'PATCH', { model: state.currentModel });
  showToast(`Switched to ${MODELS[state.currentModel].name}`, 'info');
}
window.updateModelUI = function() {
  const m = MODELS[state.currentModel];
  document.getElementById('model-badge-icon').textContent = m.icon;
  document.getElementById('model-badge-name').textContent = m.name;
  document.getElementById('welcome-model-name').textContent = m.name;
  const typingText = document.getElementById('typing-text');
  if (typingText) typingText.textContent = `${m.name} is thinking...`;
}

// ═══ MODE ═════════════════════════════════════════════════════════════════════
let currentMode = localStorage.getItem('currentMode') || 'chat';
const MODES = {
  chat: { name: 'Chat', icon: '💬' },
  automation: { name: 'Automation', icon: '🤖' },
  diary: { name: 'Diary', icon: '📔' }
};
window.openModeSelector = function() {
  document.getElementById('mode-overlay').classList.remove('hidden');
  document.querySelectorAll('#mode-overlay .model-option').forEach(el =>
    el.classList.toggle('selected', el.dataset.mode === currentMode));
}
window.closeModeSelector = function() { document.getElementById('mode-overlay').classList.add('hidden'); }
window.selectMode = function(el) {
  currentMode = el.dataset.mode;
  localStorage.setItem('currentMode', currentMode);
  closeModeSelector();
  updateModeUI();
  switchInterface();
  showToast(`Switched to ${MODES[currentMode].name} mode`, 'info');
}
window.updateModeUI = function() {
  const m = MODES[currentMode];
  document.getElementById('mode-badge-icon').textContent = m.icon;
  document.getElementById('mode-badge-name').textContent = m.name;
}
window.switchInterface = function() {
  const chatArea = document.getElementById('chat-area');
  const automationArea = document.getElementById('automation-area');
  const diaryArea = document.getElementById('diary-area');
  const inputArea = document.querySelector('.input-area');
  const chatSidebar = document.getElementById('chat-sidebar');
  const automationSidebar = document.getElementById('automation-sidebar');
  const diarySidebar = document.getElementById('diary-sidebar');
  
  if (currentMode === 'chat') {
    chatArea.classList.remove('hidden');
    automationArea.classList.add('hidden');
    if (diaryArea) diaryArea.classList.add('hidden');
    inputArea.style.display = 'flex';
    inputArea.classList.remove('hidden');
    chatSidebar.classList.remove('hidden');
    automationSidebar.classList.add('hidden');
    if (diarySidebar) diarySidebar.classList.add('hidden');
  } else if (currentMode === 'automation') {
    chatArea.classList.add('hidden');
    automationArea.classList.remove('hidden');
    if (diaryArea) diaryArea.classList.add('hidden');
    inputArea.style.display = 'none';
    inputArea.classList.add('hidden');
    chatSidebar.classList.add('hidden');
    automationSidebar.classList.remove('hidden');
    if (diarySidebar) diarySidebar.classList.add('hidden');
    renderWorkflows();
  } else if (currentMode === 'diary') {
    chatArea.classList.add('hidden');
    automationArea.classList.add('hidden');
    if (diaryArea) diaryArea.classList.remove('hidden');
    inputArea.style.display = 'none';
    inputArea.classList.add('hidden');
    chatSidebar.classList.add('hidden');
    automationSidebar.classList.add('hidden');
    if (diarySidebar) diarySidebar.classList.remove('hidden');
    loadDiaryEntries();
  }
}

// ═══ CHAT LIST ════════════════════════════════════════════════════════════════
window.loadChats = async function() {
  state.allChats = await fetchJSON('/api/chats');
  renderChats();
}

window.renderChats = function(filter = '') {
  const q = filter.toLowerCase();
  const filtered = q ? state.allChats.filter(c => c.title.toLowerCase().includes(q)) : state.allChats;
  const pinned = filtered.filter(c => c.is_pinned);
  const saved  = filtered.filter(c => c.is_saved && !c.is_pinned);
  const recent = filtered.filter(c => !c.is_pinned);

  const pSec = document.getElementById('pinned-section');
  const sSec = document.getElementById('saved-section');
  pSec.style.display = pinned.length ? 'block' : 'none';
  sSec.style.display = saved.length ? 'block' : 'none';
  document.getElementById('pinned-list').innerHTML = pinned.map(chatHTML).join('');
  document.getElementById('saved-list').innerHTML  = saved.map(chatHTML).join('');
  document.getElementById('all-chats-list').innerHTML = recent.length
    ? recent.map(chatHTML).join('')
    : '<div class="empty-list-hint">No chats yet. Start a new one!</div>';
}

window.chatHTML = function(chat) {
  const active = chat.id === state.currentChatId ? 'active' : '';
  const savedDot = chat.is_saved ? '<span class="chat-item-saved">💾</span>' : '';
  const pinDot   = chat.is_pinned ? '<span class="chat-item-saved">📌</span>' : '';
  return `<div class="chat-item ${active}" onclick="openChat(${chat.id})" id="chat-item-${chat.id}">
    <div class="chat-item-dot"></div>
    <div class="chat-item-title">${escapeHtml(chat.title)}${pinDot}${savedDot}</div>
    <button class="chat-item-btn" onclick="openChatCtxMenu(event,${chat.id})" title="Options">⋯</button>
  </div>`;
}

window.filterChats = function() { 
  clearTimeout(state.searchDebounceTimer);
  state.searchDebounceTimer = setTimeout(() => {
    renderChats(document.getElementById('chat-search').value);
  }, 300);
}

// ═══ OPEN / CREATE CHAT ═══════════════════════════════════════════════════════
window.newChat = async function() {
  const r = await fetchJSON('/api/chats', 'POST', { model: state.currentModel });
  state.allChats.unshift(r);
  renderChats();
  await openChat(r.id, true);
  document.getElementById('message-input').focus();
  if (window.innerWidth <= 768) toggleSidebar();
}

window.newTempChat = async function() {
  const r = await fetchJSON('/api/chats', 'POST', { model: state.currentModel, is_temporary: true, title: '⏱ Temporary' });
  await openChat(r.id, true);
  showToast('Temporary chat — not saved to history', 'info');
  if (window.innerWidth <= 768) toggleSidebar();
}

window.openChat = async function(chatId, isNew = false) {
  state.currentChatId = chatId;
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(`chat-item-${chatId}`);
  if (el) el.classList.add('active');

  const data = await fetchJSON(`/api/chats/${chatId}`);
  if (!data || data.error) return;

  state.currentModel = data.model || 'nexa-pro';
  updateModelUI();
  updateSaveBtnState(data.is_saved);

  const container = document.getElementById('messages-container');
  container.innerHTML = '';
  const welcome = document.getElementById('welcome-screen');

  if (!data.messages || data.messages.length === 0) {
    welcome.style.display = 'flex';
  } else {
    welcome.style.display = 'none';
    data.messages.forEach(m => appendMsg(m.role, m.content, m.id, m.created_at));
  }
  scrollBottom();
}

// ═══ SEND ═════════════════════════════════════════════════════════════════════
window.sendMessage = async function() {
  if (state.isSending) return;
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  
  // Check if file is attached
  if (attachedFile) {
    await sendMessageWithFile(content);
    return;
  }
  
  if (!content) return;
  if (content.length > 4000) {
    showToast('Message too long. Max 4000 characters.', 'error');
    return;
  }

  if (!state.currentChatId) {
    await newChat();
    if (!state.currentChatId) return;
  }

  state.isSending = true;
  input.value = '';
  autoResize(input);
  updateCharCounter(input);

  const sendBtn = document.getElementById('send-btn');
  const originalHTML = sendBtn.innerHTML;
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<div style="width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite"></div>';

  document.getElementById('welcome-screen').style.display = 'none';

  const tempId = 'tmp_' + Date.now();
  appendMsg('user', content, tempId, new Date().toISOString());
  
  // Show web search indicator if enabled
  if (state.webSearchEnabled) {
    const searchIndicator = document.createElement('div');
    searchIndicator.id = 'web-search-indicator';
    searchIndicator.className = 'typing-indicator';
    searchIndicator.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div><span class="typing-text">🌐 Searching on web...</span>';
    document.getElementById('messages-container').appendChild(searchIndicator);
    scrollBottom();
    await new Promise(resolve => setTimeout(resolve, 800)); // Show for 800ms
    searchIndicator.remove();
  }
  
  document.getElementById('typing-indicator').classList.remove('hidden');
  scrollBottom();

  try {
    const data = await fetchJSON(`/api/chats/${state.currentChatId}/messages`, 'POST', { content, web_search: state.webSearchEnabled });
    document.getElementById('typing-indicator').classList.add('hidden');

    const tmp = document.getElementById(`msg-row-${tempId}`);
    if (tmp) tmp.remove();

    appendMsg('user', data.user_message.content, data.user_message.id, data.user_message.created_at);
    appendMsg('assistant', data.ai_message.content, data.ai_message.id, data.ai_message.created_at);
    scrollBottom();

    const idx = state.allChats.findIndex(c => c.id === state.currentChatId);
    if (idx !== -1) { state.allChats[idx].title = data.chat_title; }
    else { await loadChats(); }
    renderChats(document.getElementById('chat-search').value);
    const chatEl = document.getElementById(`chat-item-${state.currentChatId}`);
    if (chatEl) chatEl.classList.add('active');

    if (state.speakerEnabled) speakText(data.ai_message.content);

  } catch (err) {
    document.getElementById('typing-indicator').classList.add('hidden');
    const tmp = document.getElementById(`msg-row-${tempId}`);
    if (tmp) tmp.remove();
    showToast(err.message || 'Failed to send message', 'error');
  } finally {
    state.isSending = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = originalHTML;
    input.focus();
  }
}

window.sendMessageWithFile = async function(content) {
  if (!attachedFile) return;
  
  if (!state.currentChatId) {
    await newChat();
    if (!state.currentChatId) return;
  }
  
  // Ensure CSRF token is loaded
  if (!state.csrfToken) await fetchCSRFToken();
  
  state.isSending = true;
  const input = document.getElementById('message-input');
  input.value = '';
  autoResize(input);
  
  const sendBtn = document.getElementById('send-btn');
  const originalHTML = sendBtn.innerHTML;
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<div style="width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite"></div>';
  
  document.getElementById('welcome-screen').style.display = 'none';
  document.getElementById('typing-indicator').classList.remove('hidden');
  
  const fileName = attachedFile.name;
  const fileSize = (attachedFile.size / 1024).toFixed(1) + ' KB';
  
  // Create FormData BEFORE clearing file
  const formData = new FormData();
  formData.append('file', attachedFile);
  if (content) formData.append('message', content);
  
  // Now clear file preview
  removeFile();
  
  try {
    const response = await fetch(`/api/chats/${state.currentChatId}/messages`, {
      method: 'POST',
      headers: {
        'X-CSRF-Token': state.csrfToken
      },
      body: formData
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to upload file');
    }
    
    const data = await response.json();
    document.getElementById('typing-indicator').classList.add('hidden');
    
    appendMsg('user', data.user_message.content, data.user_message.id, data.user_message.created_at);
    appendMsg('assistant', data.ai_message.content, data.ai_message.id, data.ai_message.created_at);
    scrollBottom();
    
    const idx = state.allChats.findIndex(c => c.id === state.currentChatId);
    if (idx !== -1) { state.allChats[idx].title = data.chat_title; }
    else { await loadChats(); }
    renderChats(document.getElementById('chat-search').value);
    const chatEl = document.getElementById(`chat-item-${state.currentChatId}`);
    if (chatEl) chatEl.classList.add('active');
    
    if (state.speakerEnabled) speakText(data.ai_message.content);
    showToast(`File uploaded: ${fileName}`, 'success');
    
  } catch (err) {
    document.getElementById('typing-indicator').classList.add('hidden');
    showToast(err.message || 'Failed to upload file', 'error');
  } finally {
    state.isSending = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = originalHTML;
    input.focus();
  }
}


window.quickSend = function(text) {
  document.getElementById('message-input').value = text;
  sendMessage();
}

window.handleKeyDown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

window.handleInputChange = function(el) {
  autoResize(el);
  updateCharCounter(el);
}

window.autoResize = function(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

window.updateCharCounter = function(el) {
  const len = el.value.length;
  const counter = document.getElementById('char-counter');
  if (len === 0) { counter.textContent = ''; return; }
  counter.textContent = `${len}/4000`;
  counter.className = 'char-counter' + (len > 3800 ? ' limit' : len > 3200 ? ' warn' : '');
}

window.scrollBottom = function() {
  const area = document.getElementById('chat-area');
  area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' });
}

// ═══ MESSAGES ═════════════════════════════════════════════════════════════════
window.appendMsg = function(role, content, msgId, timestamp) {
  const container = document.getElementById('messages-container');
  const div = document.createElement('div');
  div.className = 'message-row' + (role === 'user' ? ' user-row' : '');
  div.id = `msg-row-${msgId}`;

  const m = MODELS[state.currentModel];
  const avatarLetter = state.isLoggedIn
    ? (document.getElementById('sidebar-avatar')?.textContent || '?')
    : '?';
  const avatarHTML = role === 'user'
    ? `<div class="msg-avatar user-av">${escapeHtml(avatarLetter)}</div>`
    : `<div class="msg-avatar ai-avatar">N</div>`;

  // Check for file attachment or HTML content (images/links)
  let formattedContent;
  const fileMatch = content.match(/\[File: (.+?) \((.+?)\)\]/);
  
  if (fileMatch && role === 'user') {
    const fileName = fileMatch[1];
    const fileSize = fileMatch[2];
    const messageText = content.replace(fileMatch[0], '').trim();
    
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName);
    const fileIcon = isImage ? '🖼️' : '📄';
    
    formattedContent = `${messageText ? escapeHtml(messageText) + '<br><br>' : ''}<div style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;background:var(--hover);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px;" onclick="showToast('File: ${escapeHtml(fileName)}', 'info')"><span style="font-size:20px;">${fileIcon}</span><div><div style="font-weight:500;">${escapeHtml(fileName)}</div><div style="font-size:11px;color:var(--muted);">${escapeHtml(fileSize)}</div></div></div>`;
  } else if (content.includes('<img src=') || content.includes('<a href=')) {
    // Allow HTML for images and file links
    formattedContent = content;
  } else {
    formattedContent = role === 'assistant' ? formatAIContent(content) : escapeHtml(content).replace(/\n/g,'<br>');
  }

  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';

  const aiActions = `<div class="msg-actions">
    <button class="msg-action-btn" onclick="copyMsg('${msgId}',this)" title="Copy"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg></button>
    <button class="msg-action-btn" onclick="likeMsg(this)" title="Like"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
</svg></button>
    <button class="msg-action-btn" onclick="dislikeMsg(this)" title="Dislike"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path>
</svg></button>
    <button class="msg-action-btn" onclick="regenerateThisMsg('${msgId}')" title="Regenerate"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M23 4v6h-6"></path>
  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
</svg></button>
    <button class="msg-action-btn" onclick="shareMsgContent('${msgId}')" title="Share"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
  <polyline points="16 6 12 2 8 6"></polyline>
  <line x1="12" y1="2" x2="12" y2="15"></line>
</svg></button>
    <button class="msg-action-btn" onclick="exportMsgToPDF('${msgId}')" title="Export PDF"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
  <polyline points="14 2 14 8 20 8"></polyline>
  <line x1="16" y1="13" x2="8" y2="13"></line>
  <line x1="16" y1="17" x2="8" y2="17"></line>
  <polyline points="10 9 9 9 8 9"></polyline>
</svg></button>
  </div>`;

  const userActions = `<div class="msg-actions">
    <button class="msg-action-btn" onclick="copyMsg('${msgId}',this)" title="Copy"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg></button>
    <button class="msg-action-btn" onclick="editMsg('${msgId}')" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
</svg></button>
  </div>`;

  div.innerHTML = `${avatarHTML}
    <div class="msg-content-wrap">
      <div class="msg-bubble ${role === 'user' ? 'user-bubble' : 'ai-bubble'}" id="msg-content-${msgId}">${formattedContent}</div>
      ${role === 'assistant' ? aiActions : userActions}
    </div>`;

  container.appendChild(div);
}

// ═══ FORMAT AI CONTENT ════════════════════════════════════════════════════════
window.escapeHtml = function(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.formatAIContent = function(raw) {
  const blocks = [];
  
  // Extract code blocks
  let text = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    const displayLang = lang || 'code';
    blocks.push(`<div class="code-block">
      <div class="code-header">
        <span class="code-lang">${escapeHtml(displayLang)}</span>
        <button class="code-copy-btn" onclick="copyCode(this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy
        </button>
      </div>
      <pre><code class="language-${escapeHtml(displayLang)}">${escapeHtml(code.trim())}</code></pre>
    </div>`);
    return `\x00B${i}\x00`;
  });
  
  // Escape HTML
  text = escapeHtml(text);
  
  // Tables (Markdown format)
  text = text.replace(/(\|[^\n]+\|\n)+/g, (match) => {
    const lines = match.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return match;
    
    // Parse header
    const headers = lines[0].split('|').slice(1, -1).map(h => h.trim());
    
    // Check if second line is separator (contains dashes)
    if (!lines[1].includes('-')) return match;
    
    // Parse data rows
    const rows = lines.slice(2).map(line => {
      return line.split('|').slice(1, -1).map(c => c.trim());
    });
    
    let table = '<div class="table-wrapper"><table class="ai-table"><thead><tr>';
    headers.forEach(h => table += `<th>${h}</th>`);
    table += '</tr></thead><tbody>';
    rows.forEach(row => {
      if (row.length === headers.length) {
        table += '<tr>';
        row.forEach(cell => table += `<td>${cell}</td>`);
        table += '</tr>';
      }
    });
    table += '</tbody></table></div>';
    
    return table;
  });
  
  // Inline code
  text = text.replace(/`([^`]+)`/g,'<code class="inline-code">$1</code>');
  
  // Bold + Italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
  
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g,'<strong>$1</strong>');
  
  // Italic
  text = text.replace(/\*(.+?)\*/g,'<em>$1</em>');
  text = text.replace(/_(.+?)_/g,'<em>$1</em>');
  
  // Headings (add HR before each heading)
  text = text.replace(/^#### (.+)$/gm,'<hr class="ai-divider"><h5 class="ai-heading">$1</h5>');
  text = text.replace(/^### (.+)$/gm,'<hr class="ai-divider"><h4 class="ai-heading">$1</h4>');
  text = text.replace(/^## (.+)$/gm,'<hr class="ai-divider"><h3 class="ai-heading">$1</h3>');
  text = text.replace(/^# (.+)$/gm,'<hr class="ai-divider"><h2 class="ai-heading">$1</h2>');
  
  // Remove duplicate HRs
  text = text.replace(/(<hr class="ai-divider">)+/g, '<hr class="ai-divider">');
  
  // Bullet lists
  text = text.replace(/^[*\-•] (.+)$/gm,'<li class="bullet-item">$1</li>');
  
  // Numbered lists
  text = text.replace(/^\d+\.\s+(.+)$/gm,'<li class="numbered-item">$1</li>');
  
  // Wrap lists (fix consecutive list merging)
  text = text.replace(/((?:<li class="bullet-item">.+?<\/li>\s*)+)/g, m => `<ul class="ai-list">${m}</ul>`);
  text = text.replace(/((?:<li class="numbered-item">.+?<\/li>\s*)+)/g, m => `<ol class="ai-list">${m}</ol>`);
  
  // Math formulas (LaTeX style)
  text = text.replace(/\$\$(.+?)\$\$/g,'<div class="math-block">$1</div>');
  text = text.replace(/\$(.+?)\$/g,'<span class="math-inline">$1</span>');
  
  // Blockquotes
  text = text.replace(/^&gt; (.+)$/gm,'<blockquote class="ai-quote">$1</blockquote>');
  
  // Horizontal rule
  text = text.replace(/^---$/gm,'<hr class="ai-divider">');
  
  // Add HR after opening statements (like "Of course.", "Sure.", "Let me explain")
  text = text.replace(/^(Of course\.|Sure\.|Certainly\.|Let me explain|Here&#x27;s|I&#x27;d be happy to|Absolutely\.|Based on)(.+?)(<br>|$)/gi, '$1$2<br><hr class="ai-divider">');
  
  // Paragraphs
  text = text.replace(/\n\n+/g,'</p><p class="ai-paragraph">');
  text = text.replace(/\n/g,'<br>');
  
  text = '<p class="ai-paragraph">' + text + '</p>';
  
  // Restore code blocks
  text = text.replace(/\x00B(\d+)\x00/g,(_, i) => blocks[+i]);
  
  // Clean up empty paragraphs
  text = text.replace(/<p class="ai-paragraph"><\/p>/g,'');
  
  return text;
}

window.copyCode = async function(btn) {
  const code = btn.closest('.code-block').querySelector('code')?.innerText || '';
  navigator.clipboard.writeText(code).then(() => {
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
    btn.style.color = 'var(--success)';
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.style.color = '';
    }, 2000);
    showToast('Code copied!', 'success');
  });
}

// ═══ MESSAGE ACTIONS ══════════════════════════════════════════════════════════
window.copyMsg = async function(msgId, btn) {
  try {
    const el = document.getElementById(`msg-content-${msgId}`);
    const text = el ? el.innerText : '';
    await navigator.clipboard.writeText(text);
    if (btn) { 
      const orig = btn.innerHTML;
      btn.innerHTML = '✅'; 
      setTimeout(() => btn.innerHTML = orig, 1500); 
    }
    showToast('Copied!', 'success');
  } catch(e) {
    showToast('Copy failed', 'error');
  }
}
window.likeMsg = function(btn) { 
  btn.classList.toggle('liked'); 
  if (btn.classList.contains('liked')) {
    btn.classList.remove('disliked');
    showToast('👍', 'success');
  }
}
window.dislikeMsg = function(btn) { 
  btn.classList.toggle('disliked'); 
  if (btn.classList.contains('disliked')) {
    btn.classList.remove('liked');
    showToast('👎', 'info');
  }
}
window.shareMsg = function(content) {
  if (navigator.share) {
    navigator.share({ title: 'Nexa AI Response', text: content }).catch(() => {
      navigator.clipboard.writeText(content);
      showToast('Copied to clipboard!', 'success');
    });
  } else { 
    navigator.clipboard.writeText(content); 
    showToast('Copied to clipboard!', 'success'); 
  }
}
window.shareMsgContent = function(msgId) {
  const el = document.getElementById(`msg-content-${msgId}`);
  const content = el ? el.innerText : '';
  shareMsg(content);
}

window.exportMsgToPDF = function(msgId) {
  const msgRow = document.getElementById(`msg-row-${msgId}`);
  if (!msgRow) return;
  
  showToast('Generating PDF...', 'info');
  
  try {
    const contentEl = document.getElementById(`msg-content-${msgId}`);
    let htmlContent = contentEl ? contentEl.innerHTML : '';
    
    const allRows = Array.from(document.querySelectorAll('.message-row'));
    const currentIndex = allRows.indexOf(msgRow);
    let userPrompt = 'Nexa AI Response';
    
    if (currentIndex > 0) {
      const prevRow = allRows[currentIndex - 1];
      if (prevRow.classList.contains('user-row')) {
        const prevContent = prevRow.querySelector('.msg-content');
        userPrompt = prevContent ? prevContent.innerText : 'Nexa AI Response';
      }
    }
    
    const timestamp = new Date().toLocaleString();
    
    const pdfContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; background: #fff; color: #000; }
    .header { border-bottom: 3px solid #63b3ed; padding-bottom: 20px; margin-bottom: 30px; }
    .title { font-size: 20px; font-weight: bold; color: #000; margin-bottom: 10px; }
    .timestamp { color: #666; font-size: 14px; }
    .content { line-height: 1.8; font-size: 14px; }
    .content h1, .content h2, .content h3 { font-weight: bold; color: #000; margin-top: 20px; margin-bottom: 10px; }
    .content h1 { font-size: 20px; }
    .content h2 { font-size: 18px; }
    .content h3 { font-size: 16px; }
    .content ul, .content ol { margin: 10px 0; padding-left: 30px; }
    .content li { margin: 5px 0; }
    .content p { margin: 10px 0; }
    .content strong { font-weight: bold; }
    .content code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
    .content pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${userPrompt}</div>
    <div class="timestamp">Generated: ${timestamp}</div>
  </div>
  <div class="content">${htmlContent}</div>
  <div class="footer">
    <p>Powered by Nexa AI</p>
  </div>
</body>
</html>`;
    
    const blob = new Blob([pdfContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexa-ai-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Exported successfully ✓', 'success');
  } catch(e) {
    showToast('Export failed', 'error');
  }
}

window.regenerateThisMsg = async function(aiMsgId) {
  if (state.isSending) return;
  
  const allRows = Array.from(document.querySelectorAll('.message-row'));
  const aiRow = document.getElementById(`msg-row-${aiMsgId}`);
  if (!aiRow) return;
  
  const aiIndex = allRows.indexOf(aiRow);
  if (aiIndex === -1) return;
  
  // Find the user message just before this AI message
  let userRow = null;
  let userMsgId = null;
  for (let i = aiIndex - 1; i >= 0; i--) {
    if (allRows[i].classList.contains('user-row')) {
      userRow = allRows[i];
      userMsgId = userRow.id.replace('msg-row-', '');
      break;
    }
  }
  
  if (!userMsgId) return;
  
  state.isSending = true;
  const sendBtn = document.getElementById('send-btn');
  const originalHTML = sendBtn.innerHTML;
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<div style="width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite"></div>';
  
  try {
    // Remove AI message and everything after it from UI
    for (let i = allRows.length - 1; i >= aiIndex; i--) {
      allRows[i].remove();
    }
    
    // Show typing indicator
    const typingIndicator = document.getElementById('typing-indicator');
    typingIndicator.classList.remove('hidden');
    scrollBottom();
    
    // Call regenerate API (reuses existing user message, deletes old AI response, creates new AI response)
    const data = await fetchJSON(`/api/chats/${state.currentChatId}/regenerate/${userMsgId}`, 'POST');
    typingIndicator.classList.add('hidden');
    
    // Add only the new AI response
    appendMsg('assistant', data.ai_message.content, data.ai_message.id, data.ai_message.created_at);
    scrollBottom();
    
    if (state.speakerEnabled) speakText(data.ai_message.content);
    showToast('Response regenerated 🔄', 'success');
    
  } catch (err) {
    document.getElementById('typing-indicator').classList.add('hidden');
    showToast(err.message || 'Failed to regenerate', 'error');
  } finally {
    state.isSending = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = originalHTML;
  }
}

// Keep old function for backward compatibility
window.regenerateMsg = async function() {
  const rows = document.querySelectorAll('.message-row');
  if (rows.length < 2) return;
  
  // Find last AI message
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!rows[i].classList.contains('user-row')) {
      const msgId = rows[i].id.replace('msg-row-', '');
      await regenerateThisMsg(msgId);
      return;
    }
  }
}
window.editMsg = function(msgId) {
  const el = document.getElementById(`msg-content-${msgId}`);
  const content = el ? el.innerText : '';
  state.editingMsgId = msgId;
  document.getElementById('edit-msg-input').value = content;
  openModal('edit-msg-modal');
}

window.confirmEditMsg = async function() {
  if (!state.editingMsgId) return;
  const newContent = document.getElementById('edit-msg-input').value.trim();
  if (!newContent) return;
  
  try {
    // Update message in database first
    await fetchJSON(`/api/messages/${state.editingMsgId}`, 'PATCH', { content: newContent });
    
    // Update UI
    const el = document.getElementById(`msg-content-${state.editingMsgId}`);
    if (el) el.innerHTML = escapeHtml(newContent).replace(/\n/g,'<br>');
    
    closeModal('edit-msg-modal');
    showToast('Regenerating response...', 'info');
    
    // Call regenerate API with user message ID
    const data = await fetchJSON(`/api/chats/${state.currentChatId}/regenerate/${state.editingMsgId}`, 'POST');
    
    // Remove all messages after the edited user message
    const allRows = Array.from(document.querySelectorAll('.message-row'));
    const userRow = document.getElementById(`msg-row-${state.editingMsgId}`);
    if (userRow) {
      const userIndex = allRows.indexOf(userRow);
      // Remove all messages after this user message
      for (let i = allRows.length - 1; i > userIndex; i--) {
        allRows[i].remove();
      }
    }
    
    // Add new AI response
    appendMsg('assistant', data.ai_message.content, data.ai_message.id, data.ai_message.created_at);
    scrollBottom();
    
    if (state.speakerEnabled) speakText(data.ai_message.content);
    showToast('Response regenerated ✓', 'success');
    
  } catch (error) {
    showToast('Failed to regenerate', 'error');
  }
}

// ═══ QUICK COMMANDS ═══════════════════════════════════════════════════════════
// Diary Mode
let diaryEntries = [];
let currentDiaryId = null;

if (!state) state = {};
state.ctxMenuDiaryId = null;

window.loadDiaryEntries = async function() {
  try {
    const sid = localStorage.getItem('session_id') || '';
    diaryEntries = await fetchJSON(`/api/diary?session_id=${sid}`);
    renderDiaryEntries();
  } catch (e) {
    console.error('Load diary entries error:', e);
  }
}

window.renderDiaryEntries = function(filter = '') {
  const list = document.getElementById('diary-list');
  if (!list) return;
  let filtered = diaryEntries;
  if (filter) {
    filtered = diaryEntries.filter(e => (e.title + ' ' + e.content).toLowerCase().includes(filter.toLowerCase()));
  }
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-list-hint">No entries yet. Start writing!</div>';
    return;
  }
  list.innerHTML = filtered.map(e => {
    const active = currentDiaryId === e.id ? 'active' : '';
    return `
      <div class="chat-item ${active}" onclick="viewDiaryEntry(${e.id})" id="diary-item-${e.id}">
        <div class="chat-item-dot"></div>
        <div class="chat-item-title">${escapeHtml(e.title || 'Untitled')}</div>
        <button class="chat-item-btn" onclick="openDiaryCtxMenu(event,${e.id})" title="Options">⋯</button>
      </div>
    `;
  }).join('');
}

window.newDiaryEntry = function() {
  currentDiaryId = null;
  document.getElementById('diary-welcome-screen').style.display = 'none';
  document.getElementById('diary-entry-form').style.display = 'block';
  document.getElementById('diary-view').style.display = 'none';
  document.getElementById('diary-title').value = '';
  document.getElementById('diary-content').value = '';
  document.getElementById('diary-title').focus();
  autoCollapseSidebar();
}

window.viewDiaryEntry = function(id) {
  const entry = diaryEntries.find(e => e.id === id);
  if (!entry) return;
  currentDiaryId = id;
  document.getElementById('diary-welcome-screen').style.display = 'none';
  document.getElementById('diary-entry-form').style.display = 'none';
  document.getElementById('diary-view').style.display = 'block';
  document.getElementById('diary-view-title').textContent = entry.title || 'Untitled';
  
  // Format created date as "March 2024"
  const createdDate = new Date(entry.created_at);
  const createdMonth = createdDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('diary-created-date').textContent = createdMonth;
  
  // Format edited date as "dd/mm/yy"
  const editedDate = new Date(entry.updated_at);
  const dd = String(editedDate.getDate()).padStart(2, '0');
  const mm = String(editedDate.getMonth() + 1).padStart(2, '0');
  const yy = String(editedDate.getFullYear()).slice(-2);
  document.getElementById('diary-edited-date').textContent = `${dd}/${mm}/${yy}`;
  
  // Render markdown content
  document.getElementById('diary-view-content').innerHTML = renderMarkdown(entry.content);
  renderDiaryEntries();
  autoCollapseSidebar();
}

window.renderMarkdown = function(text) {
  if (!text) return '';
  
  // Escape HTML
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  // Process line by line
  const lines = html.split('\n');
  let result = [];
  let inList = false;
  
  for (let line of lines) {
    const trimmed = line.trim();
    
    // List items
    if (trimmed.match(/^[\*\-] /)) {
      if (!inList) {
        result.push('<ul style="margin:4px 0;padding-left:24px;">');
        inList = true;
      }
      result.push('<li>' + trimmed.replace(/^[\*\-] /, '') + '</li>');
    } 
    // Headers
    else if (trimmed.match(/^### /)) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h3 style="font-size:20px;font-weight:700;margin:8px 0 4px;color:var(--text);">' + trimmed.replace(/^### /, '') + '</h3>');
    }
    else if (trimmed.match(/^## /)) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h2 style="font-size:24px;font-weight:700;margin:10px 0 6px;color:var(--text);">' + trimmed.replace(/^## /, '') + '</h2>');
    }
    else if (trimmed.match(/^# /)) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h1 style="font-size:28px;font-weight:700;margin:12px 0 8px;color:var(--text);">' + trimmed.replace(/^# /, '') + '</h1>');
    }
    // Regular text
    else if (trimmed) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(trimmed + '<br>');
    }
    // Empty line
    else {
      if (inList) { result.push('</ul>'); inList = false; }
      if (result.length > 0) result.push('<br>');
    }
  }
  
  if (inList) result.push('</ul>');
  html = result.join('');
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight:700;">$1</strong>');
  
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em style="font-style:italic;">$1</em>');
  
  // Code inline
  html = html.replace(/`(.*?)`/g, '<code style="background:var(--surface2);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:14px;">$1</code>');
  
  // Links
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color:var(--accent);text-decoration:underline;" target="_blank">$1</a>');
  
  return html;
}

window.saveDiaryEntryNew = async function() {
  const title = document.getElementById('diary-title').value.trim();
  const content = document.getElementById('diary-content').value.trim();
  if (!content) return alert('Please write something!');
  
  try {
    const sid = localStorage.getItem('session_id') || '';
    if (currentDiaryId) {
      await fetchJSON(`/api/diary/${currentDiaryId}`, 'PATCH', { title: title || 'Untitled', content });
    } else {
      await fetchJSON('/api/diary', 'POST', { title: title || 'Untitled', content, session_id: sid });
    }
    
    await loadDiaryEntries();
    document.getElementById('diary-entry-form').style.display = 'none';
    document.getElementById('diary-welcome-screen').style.display = 'flex';
    currentDiaryId = null;
    showToast('Entry saved', 'success');
  } catch (e) {
    showToast(e.message || 'Failed to save entry', 'error');
  }
}

window.editDiaryEntryNew = function() {
  if (!currentDiaryId) return;
  const entry = diaryEntries.find(e => e.id === currentDiaryId);
  document.getElementById('diary-view').style.display = 'none';
  document.getElementById('diary-entry-form').style.display = 'block';
  document.getElementById('diary-title').value = entry.title || '';
  document.getElementById('diary-content').value = entry.content;
  document.getElementById('diary-title').focus();
}

window.deleteDiaryEntryNew = async function() {
  if (!currentDiaryId || !confirm('Delete this entry?')) return;
  try {
    await fetchJSON(`/api/diary/${currentDiaryId}`, 'DELETE');
    await loadDiaryEntries();
    currentDiaryId = null;
    document.getElementById('diary-view').style.display = 'none';
    document.getElementById('diary-welcome-screen').style.display = 'flex';
    showToast('Entry deleted', 'success');
  } catch (e) {
    showToast(e.message || 'Failed to delete entry', 'error');
  }
}

window.diaryCtxDelete = async function() {
  if (!state.ctxMenuDiaryId || !confirm('Delete this entry?')) return;
  try {
    await fetchJSON(`/api/diary/${state.ctxMenuDiaryId}`, 'DELETE');
    await loadDiaryEntries();
    if (currentDiaryId === state.ctxMenuDiaryId) {
      currentDiaryId = null;
      document.getElementById('diary-view').style.display = 'none';
      document.getElementById('diary-welcome-screen').style.display = 'flex';
    }
    showToast('Entry deleted', 'success');
  } catch (e) {
    showToast(e.message || 'Failed to delete entry', 'error');
  }
  closeDiaryCtx();
}

window.cancelDiaryEntry = function() {
  document.getElementById('diary-entry-form').style.display = 'none';
  if (currentDiaryId) {
    viewDiaryEntry(currentDiaryId);
  } else {
    document.getElementById('diary-welcome-screen').style.display = 'flex';
  }
}

window.saveDiaryEntry = function() {
  // Old function - not used
}

window.newDiaryEntry_old = function() {
  // Old function - not used
}

window.viewDiaryEntry_old = function(id) {
  // Old function - not used
}

window.deleteDiaryEntry = function(id) {
  // Old function - not used
}

window.toggleDiarySearch = function() {
  // Not needed anymore - search always visible
}

window.searchDiaryEntries = function() {
  const filter = document.getElementById('diary-search').value;
  renderDiaryEntries(filter);
}

window.openDiaryCtxMenu = function(e, id) {
  e.stopPropagation();
  state.ctxMenuDiaryId = id;
  const menu = document.getElementById('diary-ctx-menu');
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';
  menu.classList.remove('hidden');
  setTimeout(() => document.addEventListener('click', closeDiaryCtx, {once: true}), 0);
}

window.closeDiaryCtx = function() {
  const menu = document.getElementById('diary-ctx-menu');
  if (menu) menu.classList.add('hidden');
}

window.diaryCtxEdit = function() {
  if (!state.ctxMenuDiaryId) return;
  viewDiaryEntry(state.ctxMenuDiaryId);
  editDiaryEntryNew();
  closeDiaryCtx();
}

window.exportDiaryPDF = function() {
  if (!currentDiaryId) return;
  const entry = diaryEntries.find(e => e.id === currentDiaryId);
  if (!entry) return;
  
  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${entry.title || 'Untitled'}</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; }
        h1 { font-size: 28px; margin-bottom: 10px; }
        .meta { color: #666; font-size: 14px; margin-bottom: 20px; }
        .divider { border-top: 2px solid #ddd; margin: 20px 0; }
        .content { font-size: 16px; }
        h1, h2, h3 { margin-top: 20px; margin-bottom: 10px; }
        code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
        ul { margin: 10px 0; padding-left: 24px; }
        li { margin: 4px 0; }
      </style>
    </head>
    <body>
      <h1>${entry.title || 'Untitled'}</h1>
      <div class="meta">
        Created: ${new Date(entry.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} | 
        Last edited: ${new Date(entry.updated_at).toLocaleDateString()}
      </div>
      <div class="divider"></div>
      <div class="content">${renderMarkdown(entry.content)}</div>
      <script>
        window.onload = function() {
          window.print();
        }
      </script>
    </body>
    </html>
  `);
  win.document.close();
}

window.createWorkflow = function() {
  const name = prompt('Workflow name:');
  if (!name) return;
  const workflow = {id: Date.now(), name, active: false, runs: 0};
  const workflows = JSON.parse(localStorage.getItem('workflows') || '[]');
  workflows.push(workflow);
  localStorage.setItem('workflows', JSON.stringify(workflows));
  renderWorkflows();
  showToast('Workflow created', 'success');
}

window.openTemplates = function() {
  showToast('Templates: Daily News, Stock Updates, Job Alerts', 'info');
}

window.openStatusPanel = function() {
  const workflows = JSON.parse(localStorage.getItem('workflows') || '[]');
  const active = workflows.filter(w => w.active).length;
  const completed = workflows.reduce((sum, w) => sum + w.runs, 0);
  showToast(`Active: ${active} | Completed: ${completed}`, 'info');
}

window.renderWorkflows = function() {
  const workflows = JSON.parse(localStorage.getItem('workflows') || '[]');
  const list = document.getElementById('workflow-list');
  if (!workflows.length) {
    list.innerHTML = '<div class="empty-list-hint">No workflows yet. Create one!</div>';
    document.getElementById('active-workflows').textContent = '0';
    document.getElementById('completed-workflows').textContent = '0';
    return;
  }
  list.innerHTML = workflows.map(w => `
    <div class="chat-item" onclick="toggleWorkflow(${w.id})">
      <div class="chat-item-content">
        <div class="chat-title">${w.active ? '🟢' : '⚪'} ${w.name}</div>
        <div class="chat-preview">Runs: ${w.runs}</div>
      </div>
      <button class="icon-btn-sm" onclick="event.stopPropagation();deleteWorkflow(${w.id})" title="Delete">🗑️</button>
    </div>
  `).join('');
  document.getElementById('active-workflows').textContent = workflows.filter(w => w.active).length;
  document.getElementById('completed-workflows').textContent = workflows.reduce((sum, w) => sum + w.runs, 0);
}

window.toggleWorkflow = function(id) {
  const workflows = JSON.parse(localStorage.getItem('workflows') || '[]');
  const workflow = workflows.find(w => w.id === id);
  if (workflow) {
    workflow.active = !workflow.active;
    if (workflow.active) workflow.runs++;
    localStorage.setItem('workflows', JSON.stringify(workflows));
    renderWorkflows();
    showToast(workflow.active ? 'Workflow activated' : 'Workflow paused', 'info');
  }
}

window.deleteWorkflow = function(id) {
  const workflows = JSON.parse(localStorage.getItem('workflows') || '[]');
  localStorage.setItem('workflows', JSON.stringify(workflows.filter(w => w.id !== id)));
  renderWorkflows();
  showToast('Workflow deleted', 'success');
}

window.checkBotStatus = async function() {
  try {
    const res = await fetch('/api/bot-status');
    const data = await res.json();
    const statusEl = document.getElementById('bot-status');
    if (data.running) {
      statusEl.textContent = '🟢 Running';
      statusEl.style.color = '#10b981';
      showToast('Bot is running', 'success');
    } else {
      statusEl.textContent = '🔴 Stopped';
      statusEl.style.color = '#ef4444';
      showToast('Bot is not running', 'error');
    }
  } catch(e) {
    showToast('Could not check bot status', 'error');
  }
}

window.fetchIndiaNews = async function() {
  if (!state.currentChatId) await newChat();
  
  showToast('Fetching India breaking news...', 'info');
  
  try {
    const response = await fetch('/api/news/india');
    const data = await response.json();
    
    if (!data.success) {
      showToast(data.error || 'Failed to fetch news', 'error');
      return;
    }
    
    // Save news to chat history
    const r = await fetchJSON(`/api/chats/${state.currentChatId}/messages`, 'POST', {
      content: '🇮🇳 India Breaking News',
      web_search: false
    });
    
    // Display user message
    appendMsg('user', r.user_message.content, r.user_message.id, r.user_message.created_at);
    
    // Display news as AI response
    appendMsg('assistant', data.news, r.ai_message.id, r.ai_message.created_at);
    
    document.getElementById('welcome-screen').style.display = 'none';
    scrollBottom();
    showToast('News loaded ✓', 'success');
    
    // Update chat title
    const idx = state.allChats.findIndex(c => c.id === state.currentChatId);
    if (idx !== -1) { 
      state.allChats[idx].title = '🇮🇳 India Breaking News'; 
      renderChats(document.getElementById('chat-search').value);
    }
    
  } catch(e) {
    showToast('Failed to fetch news: ' + e.message, 'error');
  }
}

window.openWikipediaModal = function() {
  openModal('wikipedia-modal');
  document.getElementById('wikipedia-query').value = '';
}

window.fetchWikipedia = async function() {
  const query = document.getElementById('wikipedia-query').value.trim();
  if (!query) {
    showToast('Please enter a topic', 'error');
    return;
  }
  
  closeModal('wikipedia-modal');
  
  if (!state.currentChatId) await newChat();
  
  showToast('Fetching Wikipedia...', 'info');
  
  try {
    const response = await fetch(`/api/wikipedia/${encodeURIComponent(query)}`);
    const data = await response.json();
    
    if (!data.success) {
      showToast(data.error || 'Failed to fetch Wikipedia', 'error');
      return;
    }
    
    // Save to chat history
    const r = await fetchJSON(`/api/chats/${state.currentChatId}/messages`, 'POST', {
      content: `📚 Wikipedia: ${query}`,
      web_search: false
    });
    
    // Display user message
    appendMsg('user', r.user_message.content, r.user_message.id, r.user_message.created_at);
    
    // Display Wikipedia summary as AI response
    appendMsg('assistant', data.summary, r.ai_message.id, r.ai_message.created_at);
    
    document.getElementById('welcome-screen').style.display = 'none';
    scrollBottom();
    showToast('Wikipedia loaded ✓', 'success');
    
    // Update chat title
    const idx = state.allChats.findIndex(c => c.id === state.currentChatId);
    if (idx !== -1) { 
      state.allChats[idx].title = `📚 ${query}`; 
      renderChats(document.getElementById('chat-search').value);
    }
    
  } catch(e) {
    showToast('Failed to fetch Wikipedia: ' + e.message, 'error');
  }
}

window.insertQuickCmd = function(cmd) {
  const input = document.getElementById('message-input');
  input.value = cmd;
  input.focus();
  input.setSelectionRange(cmd.length, cmd.length);
  autoResize(input);
  if (!state.currentChatId) newChat();
  if (window.innerWidth <= 768) toggleSidebar();
}

// ═══ ATTACH FILES ═════════════════════════════════════════════════════════════
let attachedFile = null;

window.toggleAttachMenu = function() {
  const menu = document.getElementById('attach-menu');
  menu.classList.toggle('hidden');
}

window.attachPhoto = function() {
  document.getElementById('photo-input').click();
  toggleAttachMenu();
}

window.attachFile = function() {
  document.getElementById('file-input').click();
  toggleAttachMenu();
}

window.handlePaste = function(event) {
  const items = (event.clipboardData || event.originalEvent.clipboardData).items;
  
  for (let item of items) {
    if (item.type.indexOf('image') !== -1) {
      event.preventDefault();
      const blob = item.getAsFile();
      
      // Create a File object from blob
      const file = new File([blob], `pasted-image-${Date.now()}.png`, { type: blob.type });
      attachedFile = file;
      showFilePreview(file, true);
      showToast('Image pasted! Ready to send 📋', 'success');
      break;
    }
  }
}

window.handlePhotoUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file', 'error');
    return;
  }
  
  attachedFile = file;
  showFilePreview(file, true);
}

window.handleFileUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  attachedFile = file;
  showFilePreview(file, false);
}

window.showFilePreview = function(file, isImage) {
  const preview = document.getElementById('file-preview');
  preview.classList.remove('hidden');
  
  const size = (file.size / 1024).toFixed(1) + ' KB';
  
  if (isImage) {
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `
        <img src="${e.target.result}" alt="Preview" style="cursor:pointer;max-width:100%;height:auto;" onclick="viewFile('${e.target.result}', '${file.name}', true)">
        <div class="file-preview-info">
          <div class="file-preview-name" style="cursor:pointer" onclick="viewFile('${e.target.result}', '${file.name}', true)">${file.name}</div>
          <div class="file-preview-size">${size}</div>
        </div>
        <button class="file-preview-remove" onclick="removeFile()">×</button>
      `;
    };
    reader.readAsDataURL(file);
  } else {
    preview.innerHTML = `
      <div style="width:40px;height:40px;background:var(--surface);border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;" onclick="downloadFile()">📄</div>
      <div class="file-preview-info">
        <div class="file-preview-name" style="cursor:pointer" onclick="downloadFile()">${file.name}</div>
        <div class="file-preview-size">${size}</div>
      </div>
      <button class="file-preview-remove" onclick="removeFile()">×</button>
    `;
  }
}

window.viewFile = function(dataUrl, fileName, isImage) {
  if (isImage) {
    const win = window.open('', '_blank');
    win.document.write(`
      <html>
        <head><title>${fileName}</title></head>
        <body style="margin:0;display:flex;align-items:center;justify-content:center;background:#000;">
          <img src="${dataUrl}" style="max-width:100%;max-height:100vh;">
        </body>
      </html>
    `);
  }
}

window.downloadFile = function() {
  if (!attachedFile) return;
  const url = URL.createObjectURL(attachedFile);
  const a = document.createElement('a');
  a.href = url;
  a.download = attachedFile.name;
  a.click();
  URL.revokeObjectURL(url);
}

window.removeFile = function() {
  attachedFile = null;
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('photo-input').value = '';
  document.getElementById('file-input').value = '';
}

// Close attach menu when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('attach-menu');
  const btn = document.getElementById('attach-btn');
  if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== btn) {
    menu.classList.add('hidden');
  }
});

// ═══ VOICE INPUT ══════════════════════════════════════════════════════════════
window.initSpeechRecognition = function() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  state.recognition = new SR();
  state.recognition.continuous = false;
  state.recognition.interimResults = false;
  state.recognition.lang = 'en-US';
  state.recognition.onresult = (e) => {
    const t = e.results[0][0].transcript;
    document.getElementById('message-input').value = t;
    autoResize(document.getElementById('message-input'));
    stopRecording();
    sendMessage();
  };
  state.recognition.onerror = stopRecording;
  state.recognition.onend = stopRecording;
}
window.toggleMic = function() { state.isRecording ? stopRecording() : startRecording(); }
window.startRecording = function() {
  if (!state.recognition) { 
    showToast('Speech recognition not available on this device', 'error'); 
    return; 
  }
  try {
    state.isRecording = true;
    state.recognition.start();
    document.getElementById('mic-btn').classList.add('recording');
    document.getElementById('mic-status').textContent = '🎙 Listening...';
  } catch(e) {
    showToast('Microphone access denied', 'error');
    state.isRecording = false;
  }
}
window.stopRecording = function() {
  state.isRecording = false;
  try { state.recognition?.stop(); } catch(e){}
  document.getElementById('mic-btn').classList.remove('recording');
  document.getElementById('mic-status').textContent = '';
}

// ═══ VOICE OUTPUT ═════════════════════════════════════════════════════════════
window.toggleWebSearch = function() {
  state.webSearchEnabled = !state.webSearchEnabled;
  document.getElementById('web-search-btn').classList.toggle('active', state.webSearchEnabled);
  showToast(state.webSearchEnabled ? 'Web search enabled 🌐' : 'Web search disabled', 'info');
}

window.toggleSpeaker = function() {
  state.speakerEnabled = !state.speakerEnabled;
  document.getElementById('speaker-btn').classList.toggle('active', state.speakerEnabled);
  if (!state.speakerEnabled) speechSynthesis.cancel();
  showToast(state.speakerEnabled ? 'Voice output on 🔊' : 'Voice output off 🔇', 'info');
}
window.speakText = function(raw) {
  if (!state.speakerEnabled) return;
  speechSynthesis.cancel();
  const clean = raw.replace(/<[^>]+>/g,'').replace(/```[\s\S]*?```/g,'code block').substring(0,600);
  const utter = new SpeechSynthesisUtterance(clean);
  utter.rate = 0.93; utter.pitch = 1.05;
  const voices = speechSynthesis.getVoices();
  const female = voices.find(v => /samantha|karen|victoria|zira|female|woman|google uk english female/i.test(v.name))
    || voices.find(v => v.lang.startsWith('en'));
  if (female) utter.voice = female;
  speechSynthesis.speak(utter);
}
speechSynthesis.onvoiceschanged = () => {};

// ═══ TASKS ════════════════════════════════════════════════════════════════════
window.loadTasks = async function() {
  const url = state.isLoggedIn ? '/api/tasks' : `/api/tasks?session_id=${state.sessionId}`;
  state.tasks = await fetchJSON(url);
  renderTasks();
}
window.renderTasks = function() {
  const pending = state.tasks.filter(t => !t.completed).length;
  const badge = document.getElementById('tasks-count');
  if (badge) badge.textContent = pending > 0 ? pending : '';

  document.getElementById('task-list').innerHTML = state.tasks.map(t => `
    <div class="task-item" id="task-${t.id}" data-priority="${t.priority||'normal'}">
      <div class="task-check ${t.completed?'done':''}" onclick="toggleTask(${t.id})">${t.completed?'✓':''}</div>
      <div class="task-title ${t.completed?'done':''}">${escapeHtml(t.title)}</div>
      <button class="task-del" onclick="deleteTask(${t.id})" title="Delete">✕</button>
    </div>`).join('') || '<div style="font-size:12px;color:var(--muted);padding:4px;text-align:center;">No tasks yet</div>';
}
window.selectPriority = function(btn) {
  state.selectedPriority = btn.dataset.priority;
  document.querySelectorAll('.priority-btn').forEach(b => b.classList.toggle('active', b===btn));
}
window.confirmAddTask = async function() {
  const title = document.getElementById('task-input').value.trim();
  if (!title) return;
  const task = await fetchJSON('/api/tasks', 'POST', { title, session_id: state.sessionId, priority: state.selectedPriority });
  state.tasks.unshift(task);
  renderTasks();
  document.getElementById('task-input').value = '';
  state.selectedPriority = 'normal';
  document.querySelectorAll('.priority-btn').forEach((b,i) => b.classList.toggle('active', i===0));
  closeModal('task-modal');
  showToast('Task added ✅', 'success');
}
window.toggleTask = async function(id) {
  const t = state.tasks.find(t=>t.id===id);
  if (!t) return;
  t.completed = !t.completed;
  await fetchJSON(`/api/tasks/${id}`, 'PATCH', { completed: t.completed });
  renderTasks();
}
window.deleteTask = async function(id) {
  await fetchJSON(`/api/tasks/${id}`, 'DELETE');
  state.tasks = state.tasks.filter(t=>t.id!==id);
  renderTasks();
  showToast('Task removed', 'info');
}

// ═══ CHAT CONTEXT MENU ════════════════════════════════════════════════════════
window.openChatCtxMenu = function(e, chatId) {
  e.stopPropagation();
  state.ctxMenuChatId = chatId;
  const chat = state.allChats.find(c=>c.id===chatId);
  const menu = document.getElementById('chat-ctx-menu');
  document.getElementById('ctx-pin-label').textContent = chat?.is_pinned ? 'Unpin' : 'Pin Chat';
  document.getElementById('ctx-save-label').textContent = chat?.is_saved ? 'Unsave' : 'Save Chat';
  menu.classList.remove('hidden');
  menu.style.left = e.clientX + 'px';
  menu.style.top  = e.clientY + 'px';
  setTimeout(() => {
    const r = menu.getBoundingClientRect();
    if (r.right  > window.innerWidth)  menu.style.left = (window.innerWidth  - r.width  - 8) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top  = (window.innerHeight - r.height - 8) + 'px';
  }, 0);
}
window.ctxShare = function()  { if (!state.ctxMenuChatId) return; navigator.clipboard.writeText(window.location.origin+'/chat?id='+state.ctxMenuChatId); showToast('Link copied! 🔗','success'); closeCtx(); }
window.ctxRename = function() { if (!state.ctxMenuChatId) return; state.renamingChatId=state.ctxMenuChatId; const c=state.allChats.find(c=>c.id===state.ctxMenuChatId); document.getElementById('rename-input').value=c?c.title:''; openModal('rename-modal'); closeCtx(); }
window.ctxPin = async function() {
  if (!state.ctxMenuChatId) return;
  const chat = state.allChats.find(c=>c.id===state.ctxMenuChatId);
  if (!chat) return;
  chat.is_pinned = !chat.is_pinned;
  await fetchJSON(`/api/chats/${state.ctxMenuChatId}`, 'PATCH', { is_pinned: chat.is_pinned });
  renderChats();
  showToast(chat.is_pinned ? 'Chat pinned 📌' : 'Chat unpinned', 'info');
  closeCtx();
}
window.ctxSave = async function() {
  if (!state.ctxMenuChatId) return;
  const chat = state.allChats.find(c=>c.id===state.ctxMenuChatId);
  if (!chat) return;
  chat.is_saved = !chat.is_saved;
  await fetchJSON(`/api/chats/${state.ctxMenuChatId}`, 'PATCH', { is_saved: chat.is_saved });
  if (state.currentChatId === state.ctxMenuChatId) updateSaveBtnState(chat.is_saved);
  renderChats();
  showToast(chat.is_saved ? 'Chat saved 💾' : 'Removed from saved', 'success');
  closeCtx();
}
window.ctxExport = function() { if (!state.ctxMenuChatId) return; state.currentChatId=state.ctxMenuChatId; openModal('export-modal'); closeCtx(); }
window.ctxDelete = async function() {
  if (!state.ctxMenuChatId) return;
  if (!confirm('Delete this chat? This cannot be undone.')) return;
  await fetchJSON(`/api/chats/${state.ctxMenuChatId}`, 'DELETE');
  state.allChats = state.allChats.filter(c=>c.id!==state.ctxMenuChatId);
  if (state.currentChatId === state.ctxMenuChatId) { state.currentChatId=null; document.getElementById('messages-container').innerHTML=''; document.getElementById('welcome-screen').style.display='flex'; }
  renderChats();
  showToast('Chat deleted', 'info');
  closeCtx();
}
window.closeCtx = function() { document.getElementById('chat-ctx-menu').classList.add('hidden'); }

window.confirmRename = async function() {
  if (!state.renamingChatId) return;
  const title = document.getElementById('rename-input').value.trim();
  if (!title) return;
  await fetchJSON(`/api/chats/${state.renamingChatId}`, 'PATCH', { title });
  const idx = state.allChats.findIndex(c=>c.id===state.renamingChatId);
  if (idx !== -1) state.allChats[idx].title = title;
  renderChats();
  closeModal('rename-modal');
  showToast('Renamed ✏️', 'success');
}

// ═══ CURRENT CHAT ACTIONS ═════════════════════════════════════════════════════
window.saveCurrentChat = async function() {
  if (!state.currentChatId) return;
  const chat = state.allChats.find(c=>c.id===state.currentChatId);
  if (!chat) return;
  chat.is_saved = !chat.is_saved;
  await fetchJSON(`/api/chats/${state.currentChatId}`, 'PATCH', { is_saved: chat.is_saved });
  updateSaveBtnState(chat.is_saved);
  renderChats();
  showToast(chat.is_saved ? 'Chat saved 💾' : 'Removed from saved', chat.is_saved?'success':'info');
}
window.updateSaveBtnState = function(saved) {
  document.getElementById('save-chat-btn')?.classList.toggle('saved', !!saved);
  document.getElementById('save-chat-btn').title = saved ? 'Unsave chat' : 'Save chat';
}
window.shareCurrentChat = function() {
  if (!state.currentChatId) { showToast('Open a chat first', 'error'); return; }
  navigator.clipboard.writeText(window.location.origin+'/chat?id='+state.currentChatId);
  showToast('Chat link copied 🔗', 'success');
}
window.deleteCurrentChat = async function() {
  if (!state.currentChatId) return;
  if (!confirm('Delete this chat? This cannot be undone.')) return;
  await fetchJSON(`/api/chats/${state.currentChatId}`, 'DELETE');
  state.allChats = state.allChats.filter(c=>c.id!==state.currentChatId);
  state.currentChatId = null;
  document.getElementById('messages-container').innerHTML = '';
  document.getElementById('welcome-screen').style.display = 'flex';
  renderChats();
  showToast('Chat deleted 🗑️', 'info');
}
window.doExport = function(fmt) {
  if (!state.currentChatId) return;
  window.location.href = `/api/chats/${state.currentChatId}/export?format=${fmt}`;
  closeModal('export-modal');
  showToast(`Downloading as .${fmt} 📥`, 'success');
}

// ═══ PROFILE ══════════════════════════════════════════════════════════════════
let profilePhotoData = null;

window.toggleProfileMenu = function() {
  const menu = document.getElementById('profile-menu');
  menu.classList.toggle('hidden');
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('profile-menu');
  const btn = document.getElementById('header-auth-btn');
  if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

window.openProfileModal = async function() {
  if (!state.isLoggedIn) { location.href='/auth'; return; }
  const me = await fetchJSON('/api/me');
  document.getElementById('profile-name').value = me.name || '';
  document.getElementById('profile-password').value = '';
  
  // Load profile photo
  const avatar = document.getElementById('profile-avatar-preview');
  if (me.photo) {
    avatar.style.backgroundImage = `url(${me.photo})`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.textContent = '';
    document.getElementById('remove-photo-btn').style.display = 'block';
  } else {
    avatar.style.backgroundImage = 'none';
    avatar.textContent = me.name?.[0]?.toUpperCase() || 'G';
    document.getElementById('remove-photo-btn').style.display = 'none';
  }
  
  document.getElementById('theme-dark-btn').classList.toggle('active', state.currentTheme==='dark');
  document.getElementById('theme-light-btn').classList.toggle('active', state.currentTheme==='light');
  const stats = await fetchJSON('/api/stats');
  document.getElementById('stat-chats').textContent = stats.chats;
  document.getElementById('stat-msgs').textContent = stats.messages;
  document.getElementById('stat-tasks').textContent = stats.tasks;
  openModal('profile-modal');
}

window.handleProfilePhotoUpload = async function(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file', 'error');
    return;
  }
  
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image must be less than 5MB', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    profilePhotoData = e.target.result;
    const avatar = document.getElementById('profile-avatar-preview');
    avatar.style.backgroundImage = `url(${e.target.result})`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.textContent = '';
    document.getElementById('remove-photo-btn').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

window.removeProfilePhoto = function() {
  profilePhotoData = 'REMOVE';
  const avatar = document.getElementById('profile-avatar-preview');
  avatar.style.backgroundImage = 'none';
  const name = document.getElementById('profile-name').value;
  avatar.textContent = name?.[0]?.toUpperCase() || 'G';
  document.getElementById('remove-photo-btn').style.display = 'none';
  document.getElementById('profile-photo-input').value = '';
}

window.saveProfile = async function() {
  const name = document.getElementById('profile-name').value.trim();
  const password = document.getElementById('profile-password').value;
  const payload = {};
  if (name) payload.name = name;
  if (password) { if (password.length < 6) { showToast('Password must be 6+ chars','error'); return; } payload.password = password; }
  payload.theme = state.currentTheme;
  if (profilePhotoData) payload.photo = profilePhotoData;
  
  await fetchJSON('/api/profile', 'PATCH', payload);
  
  // Update UI
  if (name) { 
    document.getElementById('sidebar-username').textContent = name; 
    document.getElementById('automation-sidebar-username').textContent = name;
    document.getElementById('sidebar-avatar').textContent = name[0].toUpperCase(); 
    document.getElementById('automation-sidebar-avatar').textContent = name[0].toUpperCase();
    document.getElementById('header-avatar-letter').textContent = name[0].toUpperCase(); 
  }
  
  // Update avatar if photo changed
  if (profilePhotoData && profilePhotoData !== 'REMOVE') {
    const avatars = [document.getElementById('sidebar-avatar'), document.querySelector('#header-avatar-letter')];
    avatars.forEach(av => {
      if (av) {
        av.style.backgroundImage = `url(${profilePhotoData})`;
        av.style.backgroundSize = 'cover';
        av.style.backgroundPosition = 'center';
        av.textContent = '';
      }
    });
  } else if (profilePhotoData === 'REMOVE') {
    const avatars = [document.getElementById('sidebar-avatar'), document.querySelector('#header-avatar-letter')];
    avatars.forEach(av => {
      if (av) {
        av.style.backgroundImage = 'none';
        av.textContent = name?.[0]?.toUpperCase() || 'G';
      }
    });
  }
  
  profilePhotoData = null;
  closeModal('profile-modal');
  showToast('Profile updated ✓', 'success');
}


// ═══ TIME GREETING ════════════════════════════════════════════════════════════
window.setTimeGreeting = function() {
  const h = new Date().getHours();
  document.getElementById('time-greeting').textContent = h<12?'Morning':h<17?'Afternoon':'Evening';
}

// ═══ MODALS ═══════════════════════════════════════════════════════════════════
window.openModal = function(id) {
  document.getElementById(id).classList.remove('hidden');
  const inp = document.querySelector(`#${id} input:not([type=password]), #${id} textarea`);
  if (inp) setTimeout(() => inp.focus(), 60);
}
window.closeModal = function(id) { document.getElementById(id).classList.add('hidden'); }

// ═══ TOAST ════════════════════════════════════════════════════════════════════
// Inject toast animation styles
const toastStyle = document.createElement('style');
toastStyle.textContent = '@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
document.head.appendChild(toastStyle);

window.showToast = function(msg, type='info') {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    c.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:7px;align-items:center;pointer-events:none;';
    document.body.appendChild(c);
  }
  const t = document.createElement('div');
  const cols = {info:'#63b3ed',error:'#fc8181',success:'#68d391',warning:'#f6ad55'};
  t.style.cssText = `padding:9px 18px;background:var(--surface2,#161b22);border:1px solid ${cols[type]||cols.info};border-radius:10px;color:var(--text,#e2e8f0);font-size:13px;font-family:'DM Sans',sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.5);animation:toastIn .25s ease;white-space:nowrap;`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.transition='all .28s'; t.style.opacity='0'; t.style.transform='translateY(8px)'; setTimeout(()=>t.remove(),300); }, 2800);
}
