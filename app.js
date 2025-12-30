// Основной класс мессенджера
class Messenger {
  constructor() {
    this.socket = null;
    this.currentUser = null;
    this.currentChat = null;
    this.chats = [];
    this.users = [];
    this.typingTimeout = null;
    this.isTyping = false;
    
    // WebRTC и звонки
    this.peerConnection = null;
    this.localStream = null;
    this.currentCallPartner = null;
    this.callTimer = null;
    this.callStartTime = null;
    this.incomingCallFrom = null;
    
    // Конфигурация ICE серверов
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
  }

  init(user) {
    this.currentUser = user;
    this.initSocket();
    this.setupEventListeners();
    this.setupCallEventListeners();
    this.loadChats();
  }

  initSocket() {
    // Подключаемся к Socket.IO
    this.socket = io();

    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.socket.emit('auth', this.currentUser.userId);
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      // Завершаем звонок при отключении
      if (this.currentCallPartner) {
        this.endCall();
      }
    });

    this.socket.on('new_message', (message) => {
      this.handleNewMessage(message);
    });

    this.socket.on('user_typing', (data) => {
      this.handleUserTyping(data);
    });

    this.socket.on('user_stop_typing', (data) => {
      this.handleUserStopTyping(data);
    });

    this.socket.on('user_status', (data) => {
      this.handleUserStatus(data);
    });

    // WebRTC Signaling события для звонков
    this.socket.on('incoming-call', (data) => {
      this.handleIncomingCall(data);
    });

    this.socket.on('call-answered', (data) => {
      this.handleCallAnswered(data);
    });

    this.socket.on('call-rejected', (data) => {
      this.handleCallRejected(data);
    });

    this.socket.on('ice-candidate', (data) => {
      this.handleIceCandidate(data);
    });

    this.socket.on('call-ended', () => {
      this.handleCallEnded();
    });
  }

  setupEventListeners() {
    // Кнопка нового чата
    document.getElementById('new-chat-btn').addEventListener('click', () => {
      this.showNewChatModal();
    });

    // Модальное окно
    document.getElementById('modal-backdrop').addEventListener('click', () => {
      this.hideNewChatModal();
    });

    document.getElementById('modal-close').addEventListener('click', () => {
      this.hideNewChatModal();
    });

    // Поиск пользователей
    document.getElementById('user-search').addEventListener('input', (e) => {
      this.filterUsers(e.target.value);
    });

    // Поле ввода сообщения
    const messageInput = document.getElementById('message-input');
    messageInput.addEventListener('input', (e) => {
      this.handleTyping(e.target.value);
      this.autoResizeTextarea(e.target);
    });

    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Кнопка отправки
    document.getElementById('send-btn').addEventListener('click', () => {
      this.sendMessage();
    });

    // Кнопка назад
    document.getElementById('back-btn').addEventListener('click', () => {
      this.showChatList();
    });

    // Поиск чатов
    document.getElementById('search-chats').addEventListener('input', (e) => {
      this.filterChats(e.target.value);
    });
  }

  setupCallEventListeners() {
    // Кнопка звонка в чате
    document.getElementById('call-btn').addEventListener('click', () => {
      this.startCall();
    });

    // Кнопка принятия звонка
    document.getElementById('call-accept').addEventListener('click', () => {
      this.acceptCall();
    });

    // Кнопка сброса звонка
    document.getElementById('call-decline').addEventListener('click', () => {
      this.rejectCall();
    });

    // Кнопка завершения звонка
    document.getElementById('hangup-btn').addEventListener('click', () => {
      this.endCall();
    });
  }

  // ==================== ЗВОНОКИ ====================

  async startCall() {
    if (!this.currentChat) return;
    
    const chat = this.chats.find(c => c.id === this.currentChat);
    if (!chat || !chat.participant) return;
    
    const partner = chat.participant;
    
    // Проверяем, онлайн ли собеседник
    if (!partner.online) {
      alert('Пользователь сейчас офлайн. Позвоните позже.');
      return;
    }

    // Проверяем, не занят ли пользователь уже в звонке
    if (this.currentCallPartner) {
      alert('Вы уже разговариваете. Завершите текущий звонок.');
      return;
    }

    try {
      // Запрашиваем доступ к микрофону
      console.log('Запрос доступа к микрофону...');
      this.localStream = await navigator.mediaDevices.getUserMedia({ 
        audio: true,
        video: false 
      });
      
      console.log('Доступ к микрофону получен');
      
      // Создаем RTCPeerConnection
      this.createPeerConnection();
      
      // Добавляем локальный аудио поток
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      // Создаем offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      // Устанавливаем состояние звонка
      this.currentCallPartner = partner;
      this.showCallStatus('Звоним...');

      // Отправляем приглашение на звонок
      this.socket.emit('call-user', {
        targetUserId: partner.id,
        callerId: this.currentUser.userId,
        callerName: this.currentUser.username,
        callerAvatar: this.currentUser.avatarColor,
        offer: offer
      });

      console.log('Звонок начат:', partner.username);

    } catch (error) {
      console.error('Ошибка начала звонка:', error);
      alert('Не удалось начать звонок. Проверьте доступ к микрофону.');
      this.cleanupCall();
    }
  }

  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          targetUserId: this.currentCallPartner.id,
          candidate: event.candidate,
          fromUserId: this.currentUser.userId
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      console.log('Получен удаленный поток');
      const remoteAudio = document.getElementById('remote-audio');
      remoteAudio.srcObject = event.streams[0];
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('Состояние соединения:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'disconnected' || 
          this.peerConnection.connectionState === 'failed') {
        this.endCall();
      }
    };
  }

  handleIncomingCall(data) {
    console.log('Входящий звонок от:', data.callerName);
    
    this.incomingCallFrom = {
      id: data.callerId,
      name: data.callerName,
      avatar: data.callerAvatar
    };

    // Показываем модальное окно
    const callModal = document.getElementById('call-modal');
    const callAvatar = document.getElementById('call-avatar');
    const callName = document.getElementById('call-name');
    const callStatus = document.getElementById('call-status');

    callAvatar.style.backgroundColor = data.callerAvatar || '#3390ec';
    callAvatar.textContent = data.callerName.charAt(0).toUpperCase();
    callName.textContent = data.callerName;
    callStatus.textContent = 'Входящий звонок...';

    callModal.classList.remove('hidden');

    // Воспроизводим мелодию звонка
    const ringtone = document.getElementById('ringtone');
    ringtone.volume = 0.8;
    ringtone.play().catch(err => {
      console.log('Не удалось воспроизвести мелодию:', err);
    });
  }

  async acceptCall() {
    try {
      // Останавливаем мелодию
      const ringtone = document.getElementById('ringtone');
      ringtone.pause();
      ringtone.currentTime = 0;

      // Скрываем модальное окно
      document.getElementById('call-modal').classList.add('hidden');

      // Запрашиваем доступ к микрофону
      console.log('Запрос доступа к микрофону для принятия звонка...');
      this.localStream = await navigator.mediaDevices.getUserMedia({ 
        audio: true,
        video: false 
      });

      // Создаем RTCPeerConnection
      this.createPeerConnection();

      // Добавляем локальный поток
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      // Устанавливаем состояние звонка
      this.currentCallPartner = this.incomingCallFrom;
      this.incomingCallFrom = null;

      // Создаем answer
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      // Отправляем ответ
      this.socket.emit('answer-call', {
        targetUserId: this.currentCallPartner.id,
        answer: answer,
        callerId: this.currentUser.userId
      });

      // Показываем панель активного звонка
      this.showActiveCallPanel();

      console.log('Звонок принят');

    } catch (error) {
      console.error('Ошибка принятия звонка:', error);
      alert('Не удалось принять звонок. Проверьте доступ к микрофону.');
      this.rejectCall();
    }
  }

  rejectCall() {
    // Останавливаем мелодию
    const ringtone = document.getElementById('ringtone');
    ringtone.pause();
    ringtone.currentTime = 0;

    // Скрываем модальное окно
    document.getElementById('call-modal').classList.add('hidden');

    // Если был входящий звонок, отправляем отказ
    if (this.incomingCallFrom) {
      this.socket.emit('reject-call', {
        callerId: this.incomingCallFrom.id,
        rejecterId: this.currentUser.userId,
        rejecterName: this.currentUser.username
      });
      this.incomingCallFrom = null;
    }

    console.log('Звонок отклонен');
  }

  async handleCallAnswered(data) {
    console.log('Звонок принят пользователем');
    
    // Устанавливаем удаленное описание
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    
    // Показываем панель активного звонка
    this.showActiveCallPanel();
  }

  handleCallRejected(data) {
    console.log('Звонок отклонен:', data.rejecterName);
    alert(`${data.rejecterName} отклонил звонок`);
    this.cleanupCall();
    this.hideCallStatus();
  }

  async handleIceCandidate(data) {
    try {
      if (this.peerConnection && data.candidate) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch (error) {
      console.error('Ошибка добавления ICE кандидата:', error);
    }
  }

  handleCallEnded() {
    console.log('Звонок завершен собеседником');
    alert('Звонок завершен');
    this.cleanupCall();
    this.hideActiveCallPanel();
    this.hideCallStatus();
  }

  endCall() {
    if (this.currentCallPartner) {
      this.socket.emit('hang-up', {
        userId1: this.currentUser.userId,
        userId2: this.currentCallPartner.id
      });
    }
    this.cleanupCall();
    this.hideActiveCallPanel();
    this.hideCallStatus();
  }

  cleanupCall() {
    // Останавливаем локальный поток
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Закрываем RTCPeerConnection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Останавливаем таймер
    if (this.callTimer) {
      clearInterval(this.callTimer);
      this.callTimer = null;
    }

    this.currentCallPartner = null;
    this.callStartTime = null;

    // Останавливаем мелодию
    const ringtone = document.getElementById('ringtone');
    ringtone.pause();
    ringtone.currentTime = 0;

    console.log('Звонок очищен');
  }

  showActiveCallPanel() {
    const panel = document.getElementById('active-call-panel');
    const avatar = document.getElementById('active-call-avatar');
    const name = document.getElementById('active-call-name');

    avatar.style.backgroundColor = this.currentCallPartner.avatarColor || '#3390ec';
    avatar.textContent = this.currentCallPartner.username.charAt(0).toUpperCase();
    name.textContent = this.currentCallPartner.username;

    panel.classList.remove('hidden');

    // Запускаем таймер
    this.callStartTime = Date.now();
    this.callTimer = setInterval(() => this.updateCallTimer(), 1000);
  }

  hideActiveCallPanel() {
    document.getElementById('active-call-panel').classList.add('hidden');
  }

  updateCallTimer() {
    if (!this.callStartTime) return;

    const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');

    const timerEl = document.getElementById('active-call-timer');
    timerEl.textContent = `${minutes}:${seconds}`;
  }

  showCallStatus(message) {
    const statusEl = document.getElementById('chat-status');
    statusEl.textContent = message;
    statusEl.classList.add('online');
  }

  hideCallStatus() {
    const statusEl = document.getElementById('chat-status');
    const chat = this.chats.find(c => c.id === this.currentChat);
    if (chat && chat.participant) {
      if (chat.participant.online) {
        statusEl.textContent = 'в сети';
        statusEl.classList.add('online');
      } else {
        statusEl.textContent = 'был(а) в сети недавно';
        statusEl.classList.remove('online');
      }
    } else {
      statusEl.textContent = '';
      statusEl.classList.remove('online');
    }
  }

  // ==================== ОСНОВНОЙ ФУНКЦИОНАЛ ====================

  async loadChats() {
    try {
      const response = await fetch(`/api/chats/${this.currentUser.userId}`);
      this.chats = await response.json();
      this.renderChatsList();
    } catch (error) {
      console.error('Failed to load chats:', error);
    }
  }

  renderChatsList() {
    const container = document.getElementById('chats-list');
    container.innerHTML = '';

    if (this.chats.length === 0) {
      container.innerHTML = `
        <div class="empty-chats" style="text-align: center; padding: 40px 20px; color: #888;">
          <p>У вас пока нет чатов</p>
          <p style="margin-top: 10px; font-size: 14px;">Нажмите "Новый чат" чтобы начать общение</p>
        </div>
      `;
      return;
    }

    this.chats.forEach(chat => {
      const chatItem = this.createChatItem(chat);
      container.appendChild(chatItem);
    });
  }

  createChatItem(chat) {
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.dataset.chatId = chat.id;

    const lastMessageTime = chat.last_message_time 
      ? this.formatTime(new Date(chat.last_message_time))
      : '';

    const participant = chat.participant || {};
    const avatarColor = chat.type === 'private' 
      ? participant.avatar_color 
      : '#3390ec';

    item.innerHTML = `
      <div class="chat-item-avatar" style="background-color: ${avatarColor}">
        ${chat.name ? chat.name.charAt(0).toUpperCase() : '?'}
      </div>
      <div class="chat-item-info">
        <div class="chat-item-header">
          <span class="chat-item-name">${chat.name || 'Без названия'}</span>
          <span class="chat-item-time">${lastMessageTime}</span>
        </div>
        <div class="chat-item-preview">${chat.last_message || 'Нет сообщений'}</div>
      </div>
      ${chat.unread_count > 0 ? `<span class="chat-item-unread">${chat.unread_count}</span>` : ''}
    `;

    item.addEventListener('click', () => {
      this.openChat(chat.id);
    });

    return item;
  }

  async showNewChatModal() {
    const modal = document.getElementById('new-chat-modal');
    modal.classList.remove('hidden');

    try {
      const response = await fetch('/api/users');
      this.users = await response.json();
      this.renderUsersList(this.users);
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  }

  hideNewChatModal() {
    document.getElementById('new-chat-modal').classList.add('hidden');
    document.getElementById('user-search').value = '';
  }

  renderUsersList(users) {
    const container = document.getElementById('users-list');
    container.innerHTML = '';

    // Фильтруем текущего пользователя
    const otherUsers = users.filter(u => u.id !== this.currentUser.userId);

    if (otherUsers.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #888;">
          <p>Нет других пользователей</p>
        </div>
      `;
      return;
    }

    otherUsers.forEach(user => {
      const userItem = document.createElement('div');
      userItem.className = 'user-item';
      userItem.innerHTML = `
        <div class="user-item-avatar" style="background-color: ${user.avatar_color}">
          ${user.username.charAt(0).toUpperCase()}
        </div>
        <div class="user-item-info">
          <div class="user-item-name">${user.username}</div>
          <div class="user-item-status ${user.online ? 'online' : ''}">
            ${user.online ? 'в сети' : 'не в сети'}
          </div>
        </div>
      `;

      userItem.addEventListener('click', () => {
        this.createChatWithUser(user.id);
      });

      container.appendChild(userItem);
    });
  }

  filterUsers(query) {
    const filtered = this.users.filter(user => 
      user.username.toLowerCase().includes(query.toLowerCase()) &&
      user.id !== this.currentUser.userId
    );
    this.renderUsersList(filtered);
  }

  filterChats(query) {
    const filtered = this.chats.filter(chat => 
      chat.name.toLowerCase().includes(query.toLowerCase())
    );
    
    const container = document.getElementById('chats-list');
    container.innerHTML = '';
    
    filtered.forEach(chat => {
      container.appendChild(this.createChatItem(chat));
    });
  }

  async createChatWithUser(otherUserId) {
    try {
      const response = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId1: this.currentUser.userId,
          userId2: otherUserId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create chat');
      }

      this.hideNewChatModal();
      await this.loadChats();

      if (!data.existing) {
        // Отправляем приветственное сообщение
        this.socket.emit('send_message', {
          chatId: data.chatId,
          senderId: this.currentUser.userId,
          content: 'Чат создан!'
        });
      }

      this.openChat(data.chatId);

    } catch (error) {
      console.error('Failed to create chat:', error);
      alert('Не удалось создать чат: ' + error.message);
    }
  }

  async openChat(chatId) {
    // Покидаем текущий чат
    if (this.currentChat) {
      this.socket.emit('leave_chat', this.currentChat);
    }

    this.currentChat = chatId;

    // Обновляем UI
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('active-chat').classList.remove('hidden');
    document.getElementById('sidebar').classList.add('hidden');

    // Загружаем информацию о чате
    const chat = this.chats.find(c => c.id === chatId);
    if (chat) {
      this.updateChatHeader(chat);
    }

    // Присоединяемся к чату
    this.socket.emit('join_chat', chatId);

    // Загружаем сообщения
    await this.loadMessages(chatId);
  }

  updateChatHeader(chat) {
    const participant = chat.participant;

    document.getElementById('chat-name').textContent = chat.name || 'Без названия';

    const avatar = document.getElementById('chat-avatar');
    avatar.style.backgroundColor = participant?.avatar_color || '#3390ec';
    avatar.textContent = (chat.name || '?').charAt(0).toUpperCase();

    const statusEl = document.getElementById('chat-status');
    if (participant?.online) {
      statusEl.textContent = 'в сети';
      statusEl.classList.add('online');
    } else {
      statusEl.textContent = 'был(а) в сети недавно';
      statusEl.classList.remove('online');
    }
  }

  async loadMessages(chatId) {
    try {
      const response = await fetch(`/api/messages/${chatId}?userId=${this.currentUser.userId}`);
      const messages = await response.json();

      this.renderMessages(messages);

      // Прокручиваем вниз
      const container = document.getElementById('messages-container');
      container.scrollTop = container.scrollHeight;

    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }

  renderMessages(messages) {
    const container = document.getElementById('messages-list');
    container.innerHTML = '';

    if (messages.length === 0) {
      return;
    }

    let lastDate = null;

    messages.forEach((msg, index) => {
      // Добавляем разделитель даты
      const msgDate = new Date(msg.created_at).toDateString();
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const dateDivider = document.createElement('div');
        dateDivider.className = 'date-divider';
        dateDivider.innerHTML = `<span>${this.formatDate(msg.created_at)}</span>`;
        container.appendChild(dateDivider);
      }

      const messageEl = this.createMessageElement(msg);
      container.appendChild(messageEl);
    });
  }

  createMessageElement(msg) {
    const isOwn = msg.sender_id === this.currentUser.userId;
    const messageEl = document.createElement('div');
    messageEl.className = `message ${isOwn ? 'sent' : 'received'}`;
    messageEl.dataset.messageId = msg.id;

    const time = this.formatTime(msg.created_at);

    messageEl.innerHTML = `
      <div class="message-bubble">
        ${!isOwn ? `<div class="message-sender">${msg.username}</div>` : ''}
        <div class="message-text">${this.escapeHtml(msg.content)}</div>
        <div class="message-time">
          ${time}
          ${isOwn ? '<span class="message-status">✓</span>' : ''}
        </div>
      </div>
    `;

    return messageEl;
  }

  handleNewMessage(message) {
    if (message.chat_id === this.currentChat) {
      // Добавляем сообщение в текущий чат
      const container = document.getElementById('messages-list');
      const messageEl = this.createMessageElement(message);

      // Проверяем, нужно ли добавить разделитель даты
      const msgDate = new Date(message.created_at).toDateString();
      const lastDivider = container.querySelector('.date-divider:last-child span');
      if (!lastDivider || new Date(lastDivider.textContent).toDateString() !== msgDate) {
        const dateDivider = document.createElement('div');
        dateDivider.className = 'date-divider';
        dateDivider.innerHTML = `<span>${this.formatDate(message.created_at)}</span>`;
        container.appendChild(dateDivider);
      }

      container.appendChild(messageEl);
      this.scrollToBottom();

      // Отмечаем сообщение как прочитанное (в будущем)
    } else {
      // Уведомляем о новом сообщении в другом чате
      this.showNotification(message);
    }

    // Обновляем список чатов
    this.loadChats();
  }

  async sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();

    if (!content || !this.currentChat) {
      return;
    }

    // Очищаем поле ввода
    input.value = '';
    input.style.height = 'auto';

    // Останавливаем индикатор набора
    this.stopTyping();

    // Отправляем сообщение через сокет
    this.socket.emit('send_message', {
      chatId: this.currentChat,
      senderId: this.currentUser.userId,
      content: content
    });
  }

  handleTyping(content) {
    if (!this.currentChat) return;

    if (content.trim() && !this.isTyping) {
      this.isTyping = true;
      this.socket.emit('typing', {
        chatId: this.currentChat,
        userId: this.currentUser.userId,
        username: this.currentUser.username
      });
    }

    // Очищаем предыдущий таймер
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    // Устанавливаем новый таймер для остановки индикатора
    this.typingTimeout = setTimeout(() => {
      this.stopTyping();
    }, 1000);
  }

  stopTyping() {
    if (this.isTyping && this.currentChat) {
      this.isTyping = false;
      this.socket.emit('stop_typing', {
        chatId: this.currentChat,
        userId: this.currentUser.userId
      });
    }
  }

  handleUserTyping(data) {
    if (data.userId === this.currentUser.userId || data.chatId !== this.currentChat) return;

    const indicator = document.getElementById('typing-indicator');
    indicator.classList.add('active');
    indicator.querySelector('span').textContent = `${data.username} печатает...`;
    this.scrollToBottom();
  }

  handleUserStopTyping(data) {
    if (data.userId === this.currentUser.userId || data.chatId !== this.currentChat) return;

    const indicator = document.getElementById('typing-indicator');
    indicator.classList.remove('active');
  }

  handleUserStatus(data) {
    // Обновляем статус пользователя в списке
    this.loadChats();
  }

  showChatList() {
    this.currentChat = null;
    document.getElementById('active-chat').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
  }

  showNotification(message) {
    // В будущем можно добавить уведомления
  }

  scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
  }

  autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  }

  formatTime(date) {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;

    // Показываем время для сообщений сегодня
    if (diff < 24 * 60 * 60 * 1000 && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    // Показываем дату для более старых сообщений
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + 
           ' ' + 
           d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  formatDate(date) {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;

    // Сегодня
    if (d.toDateString() === now.toDateString()) {
      return 'Сегодня';
    }

    // Вчера
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return 'Вчера';
    }

    // Другие дни
    return d.toLocaleDateString('ru-RU', { 
      day: 'numeric', 
      month: 'long', 
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Создаем экземпляр мессенджера
const messenger = new Messenger();
