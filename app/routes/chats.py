from flask import Blueprint, request, jsonify, session, Response
from werkzeug.utils import secure_filename
from app.models.database import get_db
from app.utils.security import csrf_required, rate_limit
from app.utils.validation import sanitize_input, sanitize_html_output, allowed_file
from app.services.ai_service import generate_ai_response
from app.services.search_service import perform_web_search, fetch_wikipedia_summary, fetch_india_news
import logging, tempfile, os, json

bp = Blueprint('chats', __name__, url_prefix='/api')
logger = logging.getLogger(__name__)
MAX_FILE_SIZE = 10 * 1024 * 1024

@bp.route('/chats', methods=['GET'])
def get_chats():
    uid = session.get('user_id')
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        if uid:
            cursor.execute('SELECT * FROM chats WHERE user_id=%s AND is_temporary=0 ORDER BY is_pinned DESC, created_at DESC', (uid,))
        else:
            cursor.execute('SELECT * FROM chats WHERE 1=0')
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(rows)
    except Exception as e:
        logger.error(f"Get chats error: {e}")
        return jsonify({'error': 'Failed to load chats'}), 500

@bp.route('/chats', methods=['POST'])
@csrf_required
def create_chat():
    try:
        d = request.json
        uid = session.get('user_id')
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('INSERT INTO chats (user_id, title, model, is_temporary) VALUES (%s,%s,%s,%s)',
                   (uid, sanitize_input(d.get('title', 'New Chat'), 200), d.get('model', 'nexa-pro'), int(d.get('is_temporary', False))))
        conn.commit()
        cursor.execute('SELECT * FROM chats ORDER BY id DESC LIMIT 1')
        chat = cursor.fetchone()
        cursor.close()
        conn.close()
        logger.info(f"Chat created: {chat['id']}")
        return jsonify(chat)
    except Exception as e:
        logger.error(f"Create chat error: {e}")
        return jsonify({'error': 'Failed to create chat'}), 500

@bp.route('/chats/<int:cid>', methods=['GET'])
def get_chat(cid):
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT * FROM chats WHERE id=%s', (cid,))
        chat = cursor.fetchone()
        if not chat:
            cursor.close()
            conn.close()
            return jsonify({'error': 'Not found'}), 404
        cursor.execute('SELECT id, chat_id, role, content, file_name, file_type, created_at FROM messages WHERE chat_id=%s ORDER BY created_at', (cid,))
        msgs = cursor.fetchall()
        cursor.close()
        conn.close()
        messages = [dict(m) for m in msgs]
        for msg in messages:
            msg['content'] = sanitize_html_output(msg['content'])
        return jsonify({**dict(chat), 'messages': messages})
    except Exception as e:
        logger.error(f"Get chat error: {e}")
        return jsonify({'error': 'Failed to load chat'}), 500

@bp.route('/chats/<int:cid>', methods=['PATCH'])
@csrf_required
def update_chat(cid):
    try:
        d = request.json
        conn = get_db()
        cursor = conn.cursor()
        if 'title' in d: cursor.execute('UPDATE chats SET title=%s WHERE id=%s', (sanitize_input(d['title'], 200), cid))
        if 'is_saved' in d: cursor.execute('UPDATE chats SET is_saved=%s WHERE id=%s', (int(d['is_saved']), cid))
        if 'is_pinned' in d: cursor.execute('UPDATE chats SET is_pinned=%s WHERE id=%s', (int(d['is_pinned']), cid))
        if 'model' in d: cursor.execute('UPDATE chats SET model=%s WHERE id=%s', (d['model'], cid))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Update chat error: {e}")
        return jsonify({'error': 'Failed to update chat'}), 500

@bp.route('/chats/<int:cid>', methods=['DELETE'])
@csrf_required
def delete_chat(cid):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM messages WHERE chat_id=%s', (cid,))
        cursor.execute('DELETE FROM chats WHERE id=%s', (cid,))
        conn.commit()
        cursor.close()
        conn.close()
        logger.info(f"Chat deleted: {cid}")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Delete chat error: {e}")
        return jsonify({'error': 'Failed to delete chat'}), 500

@bp.route('/chats/<int:cid>/messages', methods=['POST'])
@rate_limit(max_requests=20, window=60)
@csrf_required
def send_message(cid):
    if 'file' in request.files:
        return handle_file_upload(cid)
    
    try:
        d = request.json
        content = sanitize_input(d.get('content'), 4000)
        use_web_search = d.get('web_search', False)
        
        if not content or len(content) < 1:
            return jsonify({'error': 'Message cannot be empty'}), 400
        
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT * FROM chats WHERE id=%s', (cid,))
        chat = cursor.fetchone()
        if not chat:
            cursor.close()
            conn.close()
            return jsonify({'error': 'Chat not found'}), 404
        
        cursor.execute('INSERT INTO messages (chat_id, role, content) VALUES (%s,%s,%s)', (cid, 'user', content))
        conn.commit()
        cursor.execute('SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id=%s AND role="user" ORDER BY id DESC LIMIT 1', (cid,))
        user_msg = cursor.fetchone()
        
        cursor.execute('SELECT COUNT(*) as cnt FROM messages WHERE chat_id=%s', (cid,))
        msg_count = cursor.fetchone()['cnt']
        if msg_count <= 2:
            title = content[:60] + ('...' if len(content) > 60 else '')
            cursor.execute('UPDATE chats SET title=%s WHERE id=%s', (title, cid))
            conn.commit()
        
        cursor.execute('SELECT role, content FROM messages WHERE chat_id=%s ORDER BY created_at', (cid,))
        history = [{'role': r['role'], 'content': r['content']} for r in cursor.fetchall()][-14:]
        model = chat['model']
        cursor.execute('SELECT title FROM chats WHERE id=%s', (cid,))
        updated_title = cursor.fetchone()['title']

        search_context = ""
        if use_web_search:
            search_results = perform_web_search(content)
            if search_results:
                search_context = f"\n\n{search_results}\n\nIMPORTANT: Use ONLY the above web search results to answer."
        
        if '🇮🇳 India Breaking News' in content or 'India Breaking News' in content:
            ai_text = fetch_india_news()
        elif content.startswith('📚 Wikipedia:'):
            topic = content.replace('📚 Wikipedia:', '').strip()
            wiki_result = fetch_wikipedia_summary(topic)
            if not wiki_result.startswith('<div'):
                ai_text = generate_ai_response(f"User asked about: {topic}. {wiki_result}", model, history)
            else:
                ai_text = wiki_result
        else:
            ai_text = generate_ai_response(content + search_context, model, history)

        cursor.execute('INSERT INTO messages (chat_id, role, content) VALUES (%s,%s,%s)', (cid, 'assistant', ai_text))
        conn.commit()
        cursor.execute('SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id=%s AND role="assistant" ORDER BY id DESC LIMIT 1', (cid,))
        ai_msg = cursor.fetchone()
        cursor.close()
        conn.close()

        logger.info(f"Message sent in chat {cid}")
        return jsonify({'user_message': dict(user_msg), 'ai_message': dict(ai_msg), 'chat_title': updated_title})
    except Exception as e:
        logger.error(f"Send message error: {e}")
        return jsonify({'error': 'Failed to process message', 'retry': True}), 500

def handle_file_upload(cid):
    file = request.files['file']
    message = request.form.get('message', '')
    
    if not file or file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'File type not allowed'}), 400
    
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)
    
    if file_size > MAX_FILE_SIZE:
        return jsonify({'error': f'File too large. Maximum size: {MAX_FILE_SIZE/1024/1024}MB'}), 400
    
    file_data = file.read()
    file.seek(0)
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{secure_filename(file.filename)}") as tmp:
        tmp.write(file_data)
        tmp_path = tmp.name
    
    from app.services.ai_service import analyze_file_content
    file_analysis = analyze_file_content(tmp_path, file.filename)
    os.remove(tmp_path)
    
    is_image = file.content_type and file.content_type.startswith('image/')
    file_url = f"/api/files/{'{msg_id}'}"
    
    # SVG icons for images and files
    image_svg = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
    file_svg = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>'
    
    # Create clickable icon for both images and files
    if is_image:
        icon_html = f"<a href='{file_url}' target='_blank' style='display:inline-flex;align-items:center;gap:6px;padding:8px 12px;background:var(--hover);border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--text);transition:all 0.2s;' onmouseover='this.style.background=\"var(--surface)\"' onmouseout='this.style.background=\"var(--hover)\"' title='{file.filename}'>{image_svg}<span style='font-size:13px;font-weight:500;'>Image</span></a>"
        content = f"{message}\n\n{icon_html}" if message else icon_html
    else:
        icon_html = f"<a href='{file_url}' target='_blank' style='display:inline-flex;align-items:center;gap:6px;padding:8px 12px;background:var(--hover);border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--text);transition:all 0.2s;' onmouseover='this.style.background=\"var(--surface)\"' onmouseout='this.style.background=\"var(--hover)\"' title='{file.filename}'>{file_svg}<span style='font-size:13px;font-weight:500;'>File</span></a>"
        content = f"{message}\n\n{icon_html}" if message else icon_html
    
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT * FROM chats WHERE id=%s', (cid,))
        chat = cursor.fetchone()
        if not chat:
            cursor.close()
            conn.close()
            return jsonify({'error': 'Chat not found'}), 404
        
        cursor.execute('INSERT INTO messages (chat_id, role, content, file_data, file_name, file_type) VALUES (%s,%s,%s,%s,%s,%s)', 
                      (cid, 'user', content, file_data, file.filename, file.content_type))
        conn.commit()
        msg_id = cursor.lastrowid
        
        # Update content with actual message ID for file URL
        actual_content = content.replace('{msg_id}', str(msg_id))
        cursor.execute('UPDATE messages SET content=%s WHERE id=%s', (actual_content, msg_id))
        conn.commit()
        
        cursor.execute('SELECT id, chat_id, role, content, file_name, file_type, created_at FROM messages WHERE chat_id=%s AND role="user" ORDER BY id DESC LIMIT 1', (cid,))
        user_msg = cursor.fetchone()
        
        cursor.execute('SELECT COUNT(*) as cnt FROM messages WHERE chat_id=%s', (cid,))
        msg_count = cursor.fetchone()['cnt']
        if msg_count <= 2:
            title = file.filename[:60]
            cursor.execute('UPDATE chats SET title=%s WHERE id=%s', (title, cid))
            conn.commit()
        
        cursor.execute('SELECT role, content FROM messages WHERE chat_id=%s ORDER BY created_at', (cid,))
        history = [{'role': r['role'], 'content': r['content']} for r in cursor.fetchall()][-14:]
        model = chat['model']
        cursor.execute('SELECT title FROM chats WHERE id=%s', (cid,))
        updated_title = cursor.fetchone()['title']

        ai_prompt = f"{file_analysis}\n\nUser message: {message if message else 'Please analyze this file.'}"
        ai_text = generate_ai_response(ai_prompt, model, history)

        cursor.execute('INSERT INTO messages (chat_id, role, content) VALUES (%s,%s,%s)', (cid, 'assistant', ai_text))
        conn.commit()
        cursor.execute('SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id=%s AND role="assistant" ORDER BY id DESC LIMIT 1', (cid,))
        ai_msg = cursor.fetchone()
        cursor.close()
        conn.close()

        return jsonify({'user_message': dict(user_msg), 'ai_message': dict(ai_msg), 'chat_title': updated_title})
    except Exception as e:
        logger.error(f"File upload error: {e}")
        return jsonify({'error': 'Failed to process file'}), 500

@bp.route('/messages/<int:mid>', methods=['PATCH'])
@csrf_required
def edit_message(mid):
    try:
        d = request.json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE messages SET content=%s WHERE id=%s', (sanitize_input(d.get('content', ''), 4000), mid))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Edit message error: {e}")
        return jsonify({'error': 'Failed to edit message'}), 500

@bp.route('/chats/<int:cid>/regenerate/<int:user_msg_id>', methods=['POST'])
@rate_limit(max_requests=20, window=60)
@csrf_required
def regenerate_response(cid, user_msg_id):
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT id, chat_id, role, content, created_at FROM messages WHERE id=%s AND chat_id=%s AND role="user"', (user_msg_id, cid))
        user_msg = cursor.fetchone()
        if not user_msg:
            cursor.close()
            conn.close()
            return jsonify({'error': 'User message not found'}), 404
        
        cursor.execute('SELECT * FROM chats WHERE id=%s', (cid,))
        chat = cursor.fetchone()
        if not chat:
            cursor.close()
            conn.close()
            return jsonify({'error': 'Chat not found'}), 404
        
        cursor.execute('DELETE FROM messages WHERE chat_id=%s AND id>%s', (cid, user_msg_id))
        conn.commit()
        
        cursor.execute('SELECT role, content FROM messages WHERE chat_id=%s ORDER BY created_at', (cid,))
        history = [{'role': r['role'], 'content': r['content']} for r in cursor.fetchall()][-14:]
        
        model = chat['model']
        ai_text = generate_ai_response(user_msg['content'], model, history)
        
        cursor.execute('INSERT INTO messages (chat_id, role, content) VALUES (%s,%s,%s)', (cid, 'assistant', ai_text))
        conn.commit()
        cursor.execute('SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id=%s AND role="assistant" ORDER BY id DESC LIMIT 1', (cid,))
        ai_msg = cursor.fetchone()
        cursor.close()
        conn.close()
        
        logger.info(f"Response regenerated for chat {cid}")
        return jsonify({'ai_message': dict(ai_msg)})
    except Exception as e:
        logger.error(f"Regenerate error: {e}")
        return jsonify({'error': 'Failed to regenerate response', 'retry': True}), 500

@bp.route('/chats/<int:cid>/export', methods=['GET'])
def export_chat(cid):
    fmt = request.args.get('format', 'txt')
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute('SELECT * FROM chats WHERE id=%s', (cid,))
    chat = cursor.fetchone()
    if not chat:
        cursor.close()
        conn.close()
        return jsonify({'error': 'Not found'}), 404
    cursor.execute('SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id=%s ORDER BY created_at', (cid,))
    msgs = cursor.fetchall()
    cursor.close()
    conn.close()
    
    if fmt == 'json':
        data = {'title': chat['title'], 'model': chat['model'], 'created_at': str(chat['created_at']),
                'messages': [{'role': m['role'], 'content': m['content'], 'time': str(m['created_at'])} for m in msgs]}
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

@bp.route('/files/<int:msg_id>')
def get_file(msg_id):
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT file_data, file_name, file_type FROM messages WHERE id=%s', (msg_id,))
        msg = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not msg or not msg['file_data']:
            return jsonify({'error': 'File not found'}), 404
        
        # For images, use inline display; for other files, use attachment
        is_image = msg['file_type'] and msg['file_type'].startswith('image/')
        disposition = 'inline' if is_image else 'attachment'
        
        return Response(msg['file_data'], mimetype=msg['file_type'], 
                       headers={'Content-Disposition': f'{disposition}; filename="{msg["file_name"]}"'})
    except Exception as e:
        logger.error(f"File serve error: {e}")
        return jsonify({'error': 'Failed to load file'}), 500

@bp.route('/stats')
def get_stats():
    uid = session.get('user_id')
    if not uid: return jsonify({'chats': 0, 'messages': 0, 'tasks': 0})
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute('SELECT COUNT(*) as cnt FROM chats WHERE user_id=%s', (uid,))
    chats = cursor.fetchone()['cnt']
    cursor.execute('SELECT COUNT(*) as cnt FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id=%s)', (uid,))
    messages = cursor.fetchone()['cnt']
    cursor.execute('SELECT COUNT(*) as cnt FROM tasks WHERE user_id=%s', (uid,))
    tasks = cursor.fetchone()['cnt']
    cursor.close()
    conn.close()
    return jsonify({'chats': chats, 'messages': messages, 'tasks': tasks})
