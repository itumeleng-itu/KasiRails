import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = 'http://localhost:3000';

async function createOrder() {
  const response = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zar: 12 })
  });

  assert.equal(response.status, 201);
  return response.json();
}

test('Health endpoint responds successfully', async () => {
  const response = await fetch(`${BASE_URL}/health`);
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.ok, true);
});

test('USDC domain is Base Sepolia', async () => {
  const response = await fetch(`${BASE_URL}/usdc-domain`);
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.chainId, 84532);
  assert.equal(data.name, 'USDC');
});

test('Checkout order can be created and retrieved', async () => {
  const order = await createOrder();

  assert.equal(order.status, 'PENDING');
  assert.equal(order.zarCents, 1200);

  const response = await fetch(`${BASE_URL}/orders/${order.id}`);
  assert.equal(response.status, 200);

  const stored = await response.json();
  assert.equal(stored.id, order.id);
});

test('Malformed signature is rejected', async () => {
  const order = await createOrder();

  const response = await fetch(`${BASE_URL}/orders/${order.id}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: '0x145957C017Dc3c74118005EA6fc803D473512F10',
      validAfter: '0',
      validBefore: String(Math.floor(Date.parse(order.expiresAt) / 1000)),
      signature: '0x1234'
    })
  });

  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(result.code, 'BAD_REQUEST');
});

test('Forged signature cannot pay an order', async () => {
  const order = await createOrder();

  const response = await fetch(`${BASE_URL}/orders/${order.id}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: '0x145957C017Dc3c74118005EA6fc803D473512F10',
      validAfter: '0',
      validBefore: String(Math.floor(Date.parse(order.expiresAt) / 1000)),
      signature: '0x' + '00'.repeat(65)
    })
  });

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.code, 'BAD_SIGNATURE');

  const check = await fetch(`${BASE_URL}/orders/${order.id}`);
  const stored = await check.json();

  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.txHash, undefined);
});
