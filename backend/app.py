"""Read-only monitor API; backend lifespan owns the paper tick loop."""
import asyncio
import json
import os
import secrets
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from decimal import Decimal as D, ROUND_HALF_UP
from pathlib import Path
from fastapi import FastAPI, Header, HTTPException
from fastapi.staticfiles import StaticFiles
from jsonschema import Draft202012Validator
import live_orders
import settings_store
from broker import MarketDataError
from engine import BondSpread, Config, Engine, Grid, MeanReversion, RiskPolicy, Stop, Tick, Trend
from tinvest import Observer
from live import LiveAccount, read_attempts, record_attempt

engine = Engine(RiskPolicy(), {'SBER': [Grid(Config('grid-sber', 'Grid', frozenset({'FLAT'})))]})
active_strategies = {'grid-sber': {'id': 'grid-sber', 'kind': 'Grid', 'instrument_ids': ['SBER'],
                                    'priority': 100, 'enabled': True, 'built_in': True}}

# Same flattening pattern as backend/certs -> /app/certs in the Docker image;
# falls back to the repo-root layout used when running from a source checkout.
def _schemas_dir():
    here = Path(__file__).resolve().parent
    for candidate in (here / 'schemas', here.parent / 'schemas'):
        if candidate.is_dir(): return candidate
    raise FileNotFoundError('schemas directory not found')

_strategy_schema = json.loads((_schemas_dir() / 'strategy.schema.json').read_text(encoding='utf-8'))
_strategy_validator = Draft202012Validator(_strategy_schema)
SUPPORTED_PLUGINS = {'Grid': Grid, 'Trend': Trend, 'MeanReversion': MeanReversion, 'BondSpread': BondSpread}

def detach_strategy(strategy_id):
    for ticker in list(engine.plugins):
        engine.plugins[ticker] = [p for p in engine.plugins[ticker] if p.config.id != strategy_id]
        if not engine.plugins[ticker]: del engine.plugins[ticker]
    active_strategies.pop(strategy_id, None)

def activate_strategy(draft):
    errors = sorted(_strategy_validator.iter_errors(draft), key=lambda e: list(e.path))
    if errors:
        raise HTTPException(422, f'Профиль не прошёл проверку схемы ({errors[0].json_path}): {errors[0].message}')
    kind = draft['kind']
    plugin_cls = SUPPORTED_PLUGINS.get(kind)
    if plugin_cls is None:
        raise HTTPException(501, f'Класс стратегии {kind} пока не исполняется paper-движком '
                                  '(запускаются только Grid, Trend, MeanReversion и BondSpread)')
    try:
        s = draft['stop']
        stop = Stop(mode=s['mode'], value=D(str(s['value'])),
                    initial_pct=D(str(s.get('initial_pct', 2))), activation_pct=D(str(s.get('activation_pct', 1))),
                    breakeven_pct=D(str(s['breakeven_pct'])) if s.get('breakeven_pct') is not None else None,
                    yield_bps=D(str(s['yield_bps'])) if s.get('yield_bps') is not None else None)
        tp = tuple((D(str(x['target_pct'])), D(str(x['share_pct']))) for x in draft['tp'])
        config = Config(id=draft['id'], kind=kind, regimes=frozenset(draft['regimes']),
                         priority=int(draft['priority']), lots=int(draft['lots']), max_lots=int(draft['max_lots']),
                         short=bool(draft['short']), stop=stop, tp=tp, params=draft.get('params', {}))
    except (KeyError, ValueError, TypeError, ArithmeticError) as exc:
        raise HTTPException(422, f'Некорректный профиль стратегии: {exc}') from None
    detach_strategy(draft['id'])
    plugin = plugin_cls(config)
    tickers = sorted({ident.split(':')[0] for ident in draft['instrument_ids']})
    for ticker in tickers:
        engine.plugins.setdefault(ticker, []).append(plugin)
    active_strategies[draft['id']] = {'id': draft['id'], 'kind': kind, 'instrument_ids': tickers,
                                       'priority': config.priority, 'enabled': True}
    return active_strategies[draft['id']]

def health_score(state, policy):
    # A read-only discipline gauge for the UI; never used by RiskEngine to gate orders.
    day_loss = max(D('0'), state.day_start - state.equity)
    day_used = min(D('1'), day_loss / policy.daily_loss_rub)
    week_dd = max(D('0'), state.week_peak - state.equity)
    week_budget = state.week_peak * policy.weekly_drawdown_pct / D('100')
    week_used = min(D('1'), week_dd / week_budget) if week_budget > 0 else D('0')
    pos_used = min(D('1'), D(len(state.positions)) / D(policy.max_positions))
    turnover_used = min(D('1'), state.turnover / policy.daily_turnover_rub)
    weighted = (D('35') * (D('1') - day_used) + D('25') * (D('1') - week_used)
                + D('15') * (D('1') - pos_used) + D('15') * (D('1') - turnover_used)
                + D('10') * (D('0') if state.day_stopped else D('1')))
    score = int(weighted.to_integral_value(rounding=ROUND_HALF_UP))
    score = max(0, min(100, score))
    if state.day_stopped:
        label, note = 'Дневной стоп сработал', 'Новые входы запрещены до следующей сессии'
    elif score >= 85:
        label, note = 'Под контролем', 'Лимиты риска использованы незначительно'
    elif score >= 60:
        label, note = 'Повышенное внимание', 'Часть дневных или недельных лимитов уже выбрана'
    else:
        label, note = 'Лимиты под давлением', 'Существенная часть риск-бюджета уже израсходована'
    pct = lambda v: str((v * 100).quantize(D('0.1')))
    return {'score': score, 'label': label, 'note': note,
            'daily_loss_used_pct': pct(day_used), 'weekly_drawdown_used_pct': pct(week_used),
            'positions_used_pct': pct(pos_used), 'turnover_used_pct': pct(turnover_used)}

async def loop():
    n = 0
    while True:
        regime, price = [('FLAT', '98'), ('UPTREND', '101'), ('SHOCK', '95'), ('LOW_LIQUIDITY', '95')][n % 4]
        px = D(price)
        now = datetime.now(timezone.utc)
        for ticker in list(engine.plugins):
            engine.tick(Tick(ticker, regime, px, px, px + D('.01'), now, lot_size=10))
        n += 1
        await asyncio.sleep(2)

@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(loop())
    observer = Observer()
    app.state.observer = observer
    market_task = asyncio.create_task(observer.run())
    app.state.market_task = market_task
    app.state.live_account = LiveAccount()
    async def _startup_reconcile():
        # Best-effort: if the process restarted with SENT proposals still
        # outstanding, find out their real state before anyone can act on
        # them again. Never blocks startup and never places/cancels orders.
        try:
            await app.state.live_account.summary()
            if app.state.live_account.account_id:
                await live_orders.reconcile(app.state.live_account.account_id, _live_token())
        except Exception:
            pass
    asyncio.create_task(_startup_reconcile())
    try:
        yield
    finally:
        task.cancel()
        market_task.cancel()
        with suppress(asyncio.CancelledError): await task
        with suppress(asyncio.CancelledError): await market_task
        await app.state.live_account.aclose()

app = FastAPI(title='MOEX Multi-strategy Paper Reference', lifespan=lifespan)

async def reload_market_data():
    # Applies a settings_store credential change without a server restart:
    # tear down the running observer/live-account and start fresh ones, which
    # re-read settings_store on construction.
    app.state.market_task.cancel()
    with suppress(asyncio.CancelledError): await app.state.market_task
    app.state.observer = Observer()
    app.state.market_task = asyncio.create_task(app.state.observer.run())
    await app.state.live_account.aclose()
    app.state.live_account = LiveAccount()

def require_admin(authorization: str | None):
    expected = os.getenv('ADMIN_PASSWORD', '')
    if not expected:
        raise HTTPException(503, 'ADMIN_PASSWORD не задан на сервере; форма настроек отключена')
    given = (authorization or '').removeprefix('Bearer ').strip()
    if not given or not secrets.compare_digest(given, expected):
        raise HTTPException(401, 'Неверный пароль администратора')

@app.get('/api/settings/status')
async def settings_status():
    return {'admin_enabled': bool(os.getenv('ADMIN_PASSWORD')),
            'token_configured': app.state.observer.api is not None,
            'max_instruments': app.state.observer.max_instruments}

@app.post('/api/settings/t-invest')
async def update_t_invest_settings(payload: dict, authorization: str | None = Header(None)):
    require_admin(authorization)
    token = str(payload.get('token', '')).strip()
    if token:
        settings_store.set('T_INVEST_TOKEN', token)
    max_instruments = payload.get('max_instruments')
    if max_instruments:
        try: settings_store.set('T_INVEST_MAX_INSTRUMENTS', str(max(1, min(300, int(max_instruments)))))
        except (ValueError, TypeError): raise HTTPException(422, 'max_instruments должен быть числом от 1 до 300')
    await reload_market_data()
    return {'reloaded': True, 'token_configured': app.state.observer.api is not None}

@app.get('/api/health')
async def health():
    observer = app.state.observer
    return {'status':'ok' if not app.state.market_task.done() else 'degraded',
            'market_data':observer.status, 'last_success':observer.updated,
            'execution':'paper-only', 'live_enabled':False}

@app.get('/api/paper/snapshot')
async def snapshot():
    s = engine.state
    return {'mode': 'PAPER', 'equity_rub': str(s.equity), 'cash_rub': str(s.cash),
            'day_pnl_rub': str(s.equity - s.day_start), 'day_stopped': s.day_stopped,
            'daily_limit_rub': str(engine.risk.policy.daily_loss_rub),
            'health': health_score(s, engine.risk.policy),
            'positions': {k: {'lots': p.lots, 'strategy': p.config.id, 'entry': str(p.entry),
                'pnl_rub': str((engine.marks[k].unit(engine.marks[k].bid if p.lots > 0 else engine.marks[k].ask) - p.entry_dirty) * p.lots * engine.marks[k].lot_size)} for k, p in s.positions.items()},
            'marks': {k: {'price': str(t.price), 'kind': t.kind, 'regime': t.regime, 'lot_size': t.lot_size,
                'nominal': str(t.nominal), 'nkd': str(t.nkd), 'time': t.time.isoformat()} for k, t in engine.marks.items()},
            'orders': [{'id': o.id, 'ticker': o.intent.ticker, 'type': o.order_type, 'lots': o.intent.lots,
                'price': str(o.intent.price), 'strategy': o.intent.config.id} for o in s.pending.values()]}

@app.get('/api/paper/journal')
async def journal(): return engine.state.journal[-500:]

@app.get('/api/paper/strategies')
async def list_strategies(): return list(active_strategies.values())

@app.post('/api/paper/strategies', status_code=201)
async def create_strategy(draft: dict): return activate_strategy(draft)

@app.delete('/api/paper/strategies/{strategy_id}')
async def remove_strategy(strategy_id: str):
    if strategy_id not in active_strategies:
        raise HTTPException(404, 'Стратегия не найдена')
    if active_strategies[strategy_id].get('built_in'):
        raise HTTPException(403, 'Встроенную стратегию по умолчанию нельзя удалить')
    detach_strategy(strategy_id)
    return {'removed': strategy_id}

@app.get('/api/t-invest/snapshot')
async def market_snapshot(): return app.state.observer.snapshot()

@app.get('/api/t-invest/journal')
async def market_journal(): return app.state.observer.journal

@app.get('/api/live/account')
async def live_account_summary(): return await app.state.live_account.summary()

@app.get('/api/live/audit')
async def live_audit(): return read_attempts()

@app.post('/api/live/arm')
async def live_arm_status():
    # Public, unauthenticated endpoint: it can only ever report whether an
    # admin has armed the account elsewhere — it cannot arm anything itself.
    armed = live_orders.is_armed()
    detail = ('Live взведён администратором: сигналы стратегий создают предложения на подтверждение, '
               'но заявка уходит брокеру только после ручного одобрения.' if armed else
               'Live не взведён. Включить может только администратор через защищённые настройки — '
               'из этой кнопки самостоятельно включить нельзя.')
    record_attempt('armed' if armed else 'rejected', detail)
    if not armed:
        raise HTTPException(409, detail)
    return {'armed': True, 'detail': detail}

def _live_token():
    return settings_store.get('T_INVEST_TOKEN') or os.getenv('T_INVEST_TOKEN', '')

async def _resolve_account_id():
    if app.state.live_account.account_id is None:
        await app.state.live_account.summary()
    return app.state.live_account.account_id

@app.get('/api/live/armed')
async def live_armed_status(): return {'armed': live_orders.is_armed()}

@app.post('/api/live/armed')
async def set_live_armed(payload: dict, authorization: str | None = Header(None)):
    require_admin(authorization)
    live_orders.set_armed(bool(payload.get('armed')))
    record_attempt('armed' if live_orders.is_armed() else 'disarmed', 'Изменено администратором')
    return {'armed': live_orders.is_armed()}

@app.get('/api/live/orders')
async def list_live_orders(authorization: str | None = Header(None)):
    require_admin(authorization)
    return live_orders.list_proposals()

@app.post('/api/live/orders/{proposal_id}/approve')
async def approve_live_order(proposal_id: str, authorization: str | None = Header(None)):
    require_admin(authorization)
    account_id = await _resolve_account_id()
    if not account_id:
        raise HTTPException(409, 'Не удалось определить account_id — проверьте счёт в диалоге Live')
    try:
        result = await live_orders.approve_proposal(proposal_id, account_id, _live_token())
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    except MarketDataError as exc:
        raise HTTPException(502, str(exc)) from None
    record_attempt('order_sent', f'{proposal_id} -> {result.get("orderId", "")}')
    return result

@app.post('/api/live/orders/{proposal_id}/reject')
async def reject_live_order(proposal_id: str, authorization: str | None = Header(None)):
    require_admin(authorization)
    try:
        live_orders.reject_proposal(proposal_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    return {'rejected': proposal_id}

@app.post('/api/live/kill')
async def live_kill_switch(authorization: str | None = Header(None)):
    require_admin(authorization)
    account_id = await _resolve_account_id()
    result = await live_orders.kill_switch(account_id, _live_token())
    record_attempt('kill_switch', json.dumps(result, ensure_ascii=False))
    return result

@app.post('/api/live/reconcile')
async def live_reconcile(authorization: str | None = Header(None)):
    require_admin(authorization)
    account_id = await _resolve_account_id()
    if not account_id:
        raise HTTPException(409, 'Не удалось определить account_id — проверьте счёт в диалоге Live')
    return await live_orders.reconcile(account_id, _live_token())

_static_dir = os.path.join(os.path.dirname(__file__), 'static')
if os.path.isdir(_static_dir):
    app.mount('/', StaticFiles(directory=_static_dir, html=True), name='static')
