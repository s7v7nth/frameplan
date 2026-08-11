# FramePlan

Веб-редактор планировок каркасного дома с автогенерацией каркаса по **СП 31-105-2002**, раскроем, сметой и калькулятором теплопотерь.

**Репозиторий:** https://github.com/s7v7nth/frameplan  
**Демо:** https://s7v7nth.github.io/frameplan/

## Открыть в Cursor (как обычный проект)

Этот репозиторий — отдельный GitHub-проект. Чтобы он появился в Cursor наравне с остальными:

1. Cursor Desktop → **Clone repo** / **Open folder** → `https://github.com/s7v7nth/frameplan`
2. Либо Cloud Agents → новый агент **из репозитория** `s7v7nth/frameplan` (не «без репо»).

Конфиг Cloud Agent: [`.cursor/environment.json`](.cursor/environment.json) (`npm ci` + dev-сервер).

## Возможности

- 2D-планировка: стены, окна, двери, мебель
- 1 или 2 этажа, типы кровли
- Автоматический каркас, проекции, раскрой, смета, теплопотери

## Запуск

```bash
npm install
npm run dev
```

```bash
npm run build
npm run smoke
```

## CI/CD

Пуш в `main` → GitHub Actions → GitHub Pages: https://s7v7nth.github.io/frameplan/

## Примечание

Расчёт каркаса — инженерная модель по СП 31-105-2002, не замена рабочей документации конструктора.
