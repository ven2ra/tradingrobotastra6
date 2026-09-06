"""Read-only live broker account access (Phase 1). No OrdersService calls
exist anywhere in this module by design: ALLOWED_METHODS below is the only
allowlist a live_account request can reach, and it names read-only account
methods exclusively. Placing real orders is a separate, not-yet-built phase.
"""
import asyncio
import os
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal as D
from pathlib import Path

import httpx
import settings_store
from broker import BASE, MarketDataError, _ssl_context, quotation

ALLOWED_METHODS = {
    ('UsersService', 'GetAccounts'),
    ('OperationsService', 'GetPortfolio'),
    ('InstrumentsService', 'GetInstrumentBy'),  # Only to label positions with ticker/name.
}
AUDIT_DB = Path(os.getenv('LIVE_AUDIT_DB', str(Path(__file__).resolve().parent / 'data' / 'live_audit.db')))

def mask(value):
    return '•' * max(0, len(value) - 4) + value[-4:] if value else ''

def record_attempt(outcome, detail=''):
    # Every arm attempt is logged before the request is ever rejected, so
    # there is an accountable trail before real-money activation is possible.
    try:
        AUDIT_DB.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(AUDIT_DB)
        con.execute('CREATE TABLE IF NOT EXISTS live_attempts '
                     '(time TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT NOT NULL)')
        con.execute('INSERT INTO live_attempts VALUES (?,?,?)',
                     (datetime.now(timezone.utc).isoformat(), outcome, detail))
        con.commit()
        con.close()
    except sqlite3.Error:
        pass  # Audit logging must never block or crash the request path.

def read_attempts(limit=50):
    try:
        con = sqlite3.connect(AUDIT_DB)
        rows = con.execute('SELECT time, outcome, detail FROM live_attempts ORDER BY time DESC LIMIT ?',
                            (limit,)).fetchall()
        con.close()
        return [{'time': t, 'outcome': o, 'detail': d} for t, o, d in rows]
    except sqlite3.Error:
        return []

class LiveClient:
    def __init__(self, token, transport=None):
        self.client = httpx.AsyncClient(headers={'Authorization': f'Bearer {token}'}, timeout=15,
                                       follow_redirects=False, transport=transport, verify=_ssl_context())

    async def call(self, service, method, body):
        if (service, method) not in ALLOWED_METHODS:
            raise ValueError('Only allowlisted read-only account methods are permitted')
        try:
            response = await self.client.post(f'{BASE}{service}/{method}', json=body)
        except httpx.RequestError:
            raise MarketDataError('Сетевая ошибка брокера; проверьте соединение') from None
        if not response.is_success:
            descriptions = {401: 'Токен не принят', 403: 'Токену не хватает прав на чтение счёта'}
            raise MarketDataError(f'{descriptions.get(response.status_code, "Ошибка брокера")} (HTTP {response.status_code})')
        try: return response.json()
        except ValueError: raise MarketDataError('Некорректный JSON брокера') from None

class LiveAccount:
    def __init__(self, token=None, transport=None):
        token = token if token is not None else (settings_store.get('T_INVEST_TOKEN') or os.getenv('T_INVEST_TOKEN', ''))
        self.token = token
        self.api = LiveClient(token, transport) if token else None
        self.preferred_account_id = os.getenv('T_INVEST_ACCOUNT_ID', '') or None
        self.account_id = None  # Unmasked; populated by summary() for internal (admin-only) use.

    async def summary(self):
        if not self.api:
            return {'configured': False, 'error': 'T_INVEST_TOKEN не настроен на сервере'}
        try:
            accounts = (await self.api.call('UsersService', 'GetAccounts', {})).get('accounts', [])
        except MarketDataError as exc:
            return {'configured': True, 'error': str(exc)}
        opened = [a for a in accounts if a.get('status') == 'ACCOUNT_STATUS_OPEN']
        if not opened:
            return {'configured': True, 'error': 'На этом токене нет открытых брокерских счетов'}
        account = next((a for a in opened if a.get('id') == self.preferred_account_id), opened[0])
        self.account_id = account.get('id')
        try:
            portfolio = await self.api.call('OperationsService', 'GetPortfolio', {'accountId': account['id']})
        except MarketDataError as exc:
            return {'configured': True, 'error': str(exc)}
        def amount(key):
            v = portfolio.get(key)
            return quotation(v) if v else D('0')
        total = sum(amount(k) for k in ('totalAmountShares', 'totalAmountBonds', 'totalAmountEtfs',
                                         'totalAmountCurrencies', 'totalAmountFutures'))
        yield_pct = portfolio.get('expectedYield')
        return {
            'configured': True, 'error': '',
            'account_id_masked': mask(account.get('id', '')),
            'account_name': account.get('name') or account.get('type', ''),
            'opened_date': account.get('openedDate'),
            'total_amount_rub': str(total),
            'cash_rub': str(amount('totalAmountCurrencies')),
            'expected_yield_pct': str(quotation(yield_pct)) if yield_pct else None,
            'positions_count': len(portfolio.get('positions', [])),
            'accounts_available': len(opened),
            'positions': await self._positions(portfolio.get('positions', [])),
        }

    async def _positions(self, raw_positions):
        # Best-effort ticker/name labels for display only; a position whose
        # instrument can't be resolved (or isn't a share/bond) is skipped
        # rather than shown with a bare UID.
        out = []
        for p in raw_positions:
            if p.get('instrumentType') not in ('share', 'bond'):
                continue
            qty = quotation(p['quantity']) if p.get('quantity') else D('0')
            if qty == 0:
                continue
            uid = p.get('instrumentUid')
            try:
                meta = (await self.api.call('InstrumentsService', 'GetInstrumentBy',
                        {'idType': 'INSTRUMENT_ID_TYPE_UID', 'id': uid}))['instrument']
            except (MarketDataError, KeyError):
                continue
            out.append({
                'ticker': meta.get('ticker', uid),
                'name': meta.get('name') or meta.get('ticker', uid),
                'kind': 'bond' if p['instrumentType'] == 'bond' else 'stock',
                'price': str(quotation(p['currentPrice'])) if p.get('currentPrice') else None,
                'lots': str(qty),
                'pnl_rub': str(quotation(p['expectedYield'])) if p.get('expectedYield') else '0',
            })
        return out

    async def aclose(self):
        if self.api: await self.api.client.aclose()

if __name__ == '__main__':
    async def smoke():
        account = LiveAccount()
        try:
            import json
            print(json.dumps(await account.summary(), ensure_ascii=False, indent=2))
        finally:
            await account.aclose()
    asyncio.run(smoke())
