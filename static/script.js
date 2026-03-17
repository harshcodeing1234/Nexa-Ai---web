let speakerEnabled = true;
let recognition;
let synth = window.speechSynthesis;
let currentModel = localStorage.getItem('currentModel') || 'DeepSeek-V3.1';
let tasks = JSON.parse(localStorage.getItem('tasks')) || [];
let savedChats = JSON.parse(localStorage.getItem('savedChats')) || [];
let currentChatId = parseInt(localStorage.getItem('currentChatId')) || 0;
let activeChatId = parseInt(localStorage.getItem('activeChatId')) || null;
let chatHistory = JSON.parse(localStorage.getItem('chatHistory')) || [];
let memory = JSON.parse(localStorage.getItem('nexaMemory')) || [];

function toggleModelSelector() {
    const modal = document.getElementById('modelModal');
    if (!modal) return;
    modal.classList.toggle('active');
    if (modal.classList.contains('active')) {
        updateSelectedModel();
    }
}

function updateSelectedModel() {
    document.querySelectorAll('.model-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    const options = document.querySelectorAll('.model-option');
    options.forEach(opt => {
        const modelName = opt.querySelector('.model-name').textContent;
        if (currentModel.includes(modelName.split(' ')[0]) || modelName.includes(currentModel.split('-')[0])) {
            opt.classList.add('selected');
        }
    });
}

async function selectModel(model) {
    currentModel = model;
    localStorage.setItem('currentModel', model);
    try {
        await fetch('/set_model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model })
        });
        document.getElementById('currentModelDisplay').textContent = model;
        toggleModelSelector();
    } catch (e) {
        addMessage('Failed to change model', 'assistant');
    }
}

if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = function (event) {
        const transcript = event.results[0][0].transcript;
        document.getElementById('userInput').value = transcript;
        sendMessage();
    };

    recognition.onend = function () {
        document.getElementById('micBtn').classList.remove('listening');
    };

    recognition.onerror = function (event) {
        document.getElementById('micBtn').classList.remove('listening');
    };
}

function startVoice() {
    if (recognition) {
        try {
            document.getElementById('micBtn').classList.add('listening');
            recognition.start();
        } catch (e) {
            document.getElementById('micBtn').classList.remove('listening');
            addMessage('Voice recognition failed', 'assistant');
        }
    } else {
        addMessage('Voice recognition not supported in this browser', 'assistant');
    }
}

function toggleSpeaker() {
    speakerEnabled = !speakerEnabled;
    const btn = document.getElementById('speakerBtn');
    if (speakerEnabled) {
        btn.classList.add('speaking');
        btn.textContent = '🔊';
        btn.title = 'Voice output enabled';
    } else {
        btn.classList.remove('speaking');
        btn.textContent = '🔇';
        btn.title = 'Voice output disabled';
        synth.cancel();
    }
}

function speak(text) {
    if (speakerEnabled && synth) {
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.pitch = 1.2;
        utterance.volume = 1;
        utterance.lang = 'en-US';

        const voices = synth.getVoices();
        const femaleVoice = voices.find(voice =>
            voice.name.includes('Female') ||
            voice.name.includes('female') ||
            voice.name.includes('Zira') ||
            voice.name.includes('Google UK English Female') ||
            voice.name.includes('Microsoft Zira')
        );
        if (femaleVoice) {
            utterance.voice = femaleVoice;
        }

        synth.speak(utterance);
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    if (sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
        sidebar.classList.add('hidden');
        overlay.classList.remove('active');
    } else {
        sidebar.classList.remove('hidden');
        sidebar.classList.add('active');
        overlay.classList.add('active');
    }
}

function newChat() {
    // Save current chat if it has messages
    if (chatHistory.length > 0) {
        const firstUserMsg = chatHistory.find(m => m.role === 'user')?.content.substring(0, 30) || 'New Chat';
        
        const chatIndex = savedChats.findIndex(c => c.id === activeChatId);
        if (chatIndex !== -1) {
            // Update existing chat
            savedChats[chatIndex].history = [...chatHistory];
        } else {
            // Create new chat
            savedChats.push({
                id: activeChatId !== null ? activeChatId : currentChatId,
                title: firstUserMsg,
                history: [...chatHistory]
            });
            if (activeChatId === null) {
                currentChatId++;
                localStorage.setItem('currentChatId', currentChatId);
            }
        }
        localStorage.setItem('savedChats', JSON.stringify(savedChats));
    }
    
    // Reset for new chat (but keep memory and tasks)
    activeChatId = null;
    chatHistory = [];
    localStorage.setItem('activeChatId', activeChatId);
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    document.getElementById('chatBox').innerHTML = '';
    document.getElementById('chatBox').style.display = 'none';
    document.getElementById('welcomeScreen').style.display = 'flex';
    updateMemoryIndicator();
    loadSavedChats();
}

function updateMemoryIndicator() {
    const indicator = document.getElementById('memoryIndicator');
    const count = document.getElementById('memoryCount');
    if (memory.length > 0) {
        count.textContent = memory.length;
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

async function loadSavedChats() {
    const chatsList = document.getElementById('savedChatsList');
    const section = document.getElementById('savedChatsSection');

    if (savedChats.length > 0) {
        section.style.display = 'block';
        chatsList.innerHTML = '';
        [...savedChats].reverse().forEach(chat => {
            chatsList.appendChild(createChatButton(chat));
        });
    } else {
        section.style.display = 'none';
    }
}

function toggleSearchInput() {
    const searchInput = document.getElementById('chatSearch');
    if (searchInput.style.display === 'none') {
        searchInput.style.display = 'block';
        searchInput.focus();
        setTimeout(() => {
            document.addEventListener('click', hideSearchOnClickOutside);
        }, 0);
    } else {
        searchInput.style.display = 'none';
        searchInput.value = '';
        loadSavedChats();
        document.removeEventListener('click', hideSearchOnClickOutside);
    }
}

function hideSearchOnClickOutside(e) {
    const searchInput = document.getElementById('chatSearch');
    const section = document.getElementById('savedChatsSection');
    if (!section.contains(e.target)) {
        searchInput.style.display = 'none';
        searchInput.value = '';
        loadSavedChats();
        document.removeEventListener('click', hideSearchOnClickOutside);
    }
}

function searchChats() {
    const query = document.getElementById('chatSearch').value.toLowerCase();
    const chatsList = document.getElementById('savedChatsList');
    
    if (query === '') {
        loadSavedChats();
        return;
    }
    
    const filtered = savedChats.filter(chat => chat.title.toLowerCase().includes(query));
    
    chatsList.innerHTML = '';
    [...filtered].reverse().forEach(chat => {
        chatsList.appendChild(createChatButton(chat));
    });
}

function createChatButton(chat) {
    const btn = document.createElement('button');
    btn.className = 'menu-item chat-item';
    btn.style.position = 'relative';
    btn.innerHTML = `
        <span class="chat-title-text">${chat.title}</span>
        <span class="chat-menu-btn" onclick="event.stopPropagation(); toggleChatMenu(${chat.id}, event)">⋮</span>
    `;
    
    const menu = document.createElement('div');
    menu.className = 'chat-menu';
    menu.id = `chatMenu${chat.id}`;
    menu.innerHTML = `
        <div onclick="renameChat(${chat.id}, event)">Rename</div>
        <div onclick="pinChat(${chat.id}, event)">Pin</div>
        <div onclick="shareChat(${chat.id}, event)">Share</div>
        <div onclick="deleteChat(${chat.id}, event)">Delete</div>
    `;
    btn.appendChild(menu);
    
    btn.onclick = (e) => {
        if (!e.target.closest('.chat-menu-btn') && !e.target.closest('.chat-menu')) {
            loadChat(chat.id);
        }
    };
    return btn;
}

function deleteChat(chatId, event) {
    event.stopPropagation();
    if (confirm('Delete this chat?')) {
        savedChats = savedChats.filter(c => c.id !== chatId);
        localStorage.setItem('savedChats', JSON.stringify(savedChats));
        loadSavedChats();
    }
}

function toggleChatMenu(chatId, event) {
    event.stopPropagation();
    const menu = document.getElementById(`chatMenu${chatId}`);
    console.log('Menu element:', menu, 'ID:', `chatMenu${chatId}`);
    if (!menu) return;
    const allMenus = document.querySelectorAll('.chat-menu');
    allMenus.forEach(m => {
        if (m.id !== `chatMenu${chatId}`) m.style.display = 'none';
    });
    const currentDisplay = window.getComputedStyle(menu).display;
    menu.style.display = currentDisplay === 'none' ? 'block' : 'none';
    console.log('Menu display set to:', menu.style.display);
    
    if (menu.style.display === 'block') {
        setTimeout(() => {
            document.addEventListener('click', hideChatMenus);
        }, 0);
    }
}

function hideChatMenus() {
    const allMenus = document.querySelectorAll('.chat-menu');
    allMenus.forEach(m => m.style.display = 'none');
    document.removeEventListener('click', hideChatMenus);
}

function renameChat(chatId, event) {
    event.stopPropagation();
    const chat = savedChats.find(c => c.id === chatId);
    if (chat) {
        const newTitle = prompt('Enter new title:', chat.title);
        if (newTitle && newTitle.trim()) {
            chat.title = newTitle.trim();
            localStorage.setItem('savedChats', JSON.stringify(savedChats));
            loadSavedChats();
        }
    }
}

function pinChat(chatId, event) {
    event.stopPropagation();
    const chat = savedChats.find(c => c.id === chatId);
    if (chat) {
        chat.pinned = !chat.pinned;
        localStorage.setItem('savedChats', JSON.stringify(savedChats));
        loadSavedChats();
    }
}

function shareChat(chatId, event) {
    event.stopPropagation();
    const chat = savedChats.find(c => c.id === chatId);
    if (chat) {
        const chatText = chat.history.map(m => `${m.role}: ${m.content}`).join('\n\n');
        if (navigator.share) {
            navigator.share({ text: chatText, title: chat.title });
        } else {
            navigator.clipboard.writeText(chatText);
            alert('Chat copied to clipboard!');
        }
    }
}

async function loadChat(chatId) {
    const chat = savedChats.find(c => c.id === chatId);
    if (chat) {
        activeChatId = chatId;
        chatHistory = [...chat.history];
        localStorage.setItem('activeChatId', activeChatId);
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        document.getElementById('chatBox').innerHTML = '';
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('chatBox').style.display = 'block';
        
        chatHistory.forEach(msg => {
            if (msg.role !== 'system') {
                addMessage(msg.content, msg.role === 'user' ? 'user' : 'assistant', false);
            }
        });
    }
}

function addTaskPrompt() {
    const task = prompt('Enter task to add:');
    if (task) {
        sendMessage(`add task ${task}`);
    }
}

function removeTaskPrompt() {
    const task = prompt('Enter task to remove:');
    if (task) {
        sendMessage(`remove task ${task}`);
    }
}

function addMessage(text, type, shouldSpeak = true) {
    const chatBox = document.getElementById('chatBox');
    if (!chatBox) return;
    
    const msg = document.createElement('div');
    msg.className = `message ${type}`;

    let formattedText = text;
    formattedText = formattedText.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    formattedText = formattedText.replace(/`([^`]+)`/g, '<code>$1</code>');
    formattedText = formattedText.replace(/\n/g, '<br>');

    if (type === 'assistant') {
        msg.innerHTML = `
            <div class="message-content"><strong>Nexa AI:</strong><br>${formattedText}</div>
            <div class="message-actions">
                <button onclick="copyMessage(this)"title="Copy"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>
</button>
                <button onclick="likeMessage(this)" title="Like"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
</svg>
</button>
                <button onclick="dislikeMessage(this)" title="Dislike"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path>
</svg>
</button>
                <button onclick="shareMessage(this)" title="Share"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
  <polyline points="16 6 12 2 8 6"></polyline>
  <line x1="12" y1="2" x2="12" y2="15"></line>
</svg>
</button>
                <button onclick="regenerateMessage(this)" title="Regenerate"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M23 4v6h-6"></path>
  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
</svg>
</button>
            </div>
        `;
    } else {
        msg.innerHTML = `
            <div class="message-actions user-actions">
                <button onclick="editMessage(this)" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
</svg>
</button>
            </div>
            <div class="message-content">${formattedText}</div>
            </div>
        `;
    }
    
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;

    if (type === 'assistant' && text && shouldSpeak) {
        speak(text);
    }
}

function showThinking() {
    const chatBox = document.getElementById('chatBox');
    const thinking = document.createElement('div');
    thinking.className = 'message assistant thinking-message';
    thinking.innerHTML = '<div class="message-content">Nexa thinking...</div>';
    thinking.id = 'thinking-indicator';
    chatBox.appendChild(thinking);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function hideThinking() {
    const thinking = document.getElementById('thinking-indicator');
    if (thinking) thinking.remove();
}

function copyMessage(btn) {
    const messageContent = btn.closest('.message').querySelector('.message-content');
    const text = messageContent.innerText.replace('Nexa AI:', '').trim();
    navigator.clipboard.writeText(text);
}

function likeMessage(btn) {
    btn.style.color = '#10b981';
}

function dislikeMessage(btn) {
    btn.style.color = '#ef4444';
}

function shareMessage(btn) {
    const messageContent = btn.closest('.message').querySelector('.message-content');
    const text = messageContent.innerText.replace('Nexa AI:', '').trim();
    if (navigator.share) {
        navigator.share({ text });
    }
}

function regenerateMessage(btn) {
    const messageDiv = btn.closest('.message');
    const prevMessage = messageDiv.previousElementSibling;
    
    // Find the last user message
    let userMessages = document.querySelectorAll('.message.user');
    if (userMessages.length > 0) {
        const lastUserMessage = userMessages[userMessages.length - 1].querySelector('.message-content').innerText;
        
        // Show thinking indicator
        if (prevMessage && prevMessage.id === 'thinking-indicator') {
            prevMessage.querySelector('.message-content').textContent = 'Nexa thinking...';
            prevMessage.classList.add('thinking-message');
        } else {
            const thinkingDiv = document.createElement('div');
            thinkingDiv.className = 'message assistant thinking-message';
            thinkingDiv.innerHTML = '<div class="message-content">Nexa thinking...</div>';
            thinkingDiv.id = 'thinking-indicator';
            messageDiv.parentNode.insertBefore(thinkingDiv, messageDiv);
        }
        
        // Get new response
        fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: lastUserMessage })
        }).then(res => res.json()).then(data => {
            const thinking = document.getElementById('thinking-indicator');
            if (thinking) thinking.remove();
            
            // Update existing response
            messageDiv.querySelector('.message-content').innerHTML = 
                '<strong>Nexa AI:</strong><br>' + data.response.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
                          .replace(/`([^`]+)`/g, '<code>$1</code>')
                          .replace(/\n/g, '<br>');
            
            if (data.response) {
                speak(data.response);
            }
        });
    }
}

function editMessage(btn) {
    const messageContent = btn.parentElement.nextElementSibling;
    const currentText = messageContent.innerText;
    
    // Create input field
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentText;
    input.className = 'edit-input';
    input.style.cssText = `
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 20px;
        padding: 12px 18px;
        color: white;
        font-size: 15px;
        width: 100%;
        outline: none;
    `;
    
    // Replace content with input
    messageContent.innerHTML = '';
    messageContent.appendChild(input);
    input.focus();
    
    // Handle save on Enter
    input.onkeypress = function(e) {
        if (e.key === 'Enter') {
            const newText = input.value.trim();
            if (newText) {
                messageContent.innerHTML = newText;
                
                // Find and update the next assistant response
                const messageDiv = btn.closest('.message');
                let nextMessage = messageDiv.nextElementSibling;
                
                // Skip thinking indicator if present
                if (nextMessage && nextMessage.id === 'thinking-indicator') {
                    nextMessage = nextMessage.nextElementSibling;
                }
                
                if (nextMessage && nextMessage.classList.contains('assistant')) {
                    // Show thinking and update response
                    const thinkingDiv = document.createElement('div');
                    thinkingDiv.className = 'message assistant thinking-message';
                    thinkingDiv.innerHTML = '<div class="message-content">Nexa thinking...</div>';
                    thinkingDiv.id = 'thinking-indicator';
                    messageDiv.parentNode.insertBefore(thinkingDiv, nextMessage);
                    
                    // Get new response
                    fetch('/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: newText })
                    }).then(res => res.json()).then(data => {
                        thinkingDiv.remove();
                        
                        // Update existing response
                        nextMessage.querySelector('.message-content').innerHTML = 
                            '<strong>Nexa AI:</strong><br>' + data.response.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
                                      .replace(/`([^`]+)`/g, '<code>$1</code>')
                                      .replace(/\n/g, '<br>');
                        
                        if (data.response) {
                            speak(data.response);
                        }
                    });
                }
            }
        }
    };
}

async function sendMessage(query = null) {
    const input = document.getElementById('userInput');
    query = query || input.value.trim();
    if (!query) return;

    const welcomeScreen = document.getElementById('welcomeScreen');
    const chatBox = document.getElementById('chatBox');
    if (welcomeScreen.style.display !== 'none') {
        welcomeScreen.style.display = 'none';
        chatBox.style.display = 'block';
    }

    // Assign new chat ID if starting fresh chat
    if (activeChatId === null && chatHistory.length === 0) {
        activeChatId = currentChatId;
        currentChatId++;
        localStorage.setItem('activeChatId', activeChatId);
        localStorage.setItem('currentChatId', currentChatId);
    }

    addMessage(query, 'user');
    chatHistory.push({ role: 'user', content: query });
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    if (input) input.value = '';
    
    const queryLower = query.toLowerCase();
    
    // Handle tasks locally
    if (queryLower.includes('add task')) {
        const task = query.replace(/add task/i, '').trim();
        if (task) {
            tasks.push(task);
            localStorage.setItem('tasks', JSON.stringify(tasks));
            const response = `Task added: ${task}`;
            chatHistory.push({ role: 'assistant', content: response });
            localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
            addMessage(response, 'assistant');
            return;
        }
    }
    
    if (queryLower.includes('remove task')) {
        const task = query.replace(/remove task/i, '').trim();
        const index = tasks.indexOf(task);
        if (index > -1) {
            tasks.splice(index, 1);
            localStorage.setItem('tasks', JSON.stringify(tasks));
            const response = `Task removed: ${task}`;
            chatHistory.push({ role: 'assistant', content: response });
            localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
            addMessage(response, 'assistant');
        } else {
            const response = 'Task not found';
            chatHistory.push({ role: 'assistant', content: response });
            localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
            addMessage(response, 'assistant');
        }
        return;
    }
    
    if (queryLower.includes('list tasks') || queryLower.includes('show tasks') || queryLower === 'tasks' || queryLower === 'task') {
        const response = tasks.length > 0 
            ? 'Your tasks:\n\n' + tasks.map((t, i) => `${i+1}. ${t}`).join('\n')
            : 'No tasks found';
        chatHistory.push({ role: 'assistant', content: response });
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        addMessage(response, 'assistant');
        return;
    }
    
    // Memory commands
    if (queryLower.includes('save this in memory') || queryLower.includes('remember this')) {
        const info = query.replace(/save this in memory|remember this/i, '').trim();
        if (info) {
            memory.push(info);
            localStorage.setItem('nexaMemory', JSON.stringify(memory));
            const response = `Saved to memory: ${info}`;
            chatHistory.push({ role: 'assistant', content: response });
            localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
            addMessage(response, 'assistant');
            return;
        }
    }
    
    if (queryLower.includes('show memory') || queryLower.includes('what do you remember')) {
        const response = memory.length > 0 
            ? 'I remember:\n\n' + memory.map((m, i) => `${i+1}. ${m}`).join('\n')
            : 'No memories saved';
        chatHistory.push({ role: 'assistant', content: response });
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        addMessage(response, 'assistant');
        return;
    }
    
    showThinking();

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, history: chatHistory, tasks: tasks, memory: memory })
        });
        const data = await response.json();
        hideThinking();
        
        chatHistory.push({ role: 'assistant', content: data.response });
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        
        // Update memory and tasks from backend
        if (data.memory) {
            memory = data.memory;
            localStorage.setItem('nexaMemory', JSON.stringify(memory));
        }
        if (data.tasks) {
            tasks = data.tasks;
            localStorage.setItem('tasks', JSON.stringify(tasks));
        }
        
        addMessage(data.response, 'assistant');
        
        if (data.response) {
            speak(data.response);
        }
    } catch (e) {
        hideThinking();
        addMessage('Error connecting to server', 'assistant');
    }
}

async function sendCommand(cmd) {
    const welcomeScreen = document.getElementById('welcomeScreen');
    const chatBox = document.getElementById('chatBox');
    if (welcomeScreen.style.display !== 'none') {
        welcomeScreen.style.display = 'none';
        chatBox.style.display = 'block';
    }

    addMessage(cmd, 'user');
    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: cmd, history: chatHistory, tasks: tasks })
        });
        const data = await response.json();
        addMessage(data.response, 'assistant');
    } catch (e) {
        addMessage('Failed to send command', 'assistant');
    }
}

window.onload = function () {
    if (synth) {
        synth.getVoices();
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = () => synth.getVoices();
        }
    }

    // Load saved data
    loadSavedChats();
    
    // Restore current chat if exists
    if (chatHistory.length > 0) {
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('chatBox').style.display = 'block';
        chatHistory.forEach(msg => {
            if (msg.role !== 'system') {
                addMessage(msg.content, msg.role === 'user' ? 'user' : 'assistant', false);
            }
        });
    }
    
    // Set current model display
    if (document.getElementById('currentModelDisplay')) {
        document.getElementById('currentModelDisplay').textContent = currentModel;
    }
    
    // Close modal on outside click
    document.addEventListener('click', function(e) {
        const modal = document.getElementById('modelModal');
        if (modal && e.target === modal) {
            toggleModelSelector();
        }
    });
};
