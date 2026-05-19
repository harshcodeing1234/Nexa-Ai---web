from flask import Blueprint, request, jsonify, session
from app.models.database import get_db
from app.utils.security import csrf_required, rate_limit
from app.utils.validation import sanitize_input
import logging

bp = Blueprint('tasks', __name__, url_prefix='/api')
logger = logging.getLogger(__name__)

@bp.route('/tasks', methods=['GET'])
def get_tasks():
    uid = session.get('user_id')
    sid = request.args.get('session_id', '')
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        if uid:
            cursor.execute('SELECT * FROM tasks WHERE user_id=%s ORDER BY completed ASC, created_at DESC', (uid,))
        else:
            cursor.execute('SELECT * FROM tasks WHERE session_id=%s ORDER BY completed ASC, created_at DESC', (sid,))
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(rows)
    except Exception as e:
        logger.error(f"Get tasks error: {e}")
        return jsonify({'error': 'Failed to load tasks'}), 500

@bp.route('/tasks', methods=['POST'])
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
        
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('INSERT INTO tasks (user_id, session_id, title, priority) VALUES (%s,%s,%s,%s)',
                   (uid, d.get('session_id', ''), title, priority))
        conn.commit()
        cursor.execute('SELECT * FROM tasks ORDER BY id DESC LIMIT 1')
        task = cursor.fetchone()
        cursor.close()
        conn.close()
        logger.info(f"Task created: {task['id']}")
        return jsonify(task)
    except Exception as e:
        logger.error(f"Add task error: {e}")
        return jsonify({'error': 'Failed to create task'}), 500

@bp.route('/tasks/<int:tid>', methods=['PATCH'])
@csrf_required
def update_task(tid):
    try:
        d = request.json
        conn = get_db()
        cursor = conn.cursor()
        if 'completed' in d: cursor.execute('UPDATE tasks SET completed=%s WHERE id=%s', (int(d['completed']), tid))
        if 'title' in d: cursor.execute('UPDATE tasks SET title=%s WHERE id=%s', (sanitize_input(d['title'], 500), tid))
        if 'priority' in d: cursor.execute('UPDATE tasks SET priority=%s WHERE id=%s', (d['priority'], tid))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Update task error: {e}")
        return jsonify({'error': 'Failed to update task'}), 500

@bp.route('/tasks/<int:tid>', methods=['DELETE'])
@csrf_required
def delete_task(tid):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM tasks WHERE id=%s', (tid,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Delete task error: {e}")
        return jsonify({'error': 'Failed to delete task'}), 500

@bp.route('/diary', methods=['GET'])
def get_diary_entries():
    uid = session.get('user_id')
    sid = request.args.get('session_id', '')
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        if uid:
            cursor.execute('SELECT * FROM diary_entries WHERE user_id=%s ORDER BY updated_at DESC', (uid,))
        else:
            cursor.execute('SELECT * FROM diary_entries WHERE session_id=%s ORDER BY updated_at DESC', (sid,))
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(rows)
    except Exception as e:
        logger.error(f"Get diary entries error: {e}")
        return jsonify({'error': 'Failed to load entries'}), 500

@bp.route('/diary', methods=['POST'])
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
        
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('INSERT INTO diary_entries (user_id, session_id, title, content) VALUES (%s,%s,%s,%s)',
            (uid, sid, title, content))
        conn.commit()
        entry_id = cursor.lastrowid
        cursor.execute('SELECT * FROM diary_entries WHERE id=%s', (entry_id,))
        entry = cursor.fetchone()
        cursor.close()
        conn.close()
        return jsonify(entry)
    except Exception as e:
        logger.error(f"Add diary entry error: {e}")
        return jsonify({'error': 'Failed to create entry'}), 500

@bp.route('/diary/<int:eid>', methods=['PATCH'])
@csrf_required
def update_diary_entry(eid):
    try:
        d = request.json
        conn = get_db()
        cursor = conn.cursor()
        if 'title' in d and 'content' in d:
            cursor.execute('UPDATE diary_entries SET title=%s, content=%s, updated_at=NOW() WHERE id=%s', 
                      (d['title'], d['content'], eid))
        elif 'title' in d:
            cursor.execute('UPDATE diary_entries SET title=%s, updated_at=NOW() WHERE id=%s', (d['title'], eid))
        elif 'content' in d:
            cursor.execute('UPDATE diary_entries SET content=%s, updated_at=NOW() WHERE id=%s', (d['content'], eid))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Update diary entry error: {e}")
        return jsonify({'error': 'Failed to update entry'}), 500

@bp.route('/diary/<int:eid>', methods=['DELETE'])
@csrf_required
def delete_diary_entry(eid):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM diary_entries WHERE id=%s', (eid,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Delete diary entry error: {e}")
        return jsonify({'error': 'Failed to delete entry'}), 500
