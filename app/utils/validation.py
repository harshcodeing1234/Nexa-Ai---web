import re, html
import bleach

def validate_email(email):
    return re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email) if email else False

def validate_phone(phone):
    return re.match(r'^\+?[1-9]\d{1,14}$', phone.replace(' ', '').replace('-', '')) if phone else False

def validate_password_strength(password):
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
    return html.escape(str(text).strip()[:max_length])

def sanitize_html_output(text):
    if not text: return ''
    allowed_tags = ['p', 'br', 'strong', 'em', 'u', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'img', 'div', 'span']
    allowed_attrs = {'a': ['href', 'title', 'target', 'download', 'style'], 'img': ['src', 'alt', 'style', 'onclick'], 'div': ['style'], 'span': ['style']}
    return bleach.clean(text, tags=allowed_tags, attributes=allowed_attrs, strip=True)

def allowed_file(filename):
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'doc', 'docx', 'csv', 'xlsx'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
