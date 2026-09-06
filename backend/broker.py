"""Shared HTTP/TLS/quotation plumbing for every T-Invest API client (market
data, live account reads, live order placement). Kept separate from
tinvest.py so tinvest.py (which creates live-order proposals when a signal
fires) and live_orders.py (which places them) can import from a common base
without importing each other.
"""
import ssl
from datetime import datetime
from decimal import Decimal as D
from pathlib import Path

import certifi

BASE = 'https://invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1.'
RUSSIAN_ROOT_CA = Path(__file__).resolve().parent / 'certs' / 'russian_trusted_root_ca.pem'

def _ssl_context():
    # invest-public-api.tbank.ru serves a chain rooted at the Russian Trusted
    # Sub CA (Минцифры), which is absent from certifi's public trust store.
    ctx = ssl.create_default_context(cafile=certifi.where())
    if RUSSIAN_ROOT_CA.is_file():
        ctx.load_verify_locations(cafile=str(RUSSIAN_ROOT_CA))
    return ctx

class MarketDataError(Exception):
    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code

def quotation(value):
    if not isinstance(value, dict) or 'units' not in value and 'nano' not in value:
        raise ValueError('Missing quotation')
    result = D(str(value.get('units', 0))) + D(str(value.get('nano', 0))) / D('1000000000')
    if not result.is_finite(): raise ValueError('Nonfinite quotation')
    return result

def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))
