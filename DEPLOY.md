# Развёртывание Seva Messenger на Railway

## Вариант 1: Railway (Рекомендуется)

### Шаг 1: Установка Railway CLI
```bash
npm install -g @railway/cli
```

### Шаг 2: Авторизация
```bash
railway login
```

### Шаг 3: Инициализация проекта
```bash
cd /workspace/seva-messenger
railway init
```

### Шаг 4: Деплой
```bash
railway up
```

### Шаг 5: Получить ссылку
```bash
railway open
```

---

## Вариант 2: Render.com

### Шаг 1: Загрузите код на GitHub
Создайте репозиторий и загрузите файлы:
- server.js
- package.json  
- public/ (всю папку)

### Шаг 2: Подключите к Render
1. Зайдите на https://render.com
2. Создайте новый Web Service
3. Подключите ваш GitHub репозиторий
4. Настройте:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variables: не требуются

### Шаг 3: Деплой
Нажмите "Create Web Service" и дождитесь завершения.

---

## Вариант 3: Fly.io

### Шаг 1: Установка Fly CLI
```bash
curl -L https://fly.io/install.sh | sh
```

### Шаг 2: Авторизация
```bash
fly auth login
```

### Шаг 3: Создание приложения
```bash
cd /workspace/seva-messenger
fly apps create seva-messenger
```

### Шаг 4: Деплой
```bash
fly deploy
```

---

## Вариант 4: Heroku

### Шаг 1: Установка Heroku CLI
```bash
npm install -g heroku
```

### Шаг 2: Авторизация
```bash
heroku login
```

### Шаг 3: Создание приложения
```bash
cd /workspace/seva-messenger
heroku create seva-messenger
```

### Шаг 4: Деплой
```bash
git init
git add .
git commit -m "Initial commit"
heroku git:remote -a seva-messenger
git push heroku main
```

---

## После деплоя

Ваш мессенджер будет доступен по ссылке:
- Railway: `https://seva-messenger.up.railway.app`
- Render: `https://your-app-name.onrender.com`
- Fly.io: `https://seva-messenger.fly.dev`
- Heroku: `https://your-app-name.herokuapp.com`

## Тестирование голосовых звонков

1. Откройте ссылку в двух разных браузерах или устройствах
2. Зарегистрируйте двух пользователей
3. Создайте чат между ними
4. Нажмите кнопку телефона для звонка
5. Примите звонок на втором устройстве

Готово! Теперь ваш мессенджер работает в интернете и доступен всем!
