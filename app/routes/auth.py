from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from app.models.database import get_db
from app.utils.security import csrf_required, rate_limit, generate_csrf_token
from app.utils.validation import validate_email, validate_phone, validate_password_strength, sanitize_input
import mysql.connector
import logging, secrets
from datetime import datetime, timedelta

bp = Blueprint('auth', __name__, url_prefix='/api')
logger = logging.getLogger(__name__)

reset_tokens = {}

@bp.route('/csrf-token')
def get_csrf_token():
    return jsonify({'csrf_token': generate_csrf_token()})

@bp.route('/signup', methods=['POST'])
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
        
        valid, msg = validate_password_strength(password)
        if not valid:
            return jsonify({'error': msg}), 400
        
        if not email and not phone:
            return jsonify({'error': 'Email or phone required'}), 400
        if email and not validate_email(email):
            return jsonify({'error': 'Invalid email format'}), 400
        if phone and not validate_phone(phone):
            return jsonify({'error': 'Invalid phone format'}), 400
        
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('INSERT INTO users (name, email, phone, password_hash) VALUES (%s,%s,%s,%s)',
                   (name, email or None, phone or None, generate_password_hash(password)))
        conn.commit()
        cursor.execute('SELECT * FROM users WHERE name=%s ORDER BY id DESC LIMIT 1', (name,))
        user = cursor.fetchone()
        cursor.close()
        conn.close()
        
        session.permanent = True
        session['user_id'] = user['id']
        session['user_name'] = user['name']
        logger.info(f"New user signup: {name}")
        return jsonify({'success': True, 'name': user['name']})
    except mysql.connector.IntegrityError as e:
        msg = str(e).lower()
        if 'email' in msg: return jsonify({'error': 'Email already registered'}), 400
        if 'phone' in msg: return jsonify({'error': 'Phone already registered'}), 400
        return jsonify({'error': 'Registration failed'}), 400
    except Exception as e:
        logger.error(f"Signup error: {e}")
        return jsonify({'error': 'Server error occurred'}), 500

@bp.route('/login', methods=['POST'])
@rate_limit(max_requests=5, window=300)
@csrf_required
def login():
    try:
        d = request.json
        identifier = sanitize_input(d.get('identifier'), 255)
        password = d.get('password', '')
        
        if not identifier or not password:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT * FROM users WHERE email=%s OR phone=%s', (identifier, identifier))
        user = cursor.fetchone()
        cursor.close()
        conn.close()
        
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

@bp.route('/logout', methods=['POST'])
@csrf_required
def logout():
    user_name = session.get('user_name', 'Unknown')
    session.clear()
    logger.info(f"User logout: {user_name}")
    return jsonify({'success': True})

@bp.route('/me')
def me():
    uid = session.get('user_id')
    if uid:
        try:
            conn = get_db()
            cursor = conn.cursor(dictionary=True)
            cursor.execute('SELECT id, name, email, phone, theme, photo_type FROM users WHERE id=%s', (uid,))
            user = cursor.fetchone()
            cursor.close()
            conn.close()
            if user:
                photo_url = f"/api/profile-photo" if user.get('photo_type') else None
                return jsonify({'logged_in': True, 'name': user['name'], 'email': user['email'], 'phone': user['phone'], 'theme': user.get('theme') or 'dark', 'photo': photo_url})
        except Exception as e:
            logger.error(f"Get user error: {e}")
            return jsonify({'logged_in': True, 'name': 'User', 'theme': 'dark', 'photo': None})
    return jsonify({'logged_in': False})

@bp.route('/profile-photo')
def get_profile_photo():
    uid = session.get('user_id')
    if not uid:
        return '', 404
    
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT photo, photo_type FROM users WHERE id=%s', (uid,))
        user = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if user and user.get('photo'):
            from flask import Response
            return Response(user['photo'], mimetype=user['photo_type'])
    except Exception as e:
        logger.error(f"Get photo error: {e}")
    
    return '', 404

@bp.route('/profile', methods=['PATCH'])
@rate_limit(max_requests=10, window=60)
@csrf_required
def update_profile():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Not logged in'}), 401
    d = request.json
    
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        
        if 'name' in d:
            name = sanitize_input(d['name'], 100)
            if name and len(name) >= 2:
                cursor.execute('UPDATE users SET name=%s WHERE id=%s', (name, uid))
                session['user_name'] = name
        if 'theme' in d and d['theme'] in ['dark', 'light']:
            cursor.execute('UPDATE users SET theme=%s WHERE id=%s', (d['theme'], uid))
        if 'password' in d and d['password']:
            valid, msg = validate_password_strength(d['password'])
            if not valid:
                cursor.close()
                conn.close()
                return jsonify({'error': msg}), 400
            cursor.execute('UPDATE users SET password_hash=%s WHERE id=%s', (generate_password_hash(d['password']), uid))
        if 'photo' in d:
            if d['photo'] == 'REMOVE':
                cursor.execute('UPDATE users SET photo=NULL, photo_type=NULL WHERE id=%s', (uid,))
            else:
                import base64
                photo_data = d['photo'].split(',')[1] if ',' in d['photo'] else d['photo']
                photo_bytes = base64.b64decode(photo_data)
                photo_type = d['photo'].split(';')[0].split(':')[1] if 'data:' in d['photo'] else 'image/jpeg'
                cursor.execute('UPDATE users SET photo=%s, photo_type=%s WHERE id=%s', (photo_bytes, photo_type, uid))
        
        conn.commit()
        cursor.close()
        conn.close()
        logger.info(f"Profile updated for user {uid}")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Profile update error: {e}")
        return jsonify({'error': 'Failed to update profile'}), 500

@bp.route('/log-error', methods=['POST'])
def log_error():
    try:
        error = request.json
        logger.error(f"Client error: {error.get('message')} | URL: {error.get('url')}")
        if error.get('stack'):
            logger.error(f"Stack: {error.get('stack')[:500]}")
        return jsonify({'success': True}), 200
    except:
        return jsonify({'success': False}), 200
