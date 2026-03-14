let speakerEnabled = true;
let recognition;
let synth = window.speechSynthesis;
let currentModel = 'DeepSeek-V3.1';

function toggleModelSelector() {
    const modal = document.getElementById('modelModal');
    console.log('Toggle modal:', modal);
    if (!modal) {
        console.error('Modal not found!');
        return;
    }
    modal.classList.toggle('active');
    console.log('Modal active:', modal.classList.contains('active'));
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
    try {
        await fetch('/set_model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model })
        });
        toggleModelSelector();
        addMessage(`Model changed to ${model}`, 'assistant');
    } catch (e) {
        addMessage('Error changing model', 'assistant');
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
        console.error('Speech recognition error:', event.error);
        document.getElementById('micBtn').classList.remove('listening');
    };
}

function startVoice() {
    if (recognition) {
        try {
            document.getElementById('micBtn').classList.add('listening');
            recognition.start();
        } catch (e) {
            console.error('Error starting recognition:', e);
            document.getElementById('micBtn').classList.remove('listening');
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
    document.getElementById('sidebar').classList.toggle('hidden');
}

function newChat() {
    fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'new chat' })
    }).then(res => res.json()).then(data => {
        console.log('New chat response:', data);
        document.getElementById('chatBox').innerHTML = '';
        setTimeout(loadSavedChats, 300);
        addMessage('Hello! I am Nexa AI Assistant. How can I help you today?', 'assistant');
    });
}

async function loadSavedChats() {
    try {
        const response = await fetch('/saved_chats');
        const data = await response.json();
        console.log('Saved chats:', data);
        const chatsList = document.getElementById('savedChatsList');
        const section = document.getElementById('savedChatsSection');

        if (data.chats && data.chats.length > 0) {
            section.style.display = 'block';
            chatsList.innerHTML = '';
            const chatsToShow = [...data.chats].reverse();
            chatsToShow.forEach(chat => {
                const btn = document.createElement('button');
                btn.className = 'menu-item chat-item';
                btn.innerHTML = `<span class="menu-icon">💬</span>${chat.title}`;
                btn.onclick = () => loadChat(chat.id);
                chatsList.appendChild(btn);
            });
        } else {
            section.style.display = 'none';
        }
    } catch (e) {
        console.error('Error loading saved chats:', e);
    }
}

async function loadChat(chatId) {
    try {
        const response = await fetch(`/load_chat/${chatId}`, { method: 'POST' });
        const data = await response.json();

        if (data.history) {
            document.getElementById('chatBox').innerHTML = '';
            data.history.forEach(msg => {
                if (msg.role !== 'system') {
                    addMessage(msg.content, msg.role === 'user' ? 'user' : 'assistant');
                }
            });
        }
    } catch (e) {
        console.error('Error loading chat:', e);
    }
}

function addTaskPrompt() {
    const task = prompt('Enter task to add:');
    if (task) {
        sendCommand(`add task ${task}`);
    }
}

function removeTaskPrompt() {
    const task = prompt('Enter task to remove:');
    if (task) {
        sendCommand(`remove task ${task}`);
    }
}

function addMessage(text, type) {
    const chatBox = document.getElementById('chatBox');
    const msg = document.createElement('div');
    msg.className = `message ${type}`;

    let formattedText = text;
    formattedText = formattedText.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    formattedText = formattedText.replace(/`([^`]+)`/g, '<code>$1</code>');
    formattedText = formattedText.replace(/\n/g, '<br>');

    msg.innerHTML = `
        <div class="avatar">${type === 'user' ? 'U' : 'N'}</div>
        <div class="message-content">${formattedText}</div>
    `;
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;

    if (type === 'assistant' && text) {
        speak(text);
    }
}

async function sendMessage() {
    const input = document.getElementById('userInput');
    const query = input.value.trim();
    if (!query) return;

    addMessage(query, 'user');
    input.value = '';

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const data = await response.json();
        addMessage(data.response, 'assistant');
    } catch (e) {
        addMessage('Error connecting to server', 'assistant');
    }
}

async function sendCommand(cmd) {
    addMessage(cmd, 'user');

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: cmd })
        });
        const data = await response.json();
        addMessage(data.response, 'assistant');

        if (cmd.includes('new chat') || cmd.includes('reset chat')) {
            setTimeout(loadSavedChats, 500);
        }
    } catch (e) {
        addMessage('Error connecting to server', 'assistant');
    }
}

window.onload = function () {
    if (synth) {
        synth.getVoices();
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = () => synth.getVoices();
        }
    }

    const btn = document.getElementById('speakerBtn');
    btn.classList.add('speaking');
    loadSavedChats();
    addMessage('Hello! I am Nexa AI Assistant. How can I help you today?', 'assistant');
    
    // Close modal on outside click
    document.addEventListener('click', function(e) {
        const modal = document.getElementById('modelModal');
        if (modal && e.target === modal) {
            toggleModelSelector();
        }
    });
};
