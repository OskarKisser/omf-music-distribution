# 🌐 Web Authentication Guide

## Как войти через веб-версию

### 1️⃣ **Открыть страницу логина**

Перейдите на: **http://localhost:3000/login**

(В production будет ваш реальный домен, например: `https://your-domain.com/login`)

### 2️⃣ **Создать новый аккаунт**

1. На странице `/login` нажмите **"Зарегистрироваться"**
2. Введите email и пароль (минимум 6 символов)
3. Нажмите **"Зарегистрироваться"**
4. После успешной регистрации вы будете перенаправлены на `/library`

> **Примечание**: Supabase Auth автоматически создаст:
> - Запись в `auth.users`
> - Запись в `public.users` (через триггер)
> - UUID который связывает Telegram и Web аккаунты

### 3️⃣ **Войти в существующий аккаунт**

1. На странице `/login` введите email и пароль
2. Нажмите **"Войти"**
3. Вы будете перенаправлены на `/library`

### 4️⃣ **Выйти из аккаунта**

1. Перейдите в **Настройки** (`/settings`)
2. Внизу страницы нажмите **"Выйти из аккаунта"**
3. Вы будете перенаправлены на `/login`

---

## 🔗 Hybrid Authentication

### Как это работает

1. **Telegram пользователь** (через Mini App):
   - Входит через `initData`
   - Система автоматически создает/находит UUID в `public.users`
   - Работает через заголовок `x-telegram-user-id`

2. **Web пользователь** (через браузер):
   - Входит через email/password (Supabase Auth)
   - Получает JWT токен
   - Работает через `auth.uid()`

3. **Один и тот же пользователь**:
   - Оба метода авторизации ссылаются на **один UUID** в `public.users`
   - Можно войти через Telegram, потом добавить email/password
   - Или наоборот - создать веб-аккаунт, потом привязать Telegram

### API Endpoints для линковки

- **POST /api/auth/link-telegram** - Привязать Telegram к email аккаунту
- **POST /api/auth/link-email** - Привязать email к Telegram аккаунту
- **GET /api/auth/profile** - Получить профиль пользователя
- **GET /api/auth/check-link-status** - Проверить статус линковки

---

## 🧪 Тестирование

### Scenario 1: Новый веб-пользователь

```bash
# 1. Откройте браузер (НЕ в Telegram)
open http://localhost:3000/login

# 2. Зарегистрируйтесь:
# Email: test@example.com
# Password: test123456

# 3. После регистрации проверьте:
# - Вы на странице /library
# - Можете создавать релизы
# - В настройках есть кнопка "Выйти"
```

### Scenario 2: Проверка базы данных

```sql
-- Проверить созданного пользователя
SELECT 
  id,
  email,
  telegram_id,
  display_name,
  created_at
FROM public.users;

-- Проверить auth.users
SELECT 
  id,
  email,
  email_confirmed_at,
  created_at
FROM auth.users;
```

### Scenario 3: Существующий Telegram пользователь

```bash
# 1. Войдите через Telegram Mini App
# 2. В БД будет создан user с telegram_id

# 3. Потом через API можно привязать email:
POST /api/auth/link-email
{
  "email": "telegram-user@example.com",
  "password": "secure123"
}

# Теперь этот пользователь может войти и через веб!
```

---

## 🔒 Безопасность

- **Email confirmation**: По умолчанию включено в Supabase
- **Password policy**: Минимум 6 символов (настраивается в Supabase Dashboard)
- **RLS policies**: Работают для обоих типов авторизации
- **JWT токены**: Автоматически обновляются Supabase клиентом
- **Logout**: Полностью очищает сессию из localStorage

---

## 📊 Текущее состояние

### Что работает:

✅ Страница `/login` - вход и регистрация
✅ Supabase Auth email/password
✅ Автоматическое создание профиля в `public.users`
✅ Кнопка "Выйти" в настройках
✅ Защита страниц (редирект на /login)
✅ Hybrid auth backend (API endpoints)

### Что можно добавить:

- [ ] Подтверждение email (сейчас автоматически подтверждается)
- [ ] Восстановление пароля
- [ ] UI для линковки Telegram ↔ Email
- [ ] Профиль пользователя с информацией об аккаунте
- [ ] OAuth провайдеры (Google, GitHub)

---

## 🚀 Production Checklist

Перед деплоем на production:

1. [ ] Настроить email templates в Supabase Dashboard
2. [ ] Включить email confirmation
3. [ ] Настроить redirect URLs в Supabase
4. [ ] Добавить rate limiting на /api/auth/*
5. [ ] Настроить CORS
6. [ ] Проверить RLS policies
7. [ ] Настроить webhook для email events

---

**Готово! Теперь можно входить через веб-браузер.** 🎉
