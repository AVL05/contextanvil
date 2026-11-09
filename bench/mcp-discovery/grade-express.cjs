const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');

async function main() {
  const express = require(path.join(path.resolve(process.argv[2]), 'index.js'));
  const app = express();
  app.use((req, res) => {
    if (req.url !== '/length') res.set('Transfer-Encoding', 'chunked');
    if (req.url === '/explicit') res.set('ETag', '"explicit"');
    res.send('hello');
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    async function get(route) {
      const response = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: server.address().port, path: route }, resolve).on('error', reject);
      });
      let body = '';
      for await (const chunk of response) body += chunk;
      assert.equal(response.statusCode, 200);
      assert.equal(body, 'hello');
      return response.headers;
    }
    const chunked = await get('/');
    assert.equal(chunked['transfer-encoding'], 'chunked');
    assert.equal(chunked['content-length'], undefined);
    assert.equal(chunked.etag, 'W/"5-qvTGHdzF6KLavt4PO0gs2a6pQ00"');
    const explicit = await get('/explicit');
    assert.equal(explicit.etag, '"explicit"');
    assert.equal(explicit['content-length'], undefined);
    const fixed = await get('/length');
    assert.equal(fixed['content-length'], '5');
    assert.equal(fixed.etag, chunked.etag);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
