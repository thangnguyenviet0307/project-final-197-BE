import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { authResponse, cookieAuthTransport, clearRefreshCookie } from '../dist/utils/auth-cookie.js';
import { errorMiddleware } from '../dist/middlewares/error.middleware.js';

test('browser transport hides refresh token and requires trusted origin/header to read cookie', async () => {
  const app = express(); app.use(express.json()); app.use(cookieAuthTransport);
  app.post('/login', (req,res) => res.json(authResponse(req,res,{ accessToken:'access',refreshToken:'secret',user:{id:'id'} })));
  app.post('/refresh', (req,res) => res.json(req.body));
  app.post('/logout', (_req,res) => { clearRefreshCookie(res);res.sendStatus(204); });
  app.use(errorMiddleware);
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:'{}'});
  try {
    const headers={Origin:'http://localhost:5173','X-Auth-Transport':'cookie','X-Login-Area':'admin'};
    assert.equal((await post('/login',{Origin:'http://localhost:5173','X-Auth-Transport':'cookie'})).status,400);
    const login=await post('/login',headers);
    assert.deepEqual(await login.json(),{accessToken:'access',user:{id:'id'}});
    const cookie=login.headers.get('set-cookie');
    assert.match(cookie,/HttpOnly/); assert.match(cookie,/SameSite=Strict/); assert.match(cookie,/Path=\/api\/v1\/auth/);
    const refreshed=await post('/refresh',{...headers,Cookie:'adminRefreshToken=secret'});
    assert.deepEqual(await refreshed.json(),{refreshToken:'secret'});
    assert.equal((await post('/refresh',{...headers,Origin:'https://attacker.example',Cookie:'adminRefreshToken=secret'})).status,403);
    assert.equal((await post('/refresh',{Origin:'http://localhost:5173',Cookie:'adminRefreshToken=secret'})).status,403);
    const logout=await post('/logout'); assert.match(logout.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
