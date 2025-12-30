const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = path.join(__dirname, 'db.json');

function initDB() {
  const defaultData = {
    users: [],
    chats: [],
    messages: [],
    chatParticipants: []
  };
  
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
  }
}

function readDB() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading DB:', error);
    return { users: [], chats: [], messages: [], chatParticipants: [] };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing DB:', error);
  }
}

function generateId() {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getRandomColor() {
  const colors = ['#3390ec', '#4caf50', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4'];
  return colors[Math.floor(Math.random() * colors.length)];
}

initDB();

const onlineUsers = new Map();

app.post('/api/register', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password || username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    const db = readDB();
    const existingUser = db.users.find(u => u.username === username);
    
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const userId = generateId();
    const user = {
      id: userId,
      username,
      password,
      avatarColor: getRandomColor(),
      createdAt: new Date().toISOString()
    };
    
    db.users.push(user);
    writeDB(db);

    res.json({ success: true, userId, username });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;

    const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ 
      success: true, 
      userId: user.id, 
      username: user.username,
      avatarColor: user.avatarColor
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/users', (req, res) => {
  try {
    const db = readDB();
    const usersWithStatus = db.users.map(user => ({
      id: user.id,
      username: user.username,
      avatar_color: user.avatarColor,
      online: onlineUsers.has(user.id)
    }));
    res.json(usersWithStatus);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/chats', (req, res) => {
  try {
    const { userId1, userId2 } = req.body;
    const db = readDB();

    const existingChat = db.chats.find(chat => {
      if (chat.type !== 'private') return false;
      const participants = db.chatParticipants.filter(cp => cp.chatId === chat.id);
      const hasUser1 = participants.some(p => p.userId === userId1);
      const hasUser2 = participants.some(p => p.userId === userId2);
      return hasUser1 && hasUser2;
    });

    if (existingChat) {
      return res.json({ chatId: existingChat.id, existing: true });
    }

    const chatId = generateId();
    const otherUser = db.users.find(u => u.id === userId2);
    
    const chat = {
      id: chatId,
      name: otherUser ? otherUser.username : 'Unknown',
      type: 'private',
      createdAt: new Date().toISOString()
    };
    
    db.chats.push(chat);
    db.chatParticipants.push({ chatId, userId: userId1 });
    db.chatParticipants.push({ chatId, userId: userId2 });
    writeDB(db);

    res.json({ chatId, existing: false });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

app.get('/api/chats/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const db = readDB();

    const userChats = db.chatParticipants
      .filter(cp => cp.userId === userId)
      .map(cp => {
        const chat = db.chats.find(c => c.id === cp.chatId);
        if (!chat) return null;
        
        const chatMessages = db.messages.filter(m => m.chatId === chat.id);
        const lastMessage = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
        
        let participant = null;
        if (chat.type === 'private') {
          const otherParticipant = db.chatParticipants.find(
            cp => cp.chatId === chat.id && cp.userId !== userId
          );
          if (otherParticipant) {
            const otherUser = db.users.find(u => u.id === otherParticipant.userId);
            if (otherUser) {
              participant = {
                id: otherUser.id,
                username: otherUser.username,
                avatarColor: otherUser.avatarColor,
                online: onlineUsers.has(otherUser.id)
              };
            }
          }
        }

        return {
          id: chat.id,
          name: chat.name,
          type: chat.type,
          last_message: lastMessage ? lastMessage.content : null,
          last_message_time: lastMessage ? lastMessage.createdAt : chat.createdAt,
          participant
        };
      })
      .filter(chat => chat !== null)
      .sort((a, b) => new Date(b.last_message_time) - new Date(a.last_message_time));

    res.json(userChats);
  } catch (error) {
    console.error('Fetch chats error:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.get('/api/messages/:chatId', (req, res) => {
  try {
    const { chatId } = req.params;
    const db = readDB();
    
    const messages = db.messages
      .filter(m => m.chatId === chatId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('auth', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
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

  socket.on('send_message', (data) => {
    const { chatId, senderId, content } = data;
    
    try {
      const messageId = generateId();
      const db = readDB();
      
      const sender = db.users.find(u => u.id === senderId);
      if (!sender) return;

      const message = {
        id: messageId,
        chatId,
        senderId,
        content,
        username: sender.username,
        avatarColor: sender.avatarColor,
        createdAt: new Date().toISOString()
      };
      
      db.messages.push(message);
      writeDB(db);

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
  });

  socket.on('reject-call', (data) => {
    const { callerId, rejecterId, rejecterName } = data;
    const callerSocketId = onlineUsers.get(callerId);
    
    if (callerSocketId) {
      io.to(callerSocketId).emit('call-rejected', { rejecterName });
    }
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
  console.log('Using JSON-based database (no native dependencies)');
});
