"""Phase 2: human-approved real order placement, one broker account per user.

Every call to OrdersService in this codebase lives in this one file, behind
approve_proposal(). Nothing here ever runs automatically: tinvest.py only
calls create_proposal() (a local DB write) when a strategy signal fires
against real market data and the system is enabled by an admin; the order
itself is placed only when a human calls approve_proposal() through the API
with their own T-Invest token, after looking at the proposal.

There is no server-side notion of "my account" or "my token" — every
trading endpoint takes the caller's token on that one request (see
app.py's X-Live-Token header) and this module never stores it. A proposal
(ticker/side/lots/price/rule) is a shared candidate visible to everyone;
each visitor decides independently, with their own money, whether to send
it to their own account. order_sends tracks that per (proposal, account)
so the same visitor can't double-send, while a different visitor acting on
the same proposal sends their own, separate order.
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
PROPOSAL_COLUMNS = ('id', 'created_at', 'ticker', 'instrument_uid', 'side', 'lots', 'price',
                    'order_type', 'rule', 'status')
SEND_COLUMNS = ('id', 'proposal_id', 'account_id', 'status', 'broker_order_id', 'error',
                'created_at', 'decided_at')

def _conn():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.execute('CREATE TABLE IF NOT EXISTS proposals ('
                'id TEXT PRIMARY KEY, created_at TEXT NOT NULL, ticker TEXT NOT NULL, '
                'instrument_uid TEXT NOT NULL, side TEXT NOT NULL, lots INTEGER NOT NULL, '
                'price TEXT NOT NULL, order_type TEXT NOT NULL, rule TEXT NOT NULL, status TEXT NOT NULL)')
    con.execute('CREATE TABLE IF NOT EXISTS order_sends ('
                'id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, account_id TEXT NOT NULL, '
                'status TEXT NOT NULL, broker_order_id TEXT, error TEXT, '
                'created_at TEXT NOT NULL, decided_at TEXT, UNIQUE(proposal_id, account_id))')
    return con

def is_enabled():
    # Admin-controlled, system-wide: whether strategy signals get turned into
    # proposals at all. It does not authorize anyone to trade — every user
    # still brings and approves with their own token.
    return settings_store.get('LIVE_ENABLED') == '1'

def set_enabled(value):
    settings_store.set('LIVE_ENABLED', '1' if value else '0')

def _row(columns, cur_row):
    return dict(zip(columns, cur_row))

def _expire_stale(con):
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=PROPOSAL_TTL_SECONDS)).isoformat()
    con.execute("UPDATE proposals SET status='EXPIRED' WHERE status='PENDING' AND created_at<?", (cutoff,))
    con.commit()

def create_proposal(ticker, instrument_uid, side, lots, price, order_type, rule):
    if not is_enabled(): return None
    con = _conn()
    _expire_stale(con)
    existing = con.execute("SELECT id FROM proposals WHERE ticker=? AND rule=? AND status='PENDING'",
                            (ticker, rule)).fetchone()
    if existing:
        con.close()
        return None  # Don't flood the approval queue while the same signal keeps firing.
    pid = str(uuid.uuid4())
    con.execute('INSERT INTO proposals (id, created_at, ticker, instrument_uid, side, lots, price, '
                'order_type, rule, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
                (pid, datetime.now(timezone.utc).isoformat(), ticker, instrument_uid, side, lots,
                 str(price), order_type, rule, 'PENDING'))
    con.commit()
    con.close()
    return pid

def _my_sends(con, account_id):
    if not account_id: return {}
    rows = con.execute('SELECT * FROM order_sends WHERE account_id=?', (account_id,)).fetchall()
    return {r[1]: _row(SEND_COLUMNS, r) for r in rows}  # keyed by proposal_id

def list_proposals(limit=100, account_id=None):
    con = _conn()
    _expire_stale(con)
    rows = con.execute('SELECT * FROM proposals ORDER BY created_at DESC LIMIT ?', (limit,)).fetchall()
    mine = _my_sends(con, account_id)
    con.close()
    out = []
    for r in rows:
        p = _row(PROPOSAL_COLUMNS, r)
        send = mine.get(p['id'])
        p['my_status'] = send['status'] if send else None
        p['my_broker_order_id'] = send['broker_order_id'] if send else None
        p['my_error'] = send['error'] if send else None
        out.append(p)
    return out

def get_proposal(pid):
    con = _conn()
    row = con.execute('SELECT * FROM proposals WHERE id=?', (pid,)).fetchone()
    con.close()
    return _row(PROPOSAL_COLUMNS, row) if row else None

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

def _upsert_send(pid, account_id, **fields):
    con = _conn()
    existing = con.execute('SELECT id FROM order_sends WHERE proposal_id=? AND account_id=?',
                            (pid, account_id)).fetchone()
    if existing:
        con.execute(f'UPDATE order_sends SET {", ".join(f"{k}=?" for k in fields)} WHERE id=?',
                    (*fields.values(), existing[0]))
    else:
        sid = str(uuid.uuid4())
        cols = ('id', 'proposal_id', 'account_id', *fields.keys())
        vals = (sid, pid, account_id, *fields.values())
        con.execute(f'INSERT INTO order_sends ({", ".join(cols)}) VALUES ({", ".join("?" for _ in cols)})',
                    vals)
    con.commit()
    con.close()

async def approve_proposal(pid, account_id, token, transport=None):
    if not is_enabled():
        raise ValueError('Приём предложений отключён администратором')
    p = get_proposal(pid)
    if not p or p['status'] != 'PENDING':
        raise ValueError('Заявка не найдена, уже обработана или устарела')
    con = _conn()
    already = con.execute('SELECT status FROM order_sends WHERE proposal_id=? AND account_id=?',
                           (pid, account_id)).fetchone()
    con.close()
    if already and already[0] in ('SENT', 'FILLED'):
        raise ValueError('Вы уже отправляли эту заявку на этот счёт')
    order_id = str(uuid.uuid4())
    client = OrdersClient(token, transport)
    try:
        body = {
            'instrumentId': p['instrument_uid'],
            'quantity': p['lots'],
            'direction': 'ORDER_DIRECTION_BUY' if p['side'] == 'BUY' else 'ORDER_DIRECTION_SELL',
            'accountId': account_id,
            'orderType': 'ORDER_TYPE_LIMIT',
            'orderId': order_id,
            'price': to_quotation(p['price']),
        }
        result = await client.call('OrdersService', 'PostOrder', body)
        _upsert_send(pid, account_id, status='SENT', broker_order_id=result.get('orderId', order_id),
                     error=None, created_at=datetime.now(timezone.utc).isoformat(),
                     decided_at=datetime.now(timezone.utc).isoformat())
        return result
    except MarketDataError as exc:
        _upsert_send(pid, account_id, status='ERROR', broker_order_id=None, error=str(exc),
                     created_at=datetime.now(timezone.utc).isoformat(),
                     decided_at=datetime.now(timezone.utc).isoformat())
        raise
    finally:
        await client.aclose()

async def kill_switch(account_id, token, transport=None):
    """Best-effort cancels every order this app sent for this account that is
    still resting at the broker. Existing positions are left alone —
    flattening them would itself be an unattended trade, which this model
    deliberately never allows. Only affects the caller's own account."""
    con = _conn()
    sent = con.execute("SELECT id, broker_order_id FROM order_sends WHERE account_id=? AND status='SENT' "
                        "AND broker_order_id IS NOT NULL", (account_id,)).fetchall()
    con.close()
    if not sent or not token:
        return {'cancelled': 0, 'errors': []}
    client = OrdersClient(token, transport)
    cancelled, errors = 0, []
    try:
        for send_id, broker_order_id in sent:
            try:
                await client.call('OrdersService', 'CancelOrder', {'accountId': account_id, 'orderId': broker_order_id})
                con = _conn()
                con.execute('UPDATE order_sends SET status=?, decided_at=? WHERE id=?',
                            ('CANCELLED', datetime.now(timezone.utc).isoformat(), send_id))
                con.commit()
                con.close()
                cancelled += 1
            except MarketDataError as exc:
                errors.append(f'{broker_order_id}: {exc}')
    finally:
        await client.aclose()
    return {'cancelled': cancelled, 'errors': errors}

async def reconcile(account_id, token, transport=None):
    """Best-effort: cross-check this account's locally SENT orders against
    the broker's own order list and update their status. Never places or
    cancels orders."""
    con = _conn()
    sent = con.execute("SELECT id, broker_order_id FROM order_sends WHERE account_id=? AND status='SENT'",
                        (account_id,)).fetchall()
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
    for send_id, broker_order_id in sent:
        broker = by_id.get(broker_order_id)
        if broker is None:
            continue  # No longer resting; leave as SENT until a human reconciles manually.
        status = broker.get('executionReportStatus', '')
        new_status = None
        if status == 'EXECUTION_REPORT_STATUS_FILL':
            new_status = 'FILLED'
        elif status in ('EXECUTION_REPORT_STATUS_REJECTED', 'EXECUTION_REPORT_STATUS_CANCELLED'):
            new_status = 'CANCELLED'
        if new_status:
            con = _conn()
            con.execute('UPDATE order_sends SET status=?, decided_at=? WHERE id=?',
                        (new_status, datetime.now(timezone.utc).isoformat(), send_id))
            con.commit()
            con.close()
        checked += 1
    return {'checked': checked}
