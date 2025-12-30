// Аутентификация и управление сессией
class Auth {
  constructor() {
    this.currentUser = null;
    this.init();
  }

  init() {
    // Проверяем сохраненную сессию
    const savedUser = localStorage.getItem('seva_user');
    if (savedUser) {
      this.currentUser = JSON.parse(savedUser);
      this.showMainScreen();
    }

    this.setupTabs();
    this.setupForms();
  }

  setupTabs() {
    const tabs = document.querySelectorAll('.auth-tab');
    const forms = document.querySelectorAll('.auth-form');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;

        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        forms.forEach(form => {
          form.classList.remove('active');
          if (form.id === `${targetTab}-form`) {
            form.classList.add('active');
          }
        });
      });
    });
  }

  setupForms() {
    // Форма входа
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleLogin();
    });

    // Форма регистрации
    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleRegister();
    });
  }

  async handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    errorEl.textContent = '';

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Ошибка входа');
      }

      this.currentUser = {
        userId: data.userId,
        username: data.username,
        avatarColor: data.avatarColor
      };

      localStorage.setItem('seva_user', JSON.stringify(this.currentUser));
      this.showMainScreen();

    } catch (error) {
      errorEl.textContent = error.message;
    }
  }

  async handleRegister() {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;
    const errorEl = document.getElementById('register-error');

    errorEl.textContent = '';

    if (password !== passwordConfirm) {
      errorEl.textContent = 'Пароли не совпадают';
      return;
    }

    if (password.length < 6) {
      errorEl.textContent = 'Пароль должен содержать минимум 6 символов';
      return;
    }

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Ошибка регистрации');
      }

      this.currentUser = {
        userId: data.userId,
        username: data.username,
        avatarColor: '#3390ec'
      };

      localStorage.setItem('seva_user', JSON.stringify(this.currentUser));
      this.showMainScreen();

    } catch (error) {
      errorEl.textContent = error.message;
    }
  }

  showMainScreen() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');

    // Обновляем информацию о пользователе
    const avatar = document.getElementById('current-user-avatar');
    avatar.style.backgroundColor = this.currentUser.avatarColor;
    avatar.textContent = this.currentUser.username.charAt(0).toUpperCase();

    document.getElementById('current-username').textContent = this.currentUser.username;

    // Инициализируем мессенджер
    if (typeof messenger !== 'undefined') {
      messenger.init(this.currentUser);
    }
  }

  logout() {
    this.currentUser = null;
    localStorage.removeItem('seva_user');
    location.reload();
  }
}

// Создаем экземпляр аутентификации
const auth = new Auth();
