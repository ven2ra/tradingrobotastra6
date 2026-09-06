"""Phase 2: human-approved real order placement.

Every call to OrdersService in this codebase lives in this one file, behind
approve_proposal(). Nothing here ever runs automatically: tinvest.py only
calls create_proposal() (a local DB write) when a strategy signal fires
against real market data and the account is armed; the order itself is
placed only when a human calls approve_proposal() through the API, after
looking at the proposal. Rejecting or simply ignoring a proposal never
touches the broker.
"""
import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
from pathlib import Path

import httpx
import settings_store
from broker import BASE, MarketDataError, _ssl_context

ALLOWED_METHODS = {
    ('OrdersService', 'PostOrder'),
    ('OrdersService', 'GetOrders'),
    ('OrdersService', 'CancelOrder'),
}
DB = Path(os.getenv('LIVE_ORDERS_DB', str(Path(__file__).resolve().parent / 'data' / 'live_orders.db')))
PROPOSAL_TTL_SECONDS = 180  # A signal's price is stale well before a human could review it after that.
COLUMNS = ('id', 'created_at', 'ticker', 'instrument_uid', 'side', 'lots', 'price',
           'order_type', 'rule', 'account_id', 'status', 'broker_order_id', 'error', 'decided_at')

def _conn():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.execute('CREATE TABLE IF NOT EXISTS proposals ('
                'id TEXT PRIMARY KEY, created_at TEXT NOT NULL, ticker TEXT NOT NULL, '
                'instrument_uid TEXT NOT NULL, side TEXT NOT NULL, lots INTEGER NOT NULL, '
                'price TEXT NOT NULL, order_type TEXT NOT NULL, rule TEXT NOT NULL, '
                'account_id TEXT, status TEXT NOT NULL, broker_order_id TEXT, error TEXT, decided_at TEXT)')
    return con

def is_armed():
    return settings_store.get('LIVE_ARMED') == '1'

def set_armed(value):
    settings_store.set('LIVE_ARMED', '1' if value else '0')

def _row(cur_row):
    return dict(zip(COLUMNS, cur_row))

def _expire_stale(con):
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=PROPOSAL_TTL_SECONDS)).isoformat()
    con.execute("UPDATE proposals SET status='EXPIRED', decided_at=? WHERE status='PENDING' AND created_at<?",
                (datetime.now(timezone.utc).isoformat(), cutoff))
    con.commit()

def create_proposal(ticker, instrument_uid, side, lots, price, order_type, rule):
    if not is_armed(): return None
    con = _conn()
    _expire_stale(con)
    existing = con.execute("SELECT id FROM proposals WHERE ticker=? AND rule=? AND status='PENDING'",
                            (ticker, rule)).fetchone()
    if existing:
        con.close()
        return None  # Don't flood the approval queue while the same signal keeps firing.
    pid = str(uuid.uuid4())
    con.execute('INSERT INTO proposals (id, created_at, ticker, instrument_uid, side, lots, price, '
                'order_type, rule, account_id, status, broker_order_id, error, decided_at) '
                'VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,NULL,NULL)',
                (pid, datetime.now(timezone.utc).isoformat(), ticker, instrument_uid, side, lots,
                 str(price), order_type, rule, 'PENDING'))
    con.commit()
    con.close()
    return pid

def list_proposals(limit=100):
    con = _conn()
    _expire_stale(con)
    rows = con.execute('SELECT * FROM proposals ORDER BY created_at DESC LIMIT ?', (limit,)).fetchall()
    con.close()
    return [_row(r) for r in rows]

def get_proposal(pid):
    con = _conn()
    row = con.execute('SELECT * FROM proposals WHERE id=?', (pid,)).fetchone()
    con.close()
    return _row(row) if row else None

def _update(pid, **fields):
    con = _conn()
    con.execute(f'UPDATE proposals SET {", ".join(f"{k}=?" for k in fields)} WHERE id=?',
                (*fields.values(), pid))
    con.commit()
    con.close()

def reject_proposal(pid):
    p = get_proposal(pid)
    if not p or p['status'] != 'PENDING':
        raise ValueError('Заявка не найдена или уже обработана')
    _update(pid, status='REJECTED', decided_at=datetime.now(timezone.utc).isoformat())

def to_quotation(value):
    value = D(str(value))
    units = int(value)
    nano = int((value - units) * D('1000000000'))
    return {'units': str(units), 'nano': nano}

class OrdersClient:
    def __init__(self, token, transport=None):
        self.client = httpx.AsyncClient(headers={'Authorization': f'Bearer {token}'}, timeout=15,
                                       follow_redirects=False, transport=transport, verify=_ssl_context())

    async def call(self, service, method, body):
        if (service, method) not in ALLOWED_METHODS:
            raise ValueError('Only allowlisted order methods are permitted')
        try:
            response = await self.client.post(f'{BASE}{service}/{method}', json=body)
        except httpx.RequestError:
            raise MarketDataError('Сетевая ошибка брокера; проверьте соединение') from None
        if not response.is_success:
            descriptions = {401: 'Токен не принят', 403: 'Токену не хватает прав на торговлю'}
            raise MarketDataError(f'{descriptions.get(response.status_code, "Ошибка брокера")} (HTTP {response.status_code})')
        try: return response.json()
        except ValueError: raise MarketDataError('Некорректный JSON брокера') from None

    async def aclose(self):
        await self.client.aclose()

async def approve_proposal(pid, account_id, token, transport=None):
    if not is_armed():
        raise ValueError('Live не взведён (LIVE_ARMED=0) — включите в настройках перед подтверждением')
    p = get_proposal(pid)
    if not p or p['status'] != 'PENDING':
        raise ValueError('Заявка не найдена, уже обработана или устарела')
    client = OrdersClient(token, transport)
    try:
        body = {
            'instrumentId': p['instrument_uid'],
            'quantity': p['lots'],
            'direction': 'ORDER_DIRECTION_BUY' if p['side'] == 'BUY' else 'ORDER_DIRECTION_SELL',
            'accountId': account_id,
            'orderType': 'ORDER_TYPE_LIMIT',
            'orderId': pid,
            'price': to_quotation(p['price']),
        }
        result = await client.call('OrdersService', 'PostOrder', body)
        _update(pid, status='SENT', account_id=account_id, broker_order_id=result.get('orderId'),
                decided_at=datetime.now(timezone.utc).isoformat())
        return result
    except MarketDataError as exc:
        _update(pid, status='ERROR', account_id=account_id, error=str(exc),
                decided_at=datetime.now(timezone.utc).isoformat())
        raise
    finally:
        await client.aclose()

async def kill_switch(account_id, token, transport=None):
    """Disarms immediately, then best-effort cancels every order this app sent
    that is still resting at the broker. Existing positions are left alone —
    flattening them would itself be an unattended trade, which the arming
    model here deliberately never allows."""
    set_armed(False)
    con = _conn()
    sent = con.execute("SELECT id, broker_order_id FROM proposals WHERE status='SENT' AND broker_order_id IS NOT NULL").fetchall()
    con.close()
    if not sent or not token:
        return {'disarmed': True, 'cancelled': 0, 'errors': []}
    client = OrdersClient(token, transport)
    cancelled, errors = 0, []
    try:
        for pid, broker_order_id in sent:
            try:
                await client.call('OrdersService', 'CancelOrder', {'accountId': account_id, 'orderId': broker_order_id})
                _update(pid, status='CANCELLED', decided_at=datetime.now(timezone.utc).isoformat())
                cancelled += 1
            except MarketDataError as exc:
                errors.append(f'{broker_order_id}: {exc}')
    finally:
        await client.aclose()
    return {'disarmed': True, 'cancelled': cancelled, 'errors': errors}

async def reconcile(account_id, token, transport=None):
    """Best-effort: cross-check locally SENT proposals against the broker's
    own order list and update their status. Never places or cancels orders."""
    con = _conn()
    sent = con.execute("SELECT id FROM proposals WHERE status='SENT'").fetchall()
    con.close()
    if not sent or not token:
        return {'checked': 0}
    client = OrdersClient(token, transport)
    try:
        orders = (await client.call('OrdersService', 'GetOrders', {'accountId': account_id})).get('orders', [])
    except MarketDataError as exc:
        await client.aclose()
        return {'checked': 0, 'error': str(exc)}
    await client.aclose()
    by_id = {o.get('orderId'): o for o in orders}
    checked = 0
    for (pid,) in sent:
        broker = by_id.get(pid)
        if broker is None:
            continue  # No longer resting; leave as SENT until a human reconciles manually.
        status = broker.get('executionReportStatus', '')
        if status == 'EXECUTION_REPORT_STATUS_FILL':
            _update(pid, status='FILLED', decided_at=datetime.now(timezone.utc).isoformat())
        elif status in ('EXECUTION_REPORT_STATUS_REJECTED', 'EXECUTION_REPORT_STATUS_CANCELLED'):
            _update(pid, status='CANCELLED', decided_at=datetime.now(timezone.utc).isoformat())
        checked += 1
    return {'checked': checked}
