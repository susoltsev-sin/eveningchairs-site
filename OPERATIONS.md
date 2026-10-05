# eveningchairs.com — как устроен и как работать с сайтом

Репозиторий публичный: здесь только техника. Бизнес-решения, цифры, контакты — в документах проекта на claude.ai.

## Где что лежит
- **Этот репозиторий (`~/eveningchairs/site`) — единственный источник сайта.** Папка уровнем выше (`~/eveningchairs/`) — старая рабочая копия, не править.
- Страницы: `/en/`, `/ru/` (лендинг), `/en/b2ai/`, `/ru/b2ai/` (статья-определение), `404.html`.
- `index.html` в корне — языковой роутер без контента (ru/kk или регион RU/KZ → `/ru/`, остальные → `/en/`, UTM сохраняются). `ru.html` — старый адрес, редиректит на `/ru/`.
- Общие файлы: `styles.css`, `script.js` (форма, аналитика, переключатель языка).
- `tools/` — скрипты сборки, `.github/workflows/pages.yml` — деплой. На сайт не публикуются.

## Как публикуется
`git push` в `main` → GitHub Actions (вкладка Actions → «Deploy site»):
1. собирает `sitemap.xml` из самих страниц;
2. публикует сайт на GitHub Pages;
3. отправляет в IndexNow (Bing, Яндекс и др.) только страницы, изменённые в этом пуше.

Руками ничего не регистрируем. Отправить все страницы заново: Actions → Deploy site → Run workflow.

## Как добавить страницу
1. Папка `/<язык>/<slug>/index.html`, по образцу `/en/b2ai/`. Все пути абсолютные (`/styles.css`).
2. В `<head>` обязательно:
   - `<title>` до ~60 символов;
   - `<meta name="description">` до ~155 символов;
   - `<link rel="canonical">` на саму себя (полный URL со слэшем на конце);
   - `<link rel="alternate" hreflang="...">` на все языковые версии + `x-default` на EN.
3. Поставь на неё ссылку хотя бы с одной существующей страницы (футер, текст).
4. Push. В sitemap и IndexNow она попадёт сама.

Страница не должна индексироваться → `<meta name="robots" content="noindex">`, и сборка её пропустит.

## Визуальные правила
Только контент. Без новых цветов, шрифтов и компонентов; новые CSS-классы — только дописывать в конец `styles.css`. Полные правила — документ проекта «visual-style».

## Форма заявок
- Пишет в Google Sheet через Apps Script (`SHEET_ENDPOINT` в `script.js`) и шлёт событие `waitlist_signup` в PostHog.
- Обязателен только контакт (email или Telegram @username от 5 символов). Остальные поля необязательные.
- Значения `needs` = колонки таблицы: `datasets`, `business_data`, `llm_api`, `search_scraping`, `speech_translation`, `video_and_image_generation`, `gpu_inference`, `gpu_training`, `vms`, `other`. Новый пункт → новое уникальное значение, и его же добавить в промпт для агента.

## Аналитика (PostHog, EU)
- События:
  - навигация по странице: `section_view`, `section_read`, `scroll_depth`, `case_view`, `how_step`, `page_exit`;
  - форма: `form_start`, `form_error`, `form_mode`, `prompt_copy`, `waitlist_signup`, `waitlist_signup_write_failed`;
  - клики: `cta_click`, `telegram_click`, `lang_switch`.
- Свои визиты: один раз открыть `https://eveningchairs.com/en/?me=1` в каждом своём браузере (`?me=0` — вернуть).
- Битые входящие ссылки: просмотры страницы с title «Page not found».
- Боты: исключать города Ashburn и Council Bluffs (дата-центры). По Linux не фильтровать: целевые разработчики на нём.
- UTM: визитки — `utm_source=db26&utm_medium=card`; LinkedIn — `utm_source=linkedin&utm_medium=social`.

## Поисковики
- Google Search Console — доменный ресурс, sitemap отправлен.
- Bing Webmaster Tools — импорт из GSC; sitemap отправлять вручную (импорт его не переносит).
- Яндекс Вебмастер — не подключён.
- IndexNow: ключ — файл `39e5f19b1c4536c4c712fdb6aa6ecab5.txt` в корне. Не удалять и не переименовывать: без него Bing отклоняет запросы (403).

## Настройки GitHub, которые нельзя сбивать
- Settings → Pages → Source: **GitHub Actions**; Custom domain `eveningchairs.com`; Enforce HTTPS — включено.
- DNS домена — в Hostinger.
