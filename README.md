# ForgeCloud AI — Roblox Builder (Z.ai + Open Cloud)

Готовый сайт на Node.js 20+ **без npm-зависимостей**. Он предназначен для **одного владельца** и собственного Roblox-плейса.

## Возможности

- Чат с Z.ai, по умолчанию бесплатная модель `glm-4.7-flash`.
- Генерация Luau-кода для объектов, карт, GUI и систем игры.
- Обзор дерева объектов Roblox Open Cloud (вложенные папки открываются по нажатию).
- Чтение и редактирование `Script`, `LocalScript`, `ModuleScript` с проверкой версии исходного текста.
- Создание объектов через облачную **Luau Execution Session Task** с явным подтверждением владельца и `AssetService:SavePlaceAsync({SaveWithoutPublish=true})`.
- Скачивание и копирование Luau, мобильная вёрстка, чат с крестиком.
- Парольный вход (HTTP-only cookie), ключи только на сервере.

**Ограничения:** этот проект не является полноценным автономным многошаговым агентом. Каждый запрос генерирует один код, а владелец проверяет и вручную подтверждает его исполнение. Работа Roblox API и генерация модели зависят от разрешений, сетевых ограничений и состояния сервисов. Код не тестировался с настоящим ключом пользователя. Для Studio Lite внутри чужого плейса это **внешний** сайт: он работает с твоей опубликованной Roblox-игрой, а не изменяет чужой редактор Studio Lite.

## 1. Бесплатный ключ ИИ Z.ai (не Gemini, Cerebras и OpenRouter)

1. Открой https://z.ai/model-api и зарегистрируйся, если сервис доступен по правилам твоего региона. Несовершеннолетним следует ознакомиться с условиями сервиса с родителем или опекуном.
2. Открой https://z.ai/manage-apikey/apikey-list и создай **Standard API Key** для общего API (не ключ платного Coding Plan).
3. Модель `glm-4.7-flash` официально имеет цену **Free** на входные и выходные токены: https://docs.z.ai/guides/overview/pricing. Можно заменить на `glm-4.5-flash` (тоже Free). Не переключайся на платные модели.
4. API-ключ вводится в **Render Environment**, НЕ в HTML/JS. Сервис может ограничивать доступ и частоту запросов по региону и аккаунту.

## 2. Ключ Roblox Open Cloud

1. В Roblox Creator Dashboard сначала опубликуй свою игру (Universe) и плейс.
2. Открой https://create.roblox.com/dashboard/credentials → API Keys → Create.
3. Выбери **только собственную игру** и необходимые scopes:
   - Для API System `universe-place-instances`: **Read** — просмотр дерева и скриптов; **Write** — редактирование существующих скриптов.
   - В другом интерфейсе эти права могут быть показаны как `universe.place.instance:read` / `universe.place.instance:write`.
   - `universe.place.luau-execution-session:write` и `:read` — создание объектов через Luau Execution и получение логов.
4. Для Engine Instance API Roblox требует включённую **collaborative session**; если чтение дерева не работает, проверь настройку совместного редактирования у плейса.
5. Сохрани key, узнай `Universe ID` и `Place ID` на странице игры в Creator Dashboard.
6. **Не давай дополнительные права для управления игроками, экономикой или публикации**, если не нужны. Для облачного сохранения черновика у плейса также должен быть включён доступ к `SavePlaceAsync`, если Roblox его требует.
7. Ключи храни в секретных env Render. Если ключ случайно опубликован в GitHub — немедленно отзови и создай новый.

Документация: https://create.roblox.com/docs/cloud/guides/instance и https://create.roblox.com/docs/cloud/reference/features/luau-execution

## 3. Render + GitHub

1. Создай новый **приватный** репозиторий GitHub `forgecloud-ai`.
2. Загрузи туда файлы из ZIP **без дополнительной внешней папки**: `server.js`, `package.json`, `public/`, `render.yaml`, `README.md`.
3. На Render выбери **New → Web Service** и подключи репозиторий.
4. Environment: **Node**; Build command: `echo ready`; Start command: `node server.js`; Free plan, если доступен.
5. Открой **Environment → Add Environment Variable** и добавь:

| Name | Value |
|---|---|
| `APP_PASSWORD` | твой сложный уникальный пароль от 12 символов |
| `ZAI_API_KEY` | твой Standard API Key Z.ai (не публиковать) |
| `ZAI_MODEL` | `glm-4.7-flash` |
| `ROBLOX_API_KEY` | ключ Open Cloud Roblox (не публиковать) |
| `ROBLOX_UNIVERSE_ID` | числовой Universe ID |
| `ROBLOX_PLACE_ID` | числовой Place ID |
| `NODE_ENV` | `production` |

6. Нажми **Deploy**. Открой адрес `https://твоё-имя.onrender.com` и войди через `APP_PASSWORD`.

Если используешь **New → Blueprint**, в архиве уже лежит `render.yaml`, который запросит нужные секреты.

## 4. Как создавать объекты

1. Выбери «✦ Создать объекты».
2. Введи «Создай парк с 10 деревьями, дорожками и фонарями».
3. Проверь код в правом редакторе и при необходимости исправь.
4. Нажми «Сохранить в Roblox» и введи слово `СОХРАНИТЬ`.
5. Сервер отправит Luau Execution Task в Roblox. В конце задачи выполняется `SavePlaceAsync({SaveWithoutPublish=true})`.
6. Посмотри лог и проверь созданный черновик в Creator Dashboard. **Не путай сохранение черновика с публикацией для всех игроков.**

**Если SavePlaceAsync не поддерживается для твоего плейса**, Roblox вернёт ошибку, и сайт её отобразит; можно скопировать Luau и применить через официальную Studio.

## 5. Как изменять существующий скрипт

1. В панели Explorer нажми на `Script`, `LocalScript` или `ModuleScript` (можно разворачивать папки).
2. Откроется его исходный код и активируется «Изменить скрипт».
3. Опиши изменение. Сайт пришлёт текущий Source в ИИ (не делай этого для кода с секретами!) и получит новый полный Source.
4. Просмотри результат, нажми «Записать в Script», введи `ЗАМЕНИТЬ`.
5. Если скрипт менялся с момента чтения, сервер откажется его перезаписывать.

## Безопасность

- **Не вставляй ключи в поля чата** — весь текст чата передаётся поставщику ИИ.
- **Не публикуй код сайта с включёнными ключами**. Никаких ключей в `public/`.
- Не давай доступ к сайту другим пользователям: здесь нет разграничения ролей, это вариант для одного владельца.
- Генерируемый Luau может содержать ошибки и непредвиденные действия. **Просматривай его и делай резервную копию**, прежде чем нажимать «Применить».
- Z.ai может менять лимиты, доступность и условия бесплатной модели.

## Локальный запуск

Node.js 20+:

```bash
# Linux/macOS
APP_PASSWORD='my-strong-password-here' ZAI_API_KEY='your_key' node server.js
```

Для Windows CMD сначала задай переменные через `set APP_PASSWORD=...`, `set ZAI_API_KEY=...`, затем `node server.js`. Открой http://localhost:3000.

## Если не работает

- **`401/403` Roblox** — ключ не выдан для нужного Universe или scopes не совпадают.
- **`429` Z.ai** — исчерпан дневной лимит или превышено количество запросов в минуту.
- **`SavePlaceAsync` error** — проверь разрешения и настройку плейса; проверь логи Luau задачи.
- **`Script.Source` не обновился** — закрой открытый редактор этого скрипта в обычной Studio, если есть активная сессия.
- **Studio Lite** — некоторые проекты из Studio Lite могут требовать сначала обычной публикации плейса и могут не допускать запись из Open Cloud; это зависит от конкретного опыта и прав владельца.

## API-источники

- https://docs.z.ai/guides/overview/pricing
- https://chat.z.ai/legal-agreement/terms-of-service
- https://create.roblox.com/docs/cloud/guides/instance
- https://create.roblox.com/docs/cloud/reference/features/luau-execution
- https://github.com/Roblox/place-ci-cd-demo
