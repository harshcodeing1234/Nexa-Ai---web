# import packages
import os
import datetime
import wikipedia #type:ignore
import requests #type:ignore
from openai import OpenAI #type:ignore
import time
import re
import logging
from logging.handlers import RotatingFileHandler
from config import api_key, news_api_key
from flask import Flask, render_template, request, jsonify, abort #type:ignore
from flask_cors import CORS #type:ignore
from flask_limiter import Limiter #type:ignore
from flask_limiter.util import get_remote_address #type:ignore

os.environ['DISPLAY'] = ':0'

# Setup logging
os.makedirs('logs', exist_ok=True)
logger = logging.getLogger('nexa_ai')
logger.setLevel(logging.INFO)
handler = RotatingFileHandler('logs/nexa.log', maxBytes=10000000, backupCount=3)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

app = Flask(__name__)

# Security configurations
CORS(app, resources={r"/*": {"origins": "*"}})
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# chatting setup 
client = OpenAI(api_key=api_key, base_url="https://api.sambanova.ai/v1")
tasks = []
saved_chats = []
current_chat_id = 0
current_model = "DeepSeek-V3.1"

# Input validation
def sanitize_input(text, max_length=500):
    """Sanitize and validate user input"""
    if not text or not isinstance(text, str):
        abort(400, 'Invalid input')
    if len(text) > max_length:
        abort(400, f'Input too long. Maximum {max_length} characters')
    # Remove potentially dangerous characters but keep basic punctuation
    sanitized = re.sub(r'[<>{}[\]\\]', '', text)
    return sanitized.strip()

def chat(query, history=[]):
    global current_model
    try:
        messages = [{"role": "system", "content": "You are Nexa, a professional AI assistant. Always reply in plain text. Do NOT use emojis. Do NOT use symbols. Keep responses clean, short and formal."}]
        messages.extend(history[-10:])  # Last 10 messages for context
        messages.append({"role": "user", "content": query})
        
        response = client.chat.completions.create(model=current_model, messages=messages, temperature=0.7)
        reply = response.choices[0].message.content
        logger.info(f"Chat successful - Model: {current_model}")
        return reply
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        if "429" in str(e):
            time.sleep(5)
            return "Rate limit exceeded. Please try again in a moment."
        return "An error occurred. Please try again."
    

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
@limiter.limit("30 per minute")
def chat_endpoint():
    try:
        query = sanitize_input(request.json.get('query', ''))
        history = request.json.get('history', [])
        query_lower = query.lower()
        
        logger.info(f"Chat request: {query[:50]}...")
        
        # Wikipedia
        if "wikipedia" in query_lower:
            topic = query_lower.replace("wikipedia", "").strip()
            if topic:
                try:
                    result = wikipedia.summary(topic, sentences=2)
                    logger.info(f"Wikipedia search: {topic}")
                    return jsonify({'response': result})
                except Exception as e:
                    logger.error(f"Wikipedia error: {str(e)}")
                    return jsonify({'response': f'Could not find information about {topic}'})
            return jsonify({'response': 'Please specify a topic'})
        
        # News
        elif "news" in query_lower:
            try:
                url = f"https://newsapi.org/v2/top-headlines?country=us&apiKey={news_api_key}"
                response = requests.get(url, timeout=5)
                articles = response.json()['articles'][:5]
                news_list = [f"{i+1}. {article['title']}" for i, article in enumerate(articles)]
                logger.info("News fetched successfully")
                return jsonify({'response': 'Top 5 News:\n\n' + '\n\n'.join(news_list)})
            except Exception as e:
                logger.error(f"News fetch error: {str(e)}")
                return jsonify({'response': 'Unable to fetch news'})
        
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
        
        # Default: AI chat
        else:
            response = chat(query, history)
            return jsonify({'response': response})
    
    except Exception as e:
        logger.error(f"Chat endpoint error: {str(e)}")
        return jsonify({'response': 'An error occurred. Please try again.'}), 500

@app.route('/command', methods=['POST'])
@limiter.limit("20 per minute")
def command():
    try:
        query = sanitize_input(request.json.get('query', '')).lower()
        history = request.json.get('history', [])
        
        logger.info(f"Command request: {query}")
        
        response = chat(query, history)
        return jsonify({'response': response})
    
    except Exception as e:
        logger.error(f"Command endpoint error: {str(e)}")
        return jsonify({'response': 'An error occurred. Please try again.'}), 500

@app.route('/saved_chats', methods=['GET'])
@limiter.limit("60 per minute")
def get_saved_chats():
    try:
        return jsonify({'chats': []})
    except Exception as e:
        logger.error(f"Error fetching saved chats: {str(e)}")
        return jsonify({'chats': []}), 500

@app.route('/load_chat/<int:chat_id>', methods=['POST'])
@limiter.limit("30 per minute")
def load_chat(chat_id):
    try:
        return jsonify({'response': 'Chat loaded', 'history': []}), 200
    except Exception as e:
        logger.error(f"Error loading chat: {str(e)}")
        return jsonify({'response': 'Error loading chat'}), 500

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
@limiter.limit("20 per minute")
def set_model():
    try:
        global current_model
        model = sanitize_input(request.json.get('model', 'DeepSeek-V3.1'))
        
        # Validate model name
        valid_models = [
            'DeepSeek-V3.2', 
            'Qwen3-235B', 
            'DeepSeek-R1-0528', 
            'Meta-Llama-3.1-8B-Instruct', 
            'DeepSeek-V3.1'
        ]
        
        if model not in valid_models:
            logger.warning(f"Invalid model requested: {model}")
            return jsonify({'response': 'Invalid model selected'}), 400
        
        current_model = model
        logger.info(f"Model changed to: {model}")
        return jsonify({'response': f'Model changed to {model}'})
    
    except Exception as e:
        logger.error(f"Error changing model: {str(e)}")
        return jsonify({'response': 'Error changing model'}), 500

if __name__ == "__main__":
    logger.info("Starting Nexa AI application")
    try:
        port = int(os.environ.get("PORT", 8080))
        app.run(host="0.0.0.0", port=port, debug=False)
    except Exception as e:
        logger.critical(f"Application failed to start: {str(e)}")
        raise
    
