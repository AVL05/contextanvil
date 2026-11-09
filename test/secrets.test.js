import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySensitivePath, findSecrets, redact } from '../src/core/secrets.js';
import { FAKE } from './helpers.js';

test('sensitive paths are recognised', () => {
  for (const p of ['.env', '.env.local', '.env.production', 'config/.env', 'certs/server.pem', 'id_rsa', '.ssh/config', '.npmrc',
    'secrets.json', 'credentials', 'service-account-prod.json', 'terraform.tfvars', 'infra/state.tfstate', 'wp-config.php', '.aws/credentials']) {
    assert.ok(classifySensitivePath(p), `${p} should be sensitive`);
  }
});

test('safe look-alikes are not flagged', () => {
  for (const p of ['.env.example', '.env.sample', '.env.template', 'src/core/secrets.js', 'id_rsa.pub', 'README.md', 'src/keyboard.js', 'environment.ts']) {
    assert.equal(classifySensitivePath(p), null, `${p} should not be sensitive`);
  }
});

test('findSecrets reports type and line but never the value', () => {
  const text = `line one\nkey = ${FAKE.aws()}\n\ntoken ${FAKE.github()}\n${FAKE.privateKey()}\n`;
  const found = findSecrets(text);
  const types = found.map((f) => f.type);
  assert.ok(types.includes('aws-access-key'));
  assert.ok(types.includes('github-token'));
  assert.ok(types.includes('private-key'));
  assert.equal(found.find((f) => f.type === 'aws-access-key').line, 2);
  assert.ok(!JSON.stringify(found).includes(FAKE.aws()));
});

test('redact removes secret values and keeps surrounding text', () => {
  const text = `export STRIPE=${FAKE.stripe()} # billing\nAPI_KEY=${FAKE.generic()}\nurl=postgres://admin:${FAKE.generic()}@db.internal/app`;
  const out = redact(text);
  assert.ok(!out.includes(FAKE.stripe()));
  assert.ok(!out.includes(FAKE.generic()));
  assert.match(out, /\[REDACTED:stripe-key\] # billing/);
  assert.match(out, /API_KEY=\[REDACTED:credential-assignment\]/);
  assert.match(out, /postgres:\/\/admin:\[REDACTED:url-credentials\]@db\.internal/);
});

test('placeholders and code references are not treated as secrets', () => {
  const text = [
    'API_KEY=your_api_key_here',
    'token: ${GITHUB_TOKEN}',
    'password = process.env.DB_PASSWORD',
    'secret: <replace-me>',
    'postgres://user:password@localhost/db',
    'authorization header uses a Bearer token',
  ].join('\n');
  assert.deepEqual(findSecrets(text), []);
  assert.equal(redact(text), text);
});
