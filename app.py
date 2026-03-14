# import packages
import os
import datetime
import psutil #type:ignore
import wikipedia #type:ignore
import requests #type:ignore
import pyautogui #type:ignore
import pywhatkit #type:ignore
from openai import OpenAI #type:ignore
import webbrowser
import time
import threading
from config import api_key, news_api_key
from flask import Flask, render_template, request, jsonify #type:ignore

os.environ['DISPLAY'] = ':0'

app = Flask(__name__)

# chatting setup 
client = OpenAI(api_key=api_key, base_url="https://api.sambanova.ai/v1")
chat_history = [{"role": "system", "content": "You are Nexa, a professional AI assistant. Always reply in plain text. Do NOT use emojis. Do NOT use symbols. Keep responses clean, short and formal."}]
tasks = []
saved_chats = []
current_chat_id = 0
current_model = "DeepSeek-V3.1"

def chat(query):
    global chat_history, current_model
    try:
        chat_history.append({"role": "user", "content": query})
        response = client.chat.completions.create(model=current_model, messages=chat_history, max_tokens=100, temperature=0.7)
        reply = response.choices[0].message.content
        chat_history.append({"role": "assistant", "content": reply})
        return reply
    except Exception as e:
        if "429" in str(e):
            time.sleep(5)
            return "Some Error Occured Sorry from nexa."
        return str(e)
    

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat_endpoint():
    query = request.json.get('query', '')
    query_lower = query.lower()
    
    # Time
    if "time" in query_lower:
        hour = datetime.datetime.now().strftime("%H")
        minute = datetime.datetime.now().strftime("%M")
        return jsonify({'response': f'Time is {hour}:{minute}'})
    
    # Battery
    elif "battery" in query_lower:
        battery = psutil.sensors_battery()
        if battery:
            return jsonify({'response': f"Battery is {battery.percent}%"})
        return jsonify({'response': 'Battery info not available'})
    
    # CPU
    elif "cpu" in query_lower:
        return jsonify({'response': f"CPU usage is {psutil.cpu_percent(interval=1)}%"})
    
    # RAM
    elif query_lower == "ram" or "ram usage" in query_lower or "memory usage" in query_lower:
        return jsonify({'response': f"RAM usage is {psutil.virtual_memory().percent}%"})
    # Screenshot
    elif "screenshot" in query_lower:
        if pyautogui:
            try:
                img = pyautogui.screenshot()
                img.save("screenshot.png")
                return jsonify({'response': 'Screenshot saved'})
            except:
                return jsonify({'response': 'Screenshot failed'})
        return jsonify({'response': 'Screenshot not available'})
    
    # Shutdown
    elif "shutdown" in query_lower:
        os.system("shutdown /s /t 5")
        return jsonify({'response': 'System shutting down in 5 seconds'})
    
    # Restart
    elif "restart" in query_lower:
        os.system("shutdown /r /t 5")
        return jsonify({'response': 'System restarting in 5 seconds'})

# Play song
    elif "play" in query_lower:
        song = query_lower.replace("play", "").strip()

        if song:
            pywhatkit.playonyt(song)
            return jsonify({'response': f'Playing {song}'})


# Open apps or websites
    elif "open" in query_lower:
        item = query_lower.replace("open", "").strip()

        apps = {
            "notepad": "notepad",
            "calculator": "calc",
            "chrome": "chrome",
            "vs code": "code",
            "cmd": "cmd",
            "powershell": "powershell"
        }

        # App open
        if item in apps:
            os.system(f"start {apps[item]}")
            return jsonify({'response': f'Opening {item}'})

        # Website open
        else:
            if "." not in item:
                url = f"https://www.{item}.com"
            else:
                url = f"https://{item}"

            webbrowser.open(url)
            return jsonify({'response': f'Opening {item}'})
        
    # Wikipedia
    elif "wikipedia" in query_lower:
        topic = query_lower.replace("wikipedia", "").strip()
        if topic:
            try:
                result = wikipedia.summary(topic, sentences=2)
                return jsonify({'response': result})
            except:
                return jsonify({'response': f'Could not find information about {topic}'})
        return jsonify({'response': 'Please specify a topic'})
    
    # News
    elif "news" in query_lower:
        try:
            url = f"https://newsapi.org/v2/top-headlines?country=us&apiKey={news_api_key}"
            response = requests.get(url, timeout=5)
            articles = response.json()['articles'][:5]
            news_list = [f"{i+1}. {article['title']}" for i, article in enumerate(articles)]
            return jsonify({'response': 'Top 5 News:\n\n' + '\n\n'.join(news_list)})
        except:
            return jsonify({'response': 'Unable to fetch news'})
    
    # Clean system
    elif "clean system" in query_lower:
        try:
            temp_folder = os.environ.get('TEMP')
            if not temp_folder:
                return jsonify({'response': 'Temp folder not found'})
            files_removed = 0
            for file in os.listdir(temp_folder):
                try:
                    file_path = os.path.join(temp_folder, file)
                    if os.path.isfile(file_path):
                        os.remove(file_path)
                        files_removed += 1
                except:
                    pass
            return jsonify({'response': f'System cleaned! Removed {files_removed} files'})
        except:
            return jsonify({'response': 'System cleanup failed'})
    
    # Tasks
    elif "add task" in query_lower:
        task = query_lower.replace("add task", "").strip()
        if task:
            tasks.append(task)
            return jsonify({'response': f'Task added: {task}'})
        return jsonify({'response': 'Please specify a task'})
    
    elif "remove task" in query_lower:
        task = query_lower.replace("remove task", "").strip()
        if task in tasks:
            tasks.remove(task)
            return jsonify({'response': f'Task removed: {task}'})
        return jsonify({'response': 'Task not found'})
    
    elif "list tasks" in query_lower or "show tasks" in query_lower:
        if tasks:
            task_list = '\n'.join([f"{i+1}. {t}" for i, t in enumerate(tasks)])
            return jsonify({'response': f'Your tasks:\n\n{task_list}'})
        return jsonify({'response': 'No tasks'})
    
    # Joke
    elif "joke" in query_lower:
        try:
            response = requests.get("https://official-joke-api.appspot.com/random_joke", timeout=5)
            joke_data = response.json()
            return jsonify({'response': f"{joke_data['setup']}\n\n{joke_data['punchline']}"})
        except:
            import random
            jokes = [
                "Why do programmers prefer dark mode? Because light attracts bugs!",
                "Why did the developer go broke? Because he used up all his cache!"
            ]
            return jsonify({'response': random.choice(jokes)})
    
    # Reset chat
    elif "reset chat" in query_lower or "new chat" in query_lower:
        global chat_history, saved_chats, current_chat_id
        
        # Save current chat if it has user messages (more than just system message)
        if len(chat_history) > 1:
            # Get first user message as title
            first_user_msg = None
            for msg in chat_history:
                if msg['role'] == 'user':
                    first_user_msg = msg['content'][:30]
                    break
            
            chat_title = first_user_msg if first_user_msg else "New Chat"
            saved_chats.append({
                'id': current_chat_id,
                'title': chat_title,
                'history': chat_history.copy()
            })
            current_chat_id += 1
            print(f"Chat saved: {chat_title}, Total chats: {len(saved_chats)}")
        
        # Reset to new chat
        chat_history = [{"role": "system", "content": "You are Nexa, a professional AI assistant. Always reply in plain text. Do NOT use emojis. Do NOT use symbols. Keep responses clean, short and formal."}]
        return jsonify({'response': 'New chat started. Previous chat saved.', 'saved': True})
    
    # Chat history
    elif "chat history" in query_lower:
        if len(chat_history) > 1:
            history_text = '\n\n'.join([f"{msg['role'].upper()}: {msg['content']}" for msg in chat_history[1:]])
            return jsonify({'response': f'Chat History:\n\n{history_text}'})
        return jsonify({'response': 'No chat history yet'})
    
    # Default: AI chat
    else:
        response = chat(query)
        return jsonify({'response': response})

@app.route('/command', methods=['POST'])
def command():
    query = request.json.get('query', '').lower()
    
    if "shutdown" in query:
        os.system("shutdown /s /t 5")
        return jsonify({'response': 'System shutting down in 5 seconds'})
    
    elif "restart" in query:
        os.system("shutdown /r /t 5")
        return jsonify({'response': 'System restarting in 5 seconds'})
    
    elif "clean system" in query:
        try:
            temp_folder = os.environ.get('TEMP')
            if not temp_folder:
                return jsonify({'response': 'Temp folder not found'})
            files_removed = 0
            for file in os.listdir(temp_folder):
                try:
                    file_path = os.path.join(temp_folder, file)
                    if os.path.isfile(file_path):
                        os.remove(file_path)
                        files_removed += 1
                except:
                    pass
            return jsonify({'response': f'System cleaned! Removed {files_removed} files'})
        except:
            return jsonify({'response': 'System cleanup failed'})
    
    elif query.startswith("add task "):
        task = query.replace("add task", "").strip()
        if task:
            tasks.append(task)
            return jsonify({'response': f'Task added: {task}'})
        return jsonify({'response': 'Please specify a task'})
    
    elif query.startswith("remove task "):
        task = query.replace("remove task", "").strip()
        if task in tasks:
            tasks.remove(task)
            return jsonify({'response': f'Task removed: {task}'})
        return jsonify({'response': 'Task not found'})
    
    elif "list tasks" in query:
        if tasks:
            task_list = '\n'.join([f"{i+1}. {t}" for i, t in enumerate(tasks)])
            return jsonify({'response': f'Your tasks:\n\n{task_list}'})
        return jsonify({'response': 'No tasks'})
    
    else:
        response = chat(query)
        return jsonify({'response': response})

@app.route('/saved_chats', methods=['GET'])
def get_saved_chats():
    return jsonify({'chats': saved_chats})

@app.route('/load_chat/<int:chat_id>', methods=['POST'])
def load_chat(chat_id):
    global chat_history
    for chat in saved_chats:
        if chat['id'] == chat_id:
            chat_history = chat['history'].copy()
            return jsonify({'response': 'Chat loaded', 'history': chat_history})
    return jsonify({'response': 'Chat not found'})

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/features')
def features():
    return render_template('features.html')

@app.route('/contact')
def contact():
    return render_template('contact.html')

@app.route('/set_model', methods=['POST'])
def set_model():
    global current_model
    model = request.json.get('model', 'DeepSeek-V3.1')
    current_model = model
    return jsonify({'response': f'Model changed to {model}'})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
    
