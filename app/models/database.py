import mysql.connector
from mysql.connector import pooling
import os

# Connection pool for better performance
db_pool = pooling.MySQLConnectionPool(
    pool_name="nexa_pool",
    pool_size=5,
    host=os.environ.get('DB_HOST', 'localhost'),
    user=os.environ.get('DB_USER', 'root'),
    password=os.environ.get('DB_PASSWORD'),
    database=os.environ.get('DB_NAME', 'nexa')
)

def get_db():
    return db_pool.get_connection()

def init_db():
    import logging
    logger = logging.getLogger(__name__)
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE,
            phone VARCHAR(20) UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            theme VARCHAR(10) DEFAULT 'dark',
            photo MEDIUMBLOB,
            photo_type VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chats (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            title VARCHAR(500) DEFAULT 'New Chat',
            model VARCHAR(50) DEFAULT 'nexa-pro',
            is_saved TINYINT(1) DEFAULT 0,
            is_pinned TINYINT(1) DEFAULT 0,
            is_temporary TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            chat_id INT NOT NULL,
            role VARCHAR(20) NOT NULL,
            content TEXT NOT NULL,
            file_data LONGBLOB,
            file_name VARCHAR(255),
            file_type VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            session_id VARCHAR(255),
            title VARCHAR(1000) NOT NULL,
            completed TINYINT(1) DEFAULT 0,
            priority VARCHAR(20) DEFAULT 'normal',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS diary_entries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            session_id VARCHAR(255),
            title VARCHAR(500) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    ''')
    
    indexes = [
        ('idx_chats_user', 'CREATE INDEX idx_chats_user ON chats(user_id, created_at DESC)'),
        ('idx_chats_pinned', 'CREATE INDEX idx_chats_pinned ON chats(is_pinned, created_at DESC)'),
        ('idx_messages_chat', 'CREATE INDEX idx_messages_chat ON messages(chat_id, created_at)'),
        ('idx_tasks_user', 'CREATE INDEX idx_tasks_user ON tasks(user_id, completed)'),
        ('idx_tasks_session', 'CREATE INDEX idx_tasks_session ON tasks(session_id, completed)'),
    ]
    for idx_name, idx_sql in indexes:
        try:
            cursor.execute(idx_sql)
        except Exception as e:
            if '1061' not in str(e):
                logger.error(f"Index creation error: {e}")
    
    conn.commit()
    cursor.close()
    conn.close()
    logger.info("Database initialized successfully")
