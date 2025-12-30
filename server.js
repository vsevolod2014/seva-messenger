const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Инициализация базы данных
const db = new Database('messenger.db');

// Создание таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar_color TEXT DEFAULT '#3390ec',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT DEFAULT 'private',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id TEXT,
    user_id TEXT,
    PRIMARY KEY (chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
`);

// Хранение активных пользователей
const onlineUsers = new Map();

// Состояние звонков (кто с кем разговаривает)
const activeCalls = new Map();

// API: Регистрация
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password || username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const avatarColors = ['#3390ec', '#4caf50', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4'];
    const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];

    db.prepare('INSERT INTO users (id, username, password, avatar_color) VALUES (?, ?, ?, ?)').run(
      userId, username, hashedPassword, avatarColor
    );

    res.json({ success: true, userId, username });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// API: Вход
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ 
      success: true, 
      userId: user.id, 
      username: user.username,
      avatarColor: user.avatar_color
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// API: Получить всех пользователей
app.get('/api/users', (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, avatar_color FROM users').all();
    const usersWithStatus = users.map(user => ({
      ...user,
      online: onlineUsers.has(user.id)
    }));
    res.json(usersWithStatus);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// API: Создать или получить чат с пользователем
app.post('/api/chats', (req, res) => {
  try {
    const { userId1, userId2 } = req.body;

    // Проверяем существующий чат
    const existingChat = db.prepare(`
      SELECT c.id FROM chats c
      JOIN chat_participants cp1 ON c.id = cp1.chat_id
      JOIN chat_participants cp2 ON c.id = cp2.chat_id
      WHERE c.type = 'private'
      AND cp1.user_id = ? AND cp2.user_id = ?
      LIMIT 1
    `).get(userId1, userId2);

    if (existingChat) {
      return res.json({ chatId: existingChat.id, existing: true });
    }

    // Создаем новый чат
    const chatId = uuidv4();
    const otherUser = db.prepare('SELECT username FROM users WHERE id = ?').get(userId2);

    db.prepare('INSERT INTO chats (id, name, type) VALUES (?, ?, ?)').run(chatId, otherUser.username, 'private');
    db.prepare('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)').run(chatId, userId1);
    db.prepare('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)').run(chatId, userId2);

    res.json({ chatId, existing: false });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

// API: Получить чаты пользователя
app.get('/api/chats/:userId', (req, res) => {
  try {
    const { userId } = req.params;

    const chats = db.prepare(`
      SELECT 
        c.id,
        c.name,
        c.type,
        (SELECT content FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND sender_id != ? AND 
         (SELECT COUNT(*) FROM message_reads WHERE message_id = messages.id AND user_id = ?) = 0) as unread_count
      FROM chats c
      JOIN chat_participants cp ON c.id = cp.chat_id
      WHERE cp.user_id = ?
      ORDER BY last_message_time DESC
    `).all(userId, userId, userId);

    // Добавляем информацию о собеседниках для приватных чатов
    const chatsWithParticipants = chats.map(chat => {
      if (chat.type === 'private') {
        const participant = db.prepare(`
          SELECT u.id, u.username, u.avatar_color 
          FROM users u
          JOIN chat_participants cp ON u.id = cp.user_id
          WHERE cp.chat_id = ? AND u.id != ?
        `).get(chat.id, userId);

        return {
          ...chat,
          participant: participant ? {
            id: participant.id,
            username: participant.username,
            avatarColor: participant.avatar_color,
            online: onlineUsers.has(participant.id)
          } : null
        };
      }
      return chat;
    });

    res.json(chatsWithParticipants);
  } catch (error) {
    console.error('Fetch chats error:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// API: Получить сообщения чата
app.get('/api/messages/:chatId', (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId } = req.query;

    const messages = db.prepare(`
      SELECT m.*, u.username, u.avatar_color
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ?
      ORDER BY m.created_at ASC
    `).all(chatId);

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// API: Получить участников чата
app.get('/api/chat-participants/:chatId', (req, res) => {
  try {
    const { chatId } = req.params;
    
    const participants = db.prepare(`
      SELECT u.id, u.username, u.avatar_color
      FROM users u
      JOIN chat_participants cp ON u.id = cp.user_id
      WHERE cp.chat_id = ?
    `).all(chatId);

    const participantsWithStatus = participants.map(p => ({
      ...p,
      online: onlineUsers.has(p.id)
    }));

    res.json(participantsWithStatus);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

// Socket.IO обработка
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('auth', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
    
    // Уведомляем всех о статусе пользователя
    io.emit('user_status', { userId, online: true });
    
    console.log(`User ${userId} authenticated, online users:`, onlineUsers.size);
  });

  socket.on('join_chat', (chatId) => {
    socket.join(`chat_${chatId}`);
    console.log(`Socket ${socket.id} joined chat_${chatId}`);
  });

  socket.on('leave_chat', (chatId) => {
    socket.leave(`chat_${chatId}`);
  });

  socket.on('send_message', async (data) => {
    const { chatId, senderId, content } = data;
    
    try {
      const messageId = uuidv4();
      
      // Сохраняем сообщение в БД
      db.prepare('INSERT INTO messages (id, chat_id, sender_id, content) VALUES (?, ?, ?, ?)').run(
        messageId, chatId, senderId, content
      );

      // Получаем информацию об отправителе
      const sender = db.prepare('SELECT username, avatar_color FROM users WHERE id = ?').get(senderId);

      const message = {
        id: messageId,
        chat_id: chatId,
        sender_id: senderId,
        content,
        username: sender.username,
        avatar_color: sender.avatar_color,
        created_at: new Date().toISOString()
      };

      // Отправляем сообщение всем в чате
      io.to(`chat_${chatId}`).emit('new_message', message);
      
      console.log(`Message sent in chat ${chatId}`);
    } catch (error) {
      console.error('Send message error:', error);
    }
  });

  socket.on('typing', (data) => {
    const { chatId, userId, username } = data;
    socket.to(`chat_${chatId}`).emit('user_typing', { userId, username });
  });

  socket.on('stop_typing', (data) => {
    const { chatId, userId } = data;
    socket.to(`chat_${chatId}`).emit('user_stop_typing', { userId });
  });

  // WebRTC Signaling для звонков
  socket.on('call-user', (data) => {
    const { targetUserId, callerId, callerName, callerAvatar } = data;
    const targetSocketId = onlineUsers.get(targetUserId);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-call', {
        callerId,
        callerName,
        callerAvatar
      });
      console.log(`Call from ${callerName} to user ${targetUserId}`);
    }
  });

  socket.on('answer-call', (data) => {
    const { targetUserId, answer, callerId } = data;
    const targetSocketId = onlineUsers.get(targetUserId);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-answered', { answer, answererId: callerId });
    }
    
    // Сохраняем состояние звонка
    activeCalls.set(`${data.callerId}-${targetUserId}`, { startTime: Date.now() });
  });

  socket.on('reject-call', (data) => {
    const { callerId, rejecterId, rejecterName } = data;
    const callerSocketId = onlineUsers.get(callerId);
    
    if (callerSocketId) {
      io.to(callerSocketId).emit('call-rejected', { rejecterName });
    }
    
    // Удаляем состояние звонка
    activeCalls.delete(`${callerId}-${rejecterId}`);
  });

  socket.on('ice-candidate', (data) => {
    const { targetUserId, candidate, fromUserId } = data;
    const targetSocketId = onlineUsers.get(targetUserId);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', { candidate, fromUserId });
    }
  });

  socket.on('hang-up', (data) => {
    const { userId1, userId2 } = data;
    const socket1 = onlineUsers.get(userId1);
    const socket2 = onlineUsers.get(userId2);
    
    if (socket1) io.to(socket1).emit('call-ended');
    if (socket2) io.to(socket2).emit('call-ended');
    
    // Удаляем состояние звонка
    activeCalls.delete(`${userId1}-${userId2}`);
    activeCalls.delete(`${userId2}-${userId1}`);
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      io.emit('user_status', { userId: socket.userId, online: false });
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
