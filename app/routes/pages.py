from flask import Blueprint, render_template, redirect, request

bp = Blueprint('pages', __name__)

@bp.route('/')
def index():
    user_agent = request.headers.get('User-Agent', '').lower()
    is_mobile = any(x in user_agent for x in ['mobile', 'android', 'iphone', 'ipad', 'ipod'])
    if is_mobile:
        return redirect('/chat')
    return render_template('index.html')

@bp.route('/splash')
def splash():
    return render_template('splash.html')

@bp.route('/auth')
def auth():
    return render_template('auth.html')

@bp.route('/chat')
def chat_page():
    return render_template('chat.html')

@bp.route('/diary')
def diary_page():
    return render_template('chat.html')
