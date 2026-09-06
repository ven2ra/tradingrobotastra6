"""Run with fastapi, httpx and jsonschema installed."""
import copy
import json
import os
from pathlib import Path
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, ValidationError
os.environ['T_INVEST_TOKEN'] = ''  # Contract tests must never call the real broker.
from app import app

root = Path(__file__).resolve().parents[1] / 'schemas'
for stem in ('strategy', 'risk-policy'):
    schema = json.loads((root / f'{stem}.schema.json').read_text(encoding='utf-8'))
    example = json.loads((root / f'{stem}.example.json').read_text(encoding='utf-8'))
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(example)

schema = json.loads((root / 'strategy.schema.json').read_text(encoding='utf-8'))
example = json.loads((root / 'strategy.example.json').read_text(encoding='utf-8'))
bad = copy.deepcopy(example)
bad['regimes'] = ['UPTREND']
try:
    Draft202012Validator(schema).validate(bad)
except ValidationError:
    pass
else:
    raise AssertionError('Schema allowed Grid in UPTREND')

with TestClient(app) as client:
    snapshot = client.get('/api/paper/snapshot')
    assert snapshot.status_code == 200
    assert snapshot.json()['mode'] == 'PAPER'
    assert client.get('/api/paper/journal').status_code == 200
    assert client.get('/api/live/enabled').json()['enabled'] is False
    assert client.post('/api/live/orders/does-not-exist/approve').status_code == 401
    assert client.get('/api/health').json()['live_enabled'] is False
    assert client.get('/api/t-invest/snapshot').json()['configured'] is False
    assert client.post('/api/paper/orders').status_code == 404
print('Schema validation, forbidden Grid regime and FastAPI lifecycle/API checks passed')
