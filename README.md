# MOEX Multi-strategy terminal

Проект терминала и исполняемый backend paper-пример. Монитор получает данные; торговые решения и отправка заявок принадлежат backend. Подготовлено по порядку задания: [матрица → схемы → вайрфреймы → код](docs/design.md).

## Состав

- `schemas/strategy.schema.json`: JSON Schema 2020-12 для всех восьми классов, включая Event и RiskOff как надстройки.
- `schemas/risk-policy.schema.json`: общая обязательная политика риска.
- `docs/design.md`: матрица режимов, архитектура, UI, дизайн-токены, Live-протокол, особенности облигаций.
- `backend/engine.py`: Decimal-расчёты, RiskEngine, интерфейс Strategy, четыре базовых плагина, paper-брокер и mock ticks.
- `backend/test_engine.py`: тесты риск-инвариантов и облигационного P/L.
- `backend/app.py`: FastAPI с backend-owned такт-циклом и read-only монитором.

## Запуск

Python 3.11+; команды из корня репозитория:

```powershell
python -m unittest discover -s backend -v
python backend/engine.py
python -m pip install -r backend/requirements.txt
python -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000 --workers 1
```

При установленном `uv`, если Python отсутствует в PATH:

```powershell
uv run --no-project python -m unittest discover -s backend -v
uv run --no-project --with fastapi --with uvicorn python -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000 --workers 1
```

API: `GET /api/paper/snapshot`, `GET /api/paper/journal`, Swagger `/docs`.
`POST /api/live/arm` всегда возвращает 409: реального адаптера в примере нет.

Проверка схем и API:

```powershell
uv run --no-project --with fastapi --with httpx --with jsonschema python backend/check_contracts.py
```

Проверено: 18 unit-тестов; JSON Schema и примеры; запрет Grid в UPTREND на уровне схемы; запуск/остановка FastAPI, read-only API и отказ Live activation.

## Границы реализации

Это проект и исполняемые заглушки из пункта 4 задания, не готовая система для реальных денег. React/TypeScript/Tailwind интерфейс описан вайрфреймами и контрактами; frontend-приложение здесь не реализовано. Полные параметры всех стратегий представлены в схемах; четыре Python-плагина демонстрируют базовые сигналы. Breakout и Momentum не исполняются этим примером. Календарный запрет и Risk-off исполняются в RiskEngine.

PaperBroker исполняет заявку целиком при пересечении лимита, немедленно подтверждает отмену и не моделирует очередь, частичные сделки, биржевые ценовые коридоры, задержку или маржинальное обеспечение. Grid исполняет один уровень без дозаполнения позиции; пирамидинг отключён. Уровни N-bar/MA/ATR/ADX/RSI и облигационные метрики приходят с mock tick, а не вычисляются из истории. Конструкторская схема является контрактом полной системы, а не обещанием поддержки всех параметров демо-движком.

Состояние демо хранится в памяти; перезапуск сбрасывает портфель. Live должен сохранять дневной стоп, резервы, ownership и журнал транзакционно и восстанавливаться через сверку с брокером; архитектура описана в проекте. Купон и амортизация учитываются функцией total-return P/L; демо-цикл не имитирует календарь выплат. Недельная просадка в демо отсчитывается от переданного `week_peak`; недельный календарный rollover не имитируется.

Не является индивидуальной инвестиционной рекомендацией. Торговля связана с риском потери капитала.
