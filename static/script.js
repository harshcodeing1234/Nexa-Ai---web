let speakerEnabled = true;
let recognition;
let synth = window.speechSynthesis;
let currentModel = localStorage.getItem('currentModel') || 'DeepSeek-V3.1';
let tasks = JSON.parse(localStorage.getItem('tasks')) || [];
let savedChats = JSON.parse(localStorage.getItem('savedChats')) || [];
let currentChatId = parseInt(localStorage.getItem('currentChatId')) || 0;
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
        savedChats.push({
            id: currentChatId++,
            title: firstUserMsg,
            history: [...chatHistory]
        });
        localStorage.setItem('savedChats', JSON.stringify(savedChats));
        localStorage.setItem('currentChatId', currentChatId);
    }
    
    chatHistory = [];
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    document.getElementById('chatBox').innerHTML = '';
    document.getElementById('chatBox').style.display = 'none';
    document.getElementById('welcomeScreen').style.display = 'flex';
    loadSavedChats();
}

async function loadSavedChats() {
    const chatsList = document.getElementById('savedChatsList');
    const section = document.getElementById('savedChatsSection');

    if (savedChats.length > 0) {
        section.style.display = 'block';
        chatsList.innerHTML = '';
        [...savedChats].reverse().forEach(chat => {
            const btn = document.createElement('button');
            btn.className = 'menu-item chat-item';
            btn.innerHTML = `
                <span class="menu-icon">💬</span>
                <span style="flex: 1; text-align: left;">${chat.title}</span>
                <span onclick="deleteChat(${chat.id}, event)" style="color: #ef4444; cursor: pointer; padding: 0 8px;" title="Delete">🗑️</span>
            `;
            btn.onclick = (e) => {
                if (!e.target.closest('span[onclick*="deleteChat"]')) {
                    loadChat(chat.id);
                }
            };
            chatsList.appendChild(btn);
        });
    } else {
        section.style.display = 'none';
    }
}

function searchChats() {
    const query = document.getElementById('chatSearch').value.toLowerCase();
    const chatsList = document.getElementById('savedChatsList');
    
    chatsList.innerHTML = '';
    const filtered = savedChats.filter(chat => chat.title.toLowerCase().includes(query));
    
    [...filtered].reverse().forEach(chat => {
        const btn = document.createElement('button');
        btn.className = 'menu-item chat-item';
        btn.innerHTML = `
            <span class="menu-icon">💬</span>
            <span style="flex: 1; text-align: left;">${chat.title}</span>
            <span onclick="deleteChat(${chat.id}, event)" style="color: #ef4444; cursor: pointer; padding: 0 8px;" title="Delete">🗑️</span>
        `;
        btn.onclick = (e) => {
            if (!e.target.closest('span[onclick*="deleteChat"]')) {
                loadChat(chat.id);
            }
        };
        chatsList.appendChild(btn);
    });
}

function deleteChat(chatId, event) {
    event.stopPropagation();
    if (confirm('Delete this chat?')) {
        savedChats = savedChats.filter(c => c.id !== chatId);
        localStorage.setItem('savedChats', JSON.stringify(savedChats));
        loadSavedChats();
    }
}

async function loadChat(chatId) {
    const chat = savedChats.find(c => c.id === chatId);
    if (chat) {
        chatHistory = [...chat.history];
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
        tasks.push(task);
        localStorage.setItem('tasks', JSON.stringify(tasks));
        addMessage(`Task added: ${task}`, 'assistant');
    }
}

function removeTaskPrompt() {
    const task = prompt('Enter task to remove:');
    if (task) {
        const index = tasks.indexOf(task);
        if (index > -1) {
            tasks.splice(index, 1);
            localStorage.setItem('tasks', JSON.stringify(tasks));
            addMessage(`Task removed: ${task}`, 'assistant');
        } else {
            addMessage('Task not found', 'assistant');
        }
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
                <button onclick="copyMessage(this)" title="Copy">📋</button>
                <button onclick="likeMessage(this)" title="Like">👍</button>
                <button onclick="dislikeMessage(this)" title="Dislike">👎</button>
                <button onclick="shareMessage(this)" title="Share">📤</button>
                <button onclick="regenerateMessage(this)" title="Regenerate">🔄</button>
            </div>
        `;
    } else {
        msg.innerHTML = `
            <div class="message-content">${formattedText}</div>
            <div class="message-actions user-actions">
                <button onclick="editMessage(this)" title="Edit">✏️</button>
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
    const messageContent = btn.parentElement.previousElementSibling;
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

    addMessage(query, 'user');
    chatHistory.push({ role: 'user', content: query });
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    input.value = '';
    
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
        
        const responseMsg = document.createElement('div');
        responseMsg.className = 'message assistant';
        responseMsg.style.marginTop = '0px';
        responseMsg.innerHTML = `
            <div class="message-content"><strong>Nexa AI:</strong><br>${data.response.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>')}</div>
            <div class="message-actions">
                <button onclick="copyMessage(this)" title="Copy">📋</button>
                <button onclick="likeMessage(this)" title="Like">👍</button>
                <button onclick="dislikeMessage(this)" title="Dislike">👎</button>
                <button onclick="shareMessage(this)" title="Share">📤</button>
                <button onclick="regenerateMessage(this)" title="Regenerate">🔄</button>
            </div>
        `;
        document.getElementById('chatBox').appendChild(responseMsg);
        document.getElementById('chatBox').scrollTop = document.getElementById('chatBox').scrollHeight;
        
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
