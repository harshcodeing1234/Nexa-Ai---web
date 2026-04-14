from flask import Flask, render_template, request, jsonify, session, Response, stream_with_context, redirect #type:ignore
from werkzeug.security import generate_password_hash, check_password_hash #type:ignore
from werkzeug.utils import secure_filename #type:ignore
from openai import OpenAI #type:ignore
import sqlite3, os, json, re, secrets, logging, html, sys
import urllib.request, urllib.parse, urllib.error
import bleach #type:ignore
from functools import wraps
from datetime import datetime, timedelta
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Validate required environment variables
def validate_environment():
    required_vars = ['SAMBANOVA_API_KEY', 'SECRET_KEY']
    missing = [var for var in required_vars if not os.environ.get(var)]
    if missing:
        logger.error(f"Missing required environment variables: {', '.join(missing)}")
        print(f"❌ ERROR: Missing required environment variables: {', '.join(missing)}")
        print("Please set them in your .env file or environment.")
        sys.exit(1)
    logger.info("✅ Environment variables validated")

# Load environment variables from .env file
env_path = Path(__file__).parent / '.env'
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip())

# Validate environment after loading
validate_environment()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', os.urandom(24).hex())
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('SESSION_COOKIE_SECURE', 'False').lower() == 'true'
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 2592000  # 30 days in seconds
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max request size

DB_PATH = os.environ.get('DATABASE_PATH', os.path.join(os.path.dirname(__file__), 'nexa_ai.db'))
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads', 'photos')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'doc', 'docx', 'csv', 'xlsx'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

# OpenAI client setup
api_key = os.environ.get('SAMBANOVA_API_KEY', '')
client = OpenAI(api_key=api_key, base_url="https://api.sambanova.ai/v1") if api_key else None

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://api.sambanova.ai"
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    
    # CORS headers for mobile/network access
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS, PUT'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRF-Token, Authorization'
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    
    return response

# CSRF Protection
def generate_csrf_token():
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_hex(32)
    return session['csrf_token']

def validate_csrf_token():
    token = request.headers.get('X-CSRF-Token') or request.form.get('csrf_token')
    return token and token == session.get('csrf_token')

app.jinja_env.globals['csrf_token'] = generate_csrf_token

# Simple in-memory rate limiting
rate_limit_store = {}

def rate_limit(max_requests=10, window=60):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            key = f"{request.remote_addr}:{f.__name__}"
            now = datetime.now().timestamp()
            
            # Clean old entries
            if key in rate_limit_store:
                rate_limit_store[key] = [t for t in rate_limit_store[key] if now - t < window]
            else:
                rate_limit_store[key] = []
            
            # Check limit
            if len(rate_limit_store[key]) >= max_requests:
                logger.warning(f"Rate limit exceeded for {key}")
                return jsonify({'error': 'Rate limit exceeded. Try again later.'}), 429
            
            # Add current request
            rate_limit_store[key].append(now)
            return f(*args, **kwargs)
        return wrapped
    return decorator

# CSRF protection decorator
def csrf_required(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if request.method in ['POST', 'PATCH', 'DELETE', 'PUT']:
            # Skip CSRF check for OPTIONS requests (CORS preflight)
            if request.method == 'OPTIONS':
                return f(*args, **kwargs)
            
            if not validate_csrf_token():
                logger.warning(f"CSRF validation failed for {request.endpoint} from {request.remote_addr}")
                return jsonify({'error': 'Invalid CSRF token'}), 403
        return f(*args, **kwargs)
    return wrapped

def validate_email(email):
    return re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email) if email else False

def validate_phone(phone):
    return re.match(r'^\+?[1-9]\d{1,14}$', phone.replace(' ', '').replace('-', '')) if phone else False

def validate_password_strength(password):
    """Require 8+ chars, 1 uppercase, 1 lowercase, 1 number"""
    if len(password) < 8:
        return False, "Password must be at least 8 characters"
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter"
    if not re.search(r'\d', password):
        return False, "Password must contain at least one number"
    return True, ""

def sanitize_input(text, max_length=4000):
    if not text: return ''
    # HTML escape to prevent XSS
    return html.escape(str(text).strip()[:max_length])

def sanitize_html_output(text):
    """Sanitize HTML using bleach whitelist approach"""
    if not text: return ''
    allowed_tags = ['p', 'br', 'strong', 'em', 'u', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'img', 'div', 'span']
    allowed_attrs = {'a': ['href', 'title', 'target', 'download', 'style'], 'img': ['src', 'alt', 'style', 'onclick'], 'div': ['style'], 'span': ['style']}
    return bleach.clean(text, tags=allowed_tags, attributes=allowed_attrs, strip=True)

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn

def init_db():
    with get_db() as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE,
                phone TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                theme TEXT DEFAULT 'dark',
                photo TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                title TEXT DEFAULT 'New Chat',
                model TEXT DEFAULT 'nexa-pro',
                is_saved INTEGER DEFAULT 0,
                is_pinned INTEGER DEFAULT 0,
                is_temporary INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                session_id TEXT,
                title TEXT NOT NULL,
                completed INTEGER DEFAULT 0,
                priority TEXT DEFAULT 'normal',
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS diary_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                session_id TEXT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
        ''')
        
        # Create indexes for performance
        indexes = [
            'CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, created_at DESC)',
            'CREATE INDEX IF NOT EXISTS idx_chats_pinned ON chats(is_pinned, created_at DESC)',
            'CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, completed)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id, completed)',
        ]
        for idx in indexes:
            try:
                db.execute(idx)
            except Exception as e:
                logger.error(f"Index creation error: {e}")
        
        # Add columns if missing (migrations)
        migrations = [
            "ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'normal'",
            "ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'dark'",
            "ALTER TABLE users ADD COLUMN photo TEXT"
        ]
        for migration in migrations:
            try:
                db.execute(migration)
            except:
                pass
        
        db.commit()
        logger.info("Database initialized successfully")

init_db()

# ─── Pages ────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    # Detect mobile and redirect to chat
    user_agent = request.headers.get('User-Agent', '').lower()
    is_mobile = any(x in user_agent for x in ['mobile', 'android', 'iphone', 'ipad', 'ipod'])
    
    if is_mobile:
        return redirect('/chat')
    
    return render_template('index.html')

@app.route('/splash')
def splash():
    return render_template('splash.html')

@app.route('/auth')
def auth():
    return render_template('auth.html')

@app.route('/chat')
def chat_page():
    return render_template('chat.html')

@app.route('/diary')
def diary_page():
    return render_template('chat.html')

@app.route('/uploads/files/<path:filename>')
def uploaded_file(filename):
    from flask import send_from_directory
    return send_from_directory(os.path.join(UPLOAD_FOLDER, '..', 'files'), filename)

@app.route('/api/csrf-token')
def get_csrf_token():
    return jsonify({'csrf_token': generate_csrf_token()})

@app.route('/api/log-error', methods=['POST'])
def log_error():
    try:
        error = request.json
        logger.error(f"Client error: {error.get('message')} | URL: {error.get('url')} | Time: {error.get('timestamp')}")
        if error.get('stack'):
            logger.error(f"Stack: {error.get('stack')[:500]}")
        return jsonify({'success': True}), 200
    except:
        return jsonify({'success': False}), 200  # Silent fail

@app.errorhandler(404)
def not_found(e):
    return render_template('404.html'), 404

@app.errorhandler(413)
def request_too_large(e):
    logger.warning(f"Request too large from {request.remote_addr}")
    return jsonify({'error': 'Request too large. Maximum size is 16MB.'}), 413

@app.errorhandler(500)
def internal_error(e):
    logger.error(f"Internal error: {e}")
    return jsonify({'error': 'Internal server error. Please try again later.'}), 500

# ─── Auth API ─────────────────────────────────────────────────────────────────
@app.route('/api/signup', methods=['POST'])
@rate_limit(max_requests=5, window=300)
@csrf_required
def signup():
    try:
        d = request.json
        name = sanitize_input(d.get('name'), 100)
        email = sanitize_input(d.get('email'), 255)
        phone = sanitize_input(d.get('phone'), 20)
        password = d.get('password', '')
        
        if not name or len(name) < 2:
            return jsonify({'error': 'Name must be at least 2 characters'}), 400
        
        # Validate password strength
        valid, msg = validate_password_strength(password)
        if not valid:
            return jsonify({'error': msg}), 400
        
        if not email and not phone:
            return jsonify({'error': 'Email or phone required'}), 400
        if email and not validate_email(email):
            return jsonify({'error': 'Invalid email format'}), 400
        if phone and not validate_phone(phone):
            return jsonify({'error': 'Invalid phone format'}), 400
        
        with get_db() as db:
            db.execute('INSERT INTO users (name, email, phone, password_hash) VALUES (?,?,?,?)',
                       (name, email or None, phone or None, generate_password_hash(password)))
            db.commit()
            user = db.execute('SELECT * FROM users WHERE name=? ORDER BY id DESC LIMIT 1', (name,)).fetchone()
            session.permanent = True
            session['user_id'] = user['id']
            session['user_name'] = user['name']
            logger.info(f"New user signup: {name}")
            return jsonify({'success': True, 'name': user['name']})
    except sqlite3.IntegrityError as e:
        msg = str(e).lower()
        if 'email' in msg: return jsonify({'error': 'Email already registered'}), 400
        if 'phone' in msg: return jsonify({'error': 'Phone already registered'}), 400
        return jsonify({'error': 'Registration failed'}), 400
    except Exception as e:
        logger.error(f"Signup error: {e}")
        return jsonify({'error': 'Server error occurred'}), 500

@app.route('/api/login', methods=['POST'])
@rate_limit(max_requests=5, window=300)
@csrf_required
def login():
    try:
        d = request.json
        identifier = sanitize_input(d.get('identifier'), 255)
        password = d.get('password', '')
        
        if not identifier or not password:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        with get_db() as db:
            user = db.execute('SELECT * FROM users WHERE email=? OR phone=?', (identifier, identifier)).fetchone()
            if not user or not check_password_hash(user['password_hash'], password):
                logger.warning(f"Failed login attempt for: {identifier}")
                return jsonify({'error': 'Invalid credentials'}), 401
            session.permanent = True
            session['user_id'] = user['id']
            session['user_name'] = user['name']
            logger.info(f"User login: {user['name']}")
            return jsonify({'success': True, 'name': user['name'], 'theme': user['theme'] or 'dark'})
    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({'error': 'Server error occurred'}), 500

@app.route('/api/logout', methods=['POST'])
@csrf_required
def logout():
    user_name = session.get('user_name', 'Unknown')
    session.clear()
    logger.info(f"User logout: {user_name}")
    return jsonify({'success': True})

# Password reset storage (in-memory)
reset_tokens = {}  # {token: {'identifier': 'email', 'expires': timestamp}}

@app.route('/api/forgot-password', methods=['POST'])
@rate_limit(max_requests=3, window=300)
@csrf_required
def forgot_password():
    try:
        d = request.json
        identifier = sanitize_input(d.get('identifier'), 255)
        
        if not identifier:
            return jsonify({'error': 'Email or phone required'}), 400
        
        with get_db() as db:
            user = db.execute('SELECT * FROM users WHERE email=? OR phone=?', (identifier, identifier)).fetchone()
            if not user:
                return jsonify({'success': True, 'message': 'If account exists, reset link sent'})
            
            # Generate unique token
            token = secrets.token_urlsafe(32)
            expires = datetime.now() + timedelta(hours=1)
            
            # Store token
            reset_tokens[token] = {'identifier': identifier, 'expires': expires}
            
            # Generate reset link
            reset_link = f"{request.host_url}reset-password?token={token}"
            
            logger.info(f"Reset link for {identifier}: {reset_link}")
            
            return jsonify({'success': True, 'message': 'Reset link generated', 'link': reset_link})
    except Exception as e:
        logger.error(f"Forgot password error: {e}")
        return jsonify({'error': 'Server error occurred'}), 500

@app.route('/reset-password')
def reset_password_page():
    token = request.args.get('token')
    if not token or token not in reset_tokens:
        return render_template('404.html'), 404
    
    # Check expiration
    if datetime.now() > reset_tokens[token]['expires']:
        del reset_tokens[token]
        return render_template('404.html'), 404
    
    return render_template('reset_password.html', token=token)

@app.route('/api/reset-password', methods=['POST'])
@rate_limit(max_requests=5, window=300)
@csrf_required
def reset_password():
    try:
        d = request.json
        token = d.get('token', '')
        password = d.get('password', '')
        
        if not token or not password:
            return jsonify({'error': 'All fields required'}), 400
        
        # Validate password strength
        valid, msg = validate_password_strength(password)
        if not valid:
            return jsonify({'error': msg}), 400
        
        # Check token
        if token not in reset_tokens:
            return jsonify({'error': 'Invalid or expired link'}), 400
        
        stored = reset_tokens[token]
        if datetime.now() > stored['expires']:
            del reset_tokens[token]
            return jsonify({'error': 'Link expired'}), 400
        
        identifier = stored['identifier']
        
        # Update password
        with get_db() as db:
            db.execute('UPDATE users SET password_hash=? WHERE email=? OR phone=?',
                      (generate_password_hash(password), identifier, identifier))
            db.commit()
        
        # Clear token
        del reset_tokens[token]
        
        logger.info(f"Password reset successful for {identifier}")
        return jsonify({'success': True})
        
    except Exception as e:
        logger.error(f"Reset password error: {e}")
        return jsonify({'error': 'Server error occurred'}), 500

@app.route('/api/me')
def me():
    uid = session.get('user_id')
    if uid:
        with get_db() as db:
            user = db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
            if user:
                return jsonify({'logged_in': True, 'name': user['name'], 'email': user['email'], 'phone': user['phone'], 'theme': user['theme'] or 'dark', 'photo': user['photo']})
    return jsonify({'logged_in': False})

@app.route('/api/profile', methods=['PATCH'])
@rate_limit(max_requests=10, window=60)
@csrf_required
def update_profile():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Not logged in'}), 401
    d = request.json
    
    try:
        with get_db() as db:
            if 'name' in d:
                name = sanitize_input(d['name'], 100)
                if name and len(name) >= 2:
                    db.execute('UPDATE users SET name=? WHERE id=?', (name, uid))
                    session['user_name'] = name
            if 'theme' in d and d['theme'] in ['dark', 'light']:
                db.execute('UPDATE users SET theme=? WHERE id=?', (d['theme'], uid))
            if 'password' in d and d['password']:
                valid, msg = validate_password_strength(d['password'])
                if not valid:
                    return jsonify({'error': msg}), 400
                db.execute('UPDATE users SET password_hash=? WHERE id=?', (generate_password_hash(d['password']), uid))
            if 'photo' in d:
                if d['photo'] == 'REMOVE':
                    # Delete old photo file if exists
                    old_photo = db.execute('SELECT photo FROM users WHERE id=?', (uid,)).fetchone()
                    if old_photo and old_photo['photo']:
                        try:
                            os.remove(os.path.join(UPLOAD_FOLDER, old_photo['photo']))
                        except:
                            pass
                    db.execute('UPDATE users SET photo=NULL WHERE id=?', (uid,))
                else:
                    # Save photo to file system instead of base64
                    photo_filename = f"{uid}_{secrets.token_hex(8)}.jpg"
                    photo_path = os.path.join(UPLOAD_FOLDER, photo_filename)
                    # Decode base64 and save
                    import base64
                    photo_data = d['photo'].split(',')[1] if ',' in d['photo'] else d['photo']
                    with open(photo_path, 'wb') as f:
                        f.write(base64.b64decode(photo_data))
                    db.execute('UPDATE users SET photo=? WHERE id=?', (photo_filename, uid))
            db.commit()
            logger.info(f"Profile updated for user {uid}")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Profile update error: {e}")
        return jsonify({'error': 'Failed to update profile'}), 500

# ─── Chat API ─────────────────────────────────────────────────────────────────
@app.route('/api/chats', methods=['GET'])
def get_chats():
    uid = session.get('user_id')
    try:
        with get_db() as db:
            if uid:
                rows = db.execute('SELECT * FROM chats WHERE user_id=? AND is_temporary=0 ORDER BY is_pinned DESC, created_at DESC', (uid,)).fetchall()
            else:
                rows = []
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        logger.error(f"Get chats error: {e}")
        return jsonify({'error': 'Failed to load chats'}), 500

@app.route('/api/chats', methods=['POST'])
@csrf_required
def create_chat():
    try:
        d = request.json
        uid = session.get('user_id')
        with get_db() as db:
            db.execute('INSERT INTO chats (user_id, title, model, is_temporary) VALUES (?,?,?,?)',
                       (uid, sanitize_input(d.get('title', 'New Chat'), 200), d.get('model', 'nexa-pro'), int(d.get('is_temporary', False))))
            db.commit()
            chat = db.execute('SELECT * FROM chats ORDER BY id DESC LIMIT 1').fetchone()
        logger.info(f"Chat created: {chat['id']}")
        return jsonify(dict(chat))
    except Exception as e:
        logger.error(f"Create chat error: {e}")
        return jsonify({'error': 'Failed to create chat'}), 500

@app.route('/api/chats/<int:cid>', methods=['GET'])
def get_chat(cid):
    try:
        with get_db() as db:
            chat = db.execute('SELECT * FROM chats WHERE id=?', (cid,)).fetchone()
            if not chat: return jsonify({'error': 'Not found'}), 404
            msgs = db.execute('SELECT * FROM messages WHERE chat_id=? ORDER BY created_at', (cid,)).fetchall()
        # Sanitize message content for output
        messages = [dict(m) for m in msgs]
        for msg in messages:
            msg['content'] = sanitize_html_output(msg['content'])
        return jsonify({**dict(chat), 'messages': messages})
    except Exception as e:
        logger.error(f"Get chat error: {e}")
        return jsonify({'error': 'Failed to load chat'}), 500

@app.route('/api/chats/<int:cid>', methods=['PATCH'])
@csrf_required
def update_chat(cid):
    try:
        d = request.json
        with get_db() as db:
            if 'title' in d: db.execute('UPDATE chats SET title=? WHERE id=?', (sanitize_input(d['title'], 200), cid))
            if 'is_saved' in d: db.execute('UPDATE chats SET is_saved=? WHERE id=?', (int(d['is_saved']), cid))
            if 'is_pinned' in d: db.execute('UPDATE chats SET is_pinned=? WHERE id=?', (int(d['is_pinned']), cid))
            if 'model' in d: db.execute('UPDATE chats SET model=? WHERE id=?', (d['model'], cid))
            db.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Update chat error: {e}")
        return jsonify({'error': 'Failed to update chat'}), 500

@app.route('/api/chats/<int:cid>', methods=['DELETE'])
@csrf_required
def delete_chat(cid):
    try:
        with get_db() as db:
            db.execute('DELETE FROM messages WHERE chat_id=?', (cid,))
            db.execute('DELETE FROM chats WHERE id=?', (cid,))
            db.commit()
        logger.info(f"Chat deleted: {cid}")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Delete chat error: {e}")
        return jsonify({'error': 'Failed to delete chat'}), 500

@app.route('/api/chats/<int:cid>/messages', methods=['POST'])
@rate_limit(max_requests=20, window=60)
@csrf_required
def send_message(cid):
    # Check if file upload
    if 'file' in request.files:
        return handle_file_upload(cid)
    
    try:
        d = request.json
        content = sanitize_input(d.get('content'), 4000)
        use_web_search = d.get('web_search', False)
        
        if not content or len(content) < 1:
            return jsonify({'error': 'Message cannot be empty'}), 400
        
        with get_db() as db:
            chat = db.execute('SELECT * FROM chats WHERE id=?', (cid,)).fetchone()
            if not chat:
                return jsonify({'error': 'Chat not found'}), 404
            
            db.execute('INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)', (cid, 'user', content))
            db.commit()
            user_msg = db.execute('SELECT * FROM messages WHERE chat_id=? AND role="user" ORDER BY id DESC LIMIT 1', (cid,)).fetchone()
            
            msg_count = db.execute('SELECT COUNT(*) FROM messages WHERE chat_id=?', (cid,)).fetchone()[0]
            if msg_count <= 2:
                title = content[:60] + ('...' if len(content) > 60 else '')
                db.execute('UPDATE chats SET title=? WHERE id=?', (title, cid))
                db.commit()
            
            history = [{'role': r['role'], 'content': r['content']} for r in
                       db.execute('SELECT role, content FROM messages WHERE chat_id=? ORDER BY created_at', (cid,)).fetchall()][-14:]
            model = chat['model']
            updated_title = db.execute('SELECT title FROM chats WHERE id=?', (cid,)).fetchone()['title']

        # Web search if enabled
        search_context = ""
        if use_web_search:
            search_results = perform_web_search(content)
            if search_results:
                search_context = f"\n\n{search_results}\n\nIMPORTANT: Use ONLY the above web search results to answer. Provide the most current and accurate information from these results. If the search results contain specific dates, numbers, or facts, use them directly in your answer."
        
        # Check if it's a news request
        if '🇮🇳 India Breaking News' in content or 'India Breaking News' in content:
            ai_text = fetch_india_news()
        # Check if it's a Wikipedia request
        elif content.startswith('📚 Wikipedia:'):
            topic = content.replace('📚 Wikipedia:', '').strip()
            wiki_result = fetch_wikipedia_summary(topic)
            
            # If Wikipedia returns plain text (not HTML), let AI handle it
            if not wiki_result.startswith('<div'):
                # Wikipedia failed, let AI answer the question
                ai_text = generate_ai_response(f"User asked about: {topic}. {wiki_result}", model, history)
            else:
                # Wikipedia succeeded, return formatted HTML
                ai_text = wiki_result
        else:
            ai_text = generate_ai_response(content + search_context, model, history)

        with get_db() as db:
            db.execute('INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)', (cid, 'assistant', ai_text))
            db.commit()
            ai_msg = db.execute('SELECT * FROM messages WHERE chat_id=? AND role="assistant" ORDER BY id DESC LIMIT 1', (cid,)).fetchone()

        logger.info(f"Message sent in chat {cid}")
        return jsonify({
            'user_message': dict(user_msg), 
            'ai_message': dict(ai_msg), 
            'chat_title': updated_title
        })
    except Exception as e:
        logger.error(f"Send message error: {e}")
        return jsonify({'error': 'Failed to process message', 'retry': True}), 500

def analyze_file_content(file_path, filename):
    """Analyze file content and return description"""
    import base64
    
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    
    # Image analysis with Vision API
    if ext in ['png', 'jpg', 'jpeg', 'gif', 'webp']:
        try:
            # Check if Vision model is available
            if not client:
                return f"[IMAGE FILE: {filename}]\nImage uploaded. AI cannot analyze images without API configuration."
            
            # Read and encode image
            with open(file_path, 'rb') as f:
                img_data = base64.b64encode(f.read()).decode('utf-8')
            
            # Try to use vision model for image analysis
            try:
                # Use Qwen2-VL model for image analysis
                response = client.chat.completions.create(
                    model="Qwen2-VL-72B-Instruct",
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Describe this image in detail. What do you see?"},
                            {"type": "image_url", "image_url": {"url": f"data:image/{ext};base64,{img_data}"}}
                        ]
                    }],
                    max_tokens=500
                )
                vision_analysis = response.choices[0].message.content
                return f"[IMAGE ANALYSIS: {filename}]\n\n{vision_analysis}"
            except Exception as e:
                # If vision model fails, return basic info
                logger.warning(f"Vision analysis failed: {e}")
                return f"[IMAGE FILE: {filename}]\nImage uploaded successfully. Visual analysis not available - the AI model cannot process images directly. Only text-based files (TXT, PDF, CSV) can be analyzed."
        except Exception as e:
            logger.error(f"Image processing error: {e}")
            return f"[IMAGE FILE: {filename}]"
    
    # Text file analysis
    elif ext in ['txt', 'csv']:
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read(5000)  # First 5000 chars
            return f"[TEXT FILE: {filename}]\n\nFile Content:\n{content[:4000]}"
        except:
            return f"[TEXT FILE: {filename}]"
    
    # PDF analysis (basic)
    elif ext == 'pdf':
        try:
            import PyPDF2
            with open(file_path, 'rb') as f:
                pdf = PyPDF2.PdfReader(f)
                text = ""
                for page in pdf.pages[:5]:  # First 5 pages
                    text += page.extract_text()
            return f"[PDF FILE: {filename}]\n\nExtracted Text:\n{text[:4000]}"
        except:
            return f"[PDF FILE: {filename}]\nPDF file uploaded. Install PyPDF2 for text extraction: pip install PyPDF2"
    
    # Other files
    else:
        return f"[FILE: {filename}]\nFile type: {ext.upper()}\nNote: This file type cannot be analyzed. Only text files (TXT, CSV) and PDFs can be read."

def handle_file_upload(cid):
    file = request.files['file']
    message = request.form.get('message', '')
    
    if not file or file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Validate file extension
    if not allowed_file(file.filename):
        return jsonify({'error': f'File type not allowed. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400
    
    # Check file size
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)
    
    if file_size > MAX_FILE_SIZE:
        return jsonify({'error': f'File too large. Maximum size: {MAX_FILE_SIZE/1024/1024}MB'}), 400
    
    # Save file to uploads folder
    import base64
    
    filename = secure_filename(file.filename)
    file_id = secrets.token_hex(8)
    saved_filename = f"{file_id}_{filename}"
    file_path = os.path.join(UPLOAD_FOLDER, '..', 'files', saved_filename)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    
    file.save(file_path)
    
    # Analyze file content
    file_analysis = analyze_file_content(file_path, filename)
    
    # Check if it's an image
    is_image = file.content_type and file.content_type.startswith('image/')
    
    # Create message with file link
    file_url = f"/uploads/files/{saved_filename}"
    if is_image:
        content = f"{message}\n\n<img src='{file_url}' alt='{filename}' style='max-width:400px;border-radius:8px;cursor:pointer' onclick='window.open(\"{file_url}\", \"_blank\")'>" if message else f"<img src='{file_url}' alt='{filename}' style='max-width:400px;border-radius:8px;cursor:pointer' onclick='window.open(\"{file_url}\", \"_blank\")'>"
    else:
        content = f"{message}\n\n<a href='{file_url}' download='{filename}' style='color:#63b3ed'>📎 {filename} ({file_size/1024:.1f} KB)</a>" if message else f"<a href='{file_url}' download='{filename}' style='color:#63b3ed'>📎 {filename} ({file_size/1024:.1f} KB)</a>"
    
    try:
        with get_db() as db:
            chat = db.execute('SELECT * FROM chats WHERE id=?', (cid,)).fetchone()
            if not chat:
                return jsonify({'error': 'Chat not found'}), 404
            
            db.execute('INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)', (cid, 'user', content))
            db.commit()
            user_msg = db.execute('SELECT * FROM messages WHERE chat_id=? AND role="user" ORDER BY id DESC LIMIT 1', (cid,)).fetchone()
            
            msg_count = db.execute('SELECT COUNT(*) FROM messages WHERE chat_id=?', (cid,)).fetchone()[0]
            if msg_count <= 2:
                title = filename[:60]
                db.execute('UPDATE chats SET title=? WHERE id=?', (title, cid))
                db.commit()
            
            history = [{'role': r['role'], 'content': r['content']} for r in
                       db.execute('SELECT role, content FROM messages WHERE chat_id=? ORDER BY created_at', (cid,)).fetchall()][-14:]
            model = chat['model']
            updated_title = db.execute('SELECT title FROM chats WHERE id=?', (cid,)).fetchone()['title']

        # Send file analysis to AI
        ai_prompt = f"{file_analysis}\n\nUser message: {message if message else 'Please analyze this file.'}"
        ai_text = generate_ai_response(ai_prompt, model, history)

        with get_db() as db:
            db.execute('INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)', (cid, 'assistant', ai_text))
            db.commit()
            ai_msg = db.execute('SELECT * FROM messages WHERE chat_id=? AND role="assistant" ORDER BY id DESC LIMIT 1', (cid,)).fetchone()

        return jsonify({'user_message': dict(user_msg), 'ai_message': dict(ai_msg), 'chat_title': updated_title})
    except Exception as e:
        return jsonify({'error': 'Failed to process file'}), 500


@app.route('/api/messages/<int:mid>', methods=['PATCH'])
@csrf_required
def edit_message(mid):
    try:
        d = request.json
        with get_db() as db:
            db.execute('UPDATE messages SET content=? WHERE id=?', (sanitize_input(d.get('content', ''), 4000), mid))
            db.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Edit message error: {e}")
        return jsonify({'error': 'Failed to edit message'}), 500

@app.route('/api/chats/<int:cid>/regenerate/<int:user_msg_id>', methods=['POST'])
@rate_limit(max_requests=20, window=60)
@csrf_required
def regenerate_response(cid, user_msg_id):
    try:
        with get_db() as db:
            user_msg = db.execute('SELECT * FROM messages WHERE id=? AND chat_id=? AND role="user"', 
                                 (user_msg_id, cid)).fetchone()
            if not user_msg:
                return jsonify({'error': 'User message not found'}), 404
            
            chat = db.execute('SELECT * FROM chats WHERE id=?', (cid,)).fetchone()
            if not chat:
                return jsonify({'error': 'Chat not found'}), 404
            
            db.execute('DELETE FROM messages WHERE chat_id=? AND id>?', (cid, user_msg_id))
            db.commit()
            
            history = [{'role': r['role'], 'content': r['content']} for r in
                      db.execute('SELECT role, content FROM messages WHERE chat_id=? ORDER BY created_at', 
                               (cid,)).fetchall()][-14:]
            
            model = chat['model']
        
        ai_text = generate_ai_response(user_msg['content'], model, history)
        
        with get_db() as db:
            db.execute('INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)', 
                      (cid, 'assistant', ai_text))
            db.commit()
            ai_msg = db.execute('SELECT * FROM messages WHERE chat_id=? AND role="assistant" ORDER BY id DESC LIMIT 1', 
                               (cid,)).fetchone()
        
        logger.info(f"Response regenerated for chat {cid}")
        return jsonify({'ai_message': dict(ai_msg)})
        
    except Exception as e:
        logger.error(f"Regenerate error: {e}")
        return jsonify({'error': 'Failed to regenerate response', 'retry': True}), 500

@app.route('/api/chats/<int:cid>/export', methods=['GET'])
def export_chat(cid):
    fmt = request.args.get('format', 'txt')
    with get_db() as db:
        chat = db.execute('SELECT * FROM chats WHERE id=?', (cid,)).fetchone()
        if not chat: return jsonify({'error': 'Not found'}), 404
        msgs = db.execute('SELECT * FROM messages WHERE chat_id=? ORDER BY created_at', (cid,)).fetchall()
    
    if fmt == 'json':
        data = {'title': chat['title'], 'model': chat['model'], 'created_at': chat['created_at'],
                'messages': [{'role': m['role'], 'content': m['content'], 'time': m['created_at']} for m in msgs]}
        return Response(json.dumps(data, indent=2), mimetype='application/json',
                       headers={'Content-Disposition': f'attachment; filename="nexa-chat-{cid}.json"'})
    else:
        lines = [f"Nexa AI Chat Export", f"Title: {chat['title']}", f"Model: {chat['model']}",
                 f"Date: {chat['created_at']}", "="*50, ""]
        for m in msgs:
            role = "You" if m['role'] == 'user' else "Nexa AI"
            lines.append(f"[{role}] {m['created_at']}")
            lines.append(m['content'])
            lines.append("")
        content_txt = "\n".join(lines)
        return Response(content_txt, mimetype='text/plain',
                       headers={'Content-Disposition': f'attachment; filename="nexa-chat-{cid}.txt"'})

# ─── Tasks API ─────────────────────────────────────────────────────────────────
@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    uid = session.get('user_id')
    sid = request.args.get('session_id', '')
    try:
        with get_db() as db:
            if uid:
                rows = db.execute('SELECT * FROM tasks WHERE user_id=? ORDER BY completed ASC, created_at DESC', (uid,)).fetchall()
            else:
                rows = db.execute('SELECT * FROM tasks WHERE session_id=? ORDER BY completed ASC, created_at DESC', (sid,)).fetchall()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        logger.error(f"Get tasks error: {e}")
        return jsonify({'error': 'Failed to load tasks'}), 500

@app.route('/api/tasks', methods=['POST'])
@rate_limit(max_requests=30, window=60)
@csrf_required
def add_task():
    try:
        d = request.json
        uid = session.get('user_id')
        title = sanitize_input(d.get('title'), 500)
        
        if not title or len(title) < 1:
            return jsonify({'error': 'Task title required'}), 400
        
        priority = d.get('priority', 'normal')
        if priority not in ['normal', 'high', 'urgent']:
            priority = 'normal'
        
        with get_db() as db:
            db.execute('INSERT INTO tasks (user_id, session_id, title, priority) VALUES (?,?,?,?)',
                       (uid, d.get('session_id', ''), title, priority))
            db.commit()
            task = db.execute('SELECT * FROM tasks ORDER BY id DESC LIMIT 1').fetchone()
        logger.info(f"Task created: {task['id']}")
        return jsonify(dict(task))
    except Exception as e:
        logger.error(f"Add task error: {e}")
        return jsonify({'error': 'Failed to create task'}), 500

@app.route('/api/tasks/<int:tid>', methods=['PATCH'])
@csrf_required
def update_task(tid):
    try:
        d = request.json
        with get_db() as db:
            if 'completed' in d: db.execute('UPDATE tasks SET completed=? WHERE id=?', (int(d['completed']), tid))
            if 'title' in d: db.execute('UPDATE tasks SET title=? WHERE id=?', (sanitize_input(d['title'], 500), tid))
            if 'priority' in d: db.execute('UPDATE tasks SET priority=? WHERE id=?', (d['priority'], tid))
            db.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Update task error: {e}")
        return jsonify({'error': 'Failed to update task'}), 500

@app.route('/api/tasks/<int:tid>', methods=['DELETE'])
@csrf_required
def delete_task(tid):
    try:
        with get_db() as db:
            db.execute('DELETE FROM tasks WHERE id=?', (tid,))
            db.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Delete task error: {e}")
        return jsonify({'error': 'Failed to delete task'}), 500

# ─── Diary API ─────────────────────────────────────────────────────────────────
@app.route('/api/diary', methods=['GET'])
def get_diary_entries():
    uid = session.get('user_id')
    sid = request.args.get('session_id', '')
    try:
        with get_db() as db:
            if uid:
                rows = db.execute('SELECT * FROM diary_entries WHERE user_id=? ORDER BY updated_at DESC', (uid,)).fetchall()
            else:
                rows = db.execute('SELECT * FROM diary_entries WHERE session_id=? ORDER BY updated_at DESC', (sid,)).fetchall()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        logger.error(f"Get diary entries error: {e}")
        return jsonify({'error': 'Failed to load entries'}), 500

@app.route('/api/diary', methods=['POST'])
@rate_limit(max_requests=30, window=60)
@csrf_required
def add_diary_entry():
    try:
        d = request.json
        title = d.get('title', 'Untitled').strip()
        content = d.get('content', '').strip()
        if not content:
            return jsonify({'error': 'Content required'}), 400
        
        uid = session.get('user_id')
        sid = d.get('session_id', '')
        
        with get_db() as db:
            cur = db.execute(
                'INSERT INTO diary_entries (user_id, session_id, title, content) VALUES (?,?,?,?)',
                (uid, sid, title, content)
            )
            db.commit()
            entry = db.execute('SELECT * FROM diary_entries WHERE id=?', (cur.lastrowid,)).fetchone()
        return jsonify(dict(entry))
    except Exception as e:
        logger.error(f"Add diary entry error: {e}")
        return jsonify({'error': 'Failed to create entry'}), 500

@app.route('/api/diary/<int:eid>', methods=['PATCH'])
@csrf_required
def update_diary_entry(eid):
    try:
        d = request.json
        with get_db() as db:
            if 'title' in d and 'content' in d:
                db.execute('UPDATE diary_entries SET title=?, content=?, updated_at=datetime("now") WHERE id=?', 
                          (d['title'], d['content'], eid))
            elif 'title' in d:
                db.execute('UPDATE diary_entries SET title=?, updated_at=datetime("now") WHERE id=?', (d['title'], eid))
            elif 'content' in d:
                db.execute('UPDATE diary_entries SET content=?, updated_at=datetime("now") WHERE id=?', (d['content'], eid))
            db.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Update diary entry error: {e}")
        return jsonify({'error': 'Failed to update entry'}), 500

@app.route('/api/diary/<int:eid>', methods=['DELETE'])
@csrf_required
def delete_diary_entry(eid):
    try:
        with get_db() as db:
            db.execute('DELETE FROM diary_entries WHERE id=?', (eid,))
            db.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Delete diary entry error: {e}")
        return jsonify({'error': 'Failed to delete entry'}), 500

# ─── Stats API ─────────────────────────────────────────────────────────────────
@app.route('/api/bot-status')
def bot_status():
    bot_path = os.path.join(os.path.dirname(__file__), 'automation', 'bot.py')
    running = os.path.exists(bot_path)
    return jsonify({'running': running})

@app.route('/api/stats')
def get_stats():
    uid = session.get('user_id')
    if not uid: return jsonify({'chats': 0, 'messages': 0, 'tasks': 0})
    with get_db() as db:
        chats = db.execute('SELECT COUNT(*) FROM chats WHERE user_id=?', (uid,)).fetchone()[0]
        messages = db.execute('SELECT COUNT(*) FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id=?)', (uid,)).fetchone()[0]
        tasks = db.execute('SELECT COUNT(*) FROM tasks WHERE user_id=?', (uid,)).fetchone()[0]
    return jsonify({'chats': chats, 'messages': messages, 'tasks': tasks})

@app.route('/api/news/india')
def get_india_news():
    """Get top 20 breaking news from India"""
    try:
        news = fetch_india_news()
        return jsonify({'success': True, 'news': news})
    except Exception as e:
        logger.error(f"News API error: {e}")
        return jsonify({'error': 'Failed to fetch news'}), 500

@app.route('/api/wikipedia/<path:query>')
def get_wikipedia(query):
    """Get Wikipedia summary for a topic"""
    try:
        summary = fetch_wikipedia_summary(query)
        return jsonify({'success': True, 'summary': summary})
    except Exception as e:
        logger.error(f"Wikipedia API error: {e}")
        return jsonify({'error': 'Failed to fetch Wikipedia'}), 500

def generate_ai_response(user_message, model, history):
    if not client:
        logger.error("AI client not configured")
        return f"I'm Nexa AI ({model}). The AI service is not configured. Please set the SAMBANOVA_API_KEY environment variable."
    
    try:
        personas = {
            'nexa-pro':      'You are Nexa Pro, an advanced AI assistant with deep reasoning capabilities. Be thorough, insightful and well-structured. Use markdown formatting where helpful.',
            'nexa-flash':    'You are Nexa Flash, a fast AI assistant. Be concise, direct and clear. Avoid unnecessary verbosity.',
            'nexa-vision':   'You are Nexa Vision, specializing in creative and visual thinking. Be imaginative, descriptive and inspire creativity.',
            'nexa-code':     'You are Nexa Code, an expert programmer. Provide clean, efficient, well-commented code with explanations. Always specify the language in code blocks.',
            'nexa-research': 'You are Nexa Research, specialized in deep analysis. Provide structured, comprehensive responses with clear headings and bullet points.',
        }
        
        # Map frontend models to backend models
        model_mapping = {
            'nexa-pro':      'DeepSeek-V3.1',
            'nexa-flash':    'Meta-Llama-3.1-8B-Instruct',
            'nexa-vision':   'Qwen3-32B',
            'nexa-code':     'DeepSeek-V3.2',
            'nexa-research': 'DeepSeek-R1'
        }
        
        system_msg = personas.get(model, personas['nexa-pro'])
        backend_model = model_mapping.get(model, 'DeepSeek-V3.1')
        messages = [{"role": "system", "content": system_msg}] + history[-10:]
        
        response = client.chat.completions.create(
            model=backend_model,
            messages=messages,
            temperature=0.7,
            max_tokens=1500
        )
        
        return response.choices[0].message.content
        
    except Exception as e:
        error_str = str(e)
        print(f"[ERROR] AI Response Error: {error_str}")  # Debug log
        if "401" in error_str or "authentication" in error_str.lower():
            return f"I'm Nexa AI ({model}). Authentication failed. Please check your API key configuration."
        elif "429" in error_str or "rate" in error_str.lower():
            return f"I'm Nexa AI ({model}). The AI service is currently rate limited. Please try again in a moment."
        else:
            return f"I'm Nexa AI ({model}). Error: {error_str[:100]}"  # Show actual error

def perform_web_search(query):
    """Perform web search using multiple sources"""
    try:
        import urllib.request
        import urllib.parse
        import re
        from html import unescape
        
        results = []
        
        # Try Google search first
        try:
            encoded_query = urllib.parse.quote(query)
            url = f"https://www.google.com/search?q={encoded_query}&num=5&hl=en"
            
            req = urllib.request.Request(
                url, 
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                }
            )
            
            with urllib.request.urlopen(req, timeout=8) as response:
                html = response.read().decode('utf-8', errors='ignore')
            
            # Extract featured snippet (direct answer)
            featured = re.findall(r'<div class="[^"]*hgKElc[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
            if featured:
                clean = re.sub(r'<[^>]+>', '', featured[0])
                clean = unescape(re.sub(r'\s+', ' ', clean).strip())
                if clean and len(clean) > 10:
                    results.append(f"Featured Answer: {clean}")
            
            # Extract regular snippets
            snippets = re.findall(r'<div class="[^"]*VwiC3b[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
            for snippet in snippets[:4]:
                clean = re.sub(r'<[^>]+>', '', snippet)
                clean = unescape(re.sub(r'\s+', ' ', clean).strip())
                if clean and len(clean) > 30 and clean not in str(results):
                    results.append(clean)
            
            # Extract knowledge panel data
            knowledge = re.findall(r'<span class="[^"]*LrzXr[^"]*"[^>]*>(.*?)</span>', html, re.DOTALL)
            for k in knowledge[:2]:
                clean = re.sub(r'<[^>]+>', '', k)
                clean = unescape(re.sub(r'\s+', ' ', clean).strip())
                if clean and len(clean) > 10 and clean not in str(results):
                    results.append(clean)
                    
        except Exception as e:
            print(f"[ERROR] Google search failed: {str(e)}")
        
        # Fallback to DuckDuckGo
        if not results:
            try:
                encoded_query = urllib.parse.quote(query)
                ddg_url = f"https://api.duckduckgo.com/?q={encoded_query}&format=json&no_html=1"
                
                req = urllib.request.Request(ddg_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    data = json.loads(response.read())
                
                if data.get('AbstractText'):
                    results.append(data['AbstractText'])
                
                if data.get('RelatedTopics'):
                    for topic in data['RelatedTopics'][:3]:
                        if isinstance(topic, dict) and topic.get('Text'):
                            results.append(topic['Text'])
            except Exception as e:
                print(f"[ERROR] DuckDuckGo search failed: {str(e)}")
        
        if results:
            formatted = "\n".join([f"• {r}" for r in results[:5]])
            return f"[Web Search Results for: {query}]\n{formatted}"
        
        return None
        
    except Exception as e:
        print(f"[ERROR] Web search failed: {str(e)}")
        return None

def fetch_wikipedia_summary(query):
    """Fetch Wikipedia summary for a topic"""
    try:
        import urllib.request
        import urllib.parse
        
        # First try direct page
        encoded_query = urllib.parse.quote(query.replace(' ', '_'))
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{encoded_query}"
        
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read())
        except:
            # If direct page fails, try search
            search_url = f"https://en.wikipedia.org/w/api.php?action=opensearch&search={urllib.parse.quote(query)}&limit=5&format=json"
            req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                search_data = json.loads(response.read())
            
            if search_data and len(search_data) > 3 and search_data[1]:
                # Get the first search result
                page_title = search_data[1][0].replace(' ', '_')
                url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{page_title}"
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=10) as response:
                    data = json.loads(response.read())
            else:
                # No results found - suggest AI to help
                return f"Wikipedia page not found for '{query}'. Let me help you with information about this topic instead."
        
        if data.get('type') == 'standard':
            title = data.get('title', query)
            extract = data.get('extract', '')
            thumbnail = data.get('thumbnail', {}).get('source', '')
            page_url = data.get('content_urls', {}).get('desktop', {}).get('page', '')
            
            html = "<div style='padding:20px;background:var(--surface2);border-radius:12px;'>"
            html += f"<h2 style='color:#63b3ed;margin-bottom:15px;font-size:24px;'>📚 {title}</h2>"
            
            if thumbnail:
                html += f"<img src='{thumbnail}' style='max-width:300px;border-radius:8px;margin-bottom:15px;' /><br>"
            
            html += f"<div style='font-size:15px;line-height:1.8;color:var(--text);margin-bottom:20px;'>{extract}</div>"
            
            if page_url:
                html += f"<a href='{page_url}' target='_blank' style='display:inline-flex;align-items:center;gap:5px;padding:8px 16px;background:#63b3ed;color:#000;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;'>🔗 Read full article</a>"
            
            html += "</div>"
            return html
        else:
            # Page exists but not standard type - let AI handle it
            return f"Wikipedia page for '{query}' exists but couldn't be formatted. Let me provide information about this topic instead."
        
    except Exception as e:
        logger.error(f"Wikipedia fetch error: {e}")
        # Instead of showing error, let AI handle the query
        return f"Couldn't fetch Wikipedia page for '{query}'. Let me help you with information about this topic instead."

def fetch_india_news():
    """Fetch top 20 breaking news from India using NewsAPI"""
    api_key = os.environ.get('NEWSAPI_KEY', '')
    if not api_key or api_key == 'your_newsapi_key_here':
        logger.warning("NewsAPI key not configured")
        return "NewsAPI key not configured. Get your free key from https://newsapi.org"
    
    try:
        import urllib.request
        import urllib.parse
        
        # Try India-specific news first, fallback to general news
        urls = [
            f"https://newsapi.org/v2/top-headlines?country=in&pageSize=20&apiKey={api_key}",
            f"https://newsapi.org/v2/everything?q=India&sortBy=publishedAt&pageSize=20&language=en&apiKey={api_key}"
        ]
        
        articles = []
        last_error = None
        
        for url in urls:
            try:
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                })
                with urllib.request.urlopen(req, timeout=15) as response:
                    data = json.loads(response.read())
                
                if data.get('status') != 'ok':
                    last_error = data.get('message', 'API returned non-ok status')
                    logger.warning(f"NewsAPI error: {last_error}")
                    continue
                
                articles = data.get('articles', [])
                if articles:
                    logger.info(f"Fetched {len(articles)} news articles")
                    break
            except urllib.error.HTTPError as e:
                last_error = f"HTTP {e.code}: {e.reason}"
                logger.error(f"NewsAPI HTTP error: {last_error}")
            except Exception as e:
                last_error = str(e)
                logger.error(f"NewsAPI request error: {last_error}")
                continue
        
        if not articles:
            error_msg = f"No breaking news found. {last_error if last_error else 'Try again later.'}"
            logger.warning(error_msg)
            return error_msg
        
        news_text = "<div style='padding:20px;background:var(--surface2);border-radius:12px;'>"
        news_text += "<h2 style='color:#63b3ed;margin-bottom:20px;font-size:24px;'>🇮🇳 Bharat ki Taaza Khabar</h2>"
        
        for i, article in enumerate(articles[:20], 1):
            title = article.get('title', 'No title')
            description = article.get('description', '')
            source = article.get('source', {}).get('name', 'Unknown')
            url = article.get('url', '')
            published = article.get('publishedAt', '')[:10]
            
            news_text += f"<div style='margin-bottom:20px;padding:15px;background:var(--surface);border-left:3px solid #63b3ed;border-radius:8px;'>"
            news_text += f"<div style='font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px;'>{i}. {title}</div>"
            
            if description:
                news_text += f"<div style='font-size:14px;color:var(--text2);margin-bottom:10px;line-height:1.6;'>{description}</div>"
            
            news_text += f"<div style='display:flex;align-items:center;gap:15px;font-size:13px;color:var(--muted);margin-bottom:8px;'>"
            news_text += f"<span>📰 {source}</span>"
            news_text += f"<span>📅 {published}</span>"
            news_text += f"</div>"
            
            if url:
                news_text += f"<a href='{url}' target='_blank' style='display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:#63b3ed;color:#000;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;'>🔗 Poori khabar padhein</a>"
            
            news_text += "</div>"
        
        news_text += "</div>"
        
        return news_text
        
    except Exception as e:
        logger.error(f"NewsAPI fetch error: {e}")
        return f"Failed to fetch news: {str(e)}"

if __name__ == "__main__":
    logger.info("Starting Nexa AI application")
    
    # Start Telegram bot in background
    import threading
    import subprocess
    def run_bot():
        try:
            bot_path = os.path.join(os.path.dirname(__file__), 'automation', 'bot.py')
            if os.path.exists(bot_path):
                subprocess.Popen(['python', bot_path])
                logger.info("Telegram bot started")
        except Exception as e:
            logger.error(f"Bot start failed: {e}")
    
    threading.Thread(target=run_bot, daemon=True).start()
    
    try:
        port = int(os.environ.get("PORT", 8080))
        app.run(host="0.0.0.0", port=port, debug=False)
    except Exception as e:
        logger.critical(f"Application failed to start: {str(e)}")
        raise