import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth } from '../lib/auth.js';

test('password login issues an HttpOnly session that survives restart; changed passwords invalidate it', async t => {
  const directory = await mkdtemp(join(tmpdir(),'stock8-auth-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let clock = 1792050000000;
  const auth = await createAuth(directory,'1222',()=>clock);
  const req = {socket:{remoteAddress:'test-ip'},headers:{}};
  assert.equal(auth.authorized(req),false);
  assert.equal(auth.login(req,'wrong').status,401);
  const login = auth.login(req,'1222');
  assert.equal(login.status,200);
  assert.match(login.cookie,/HttpOnly; SameSite=Lax/);
  assert.ok(!login.cookie.includes('1222'));
  const signed = {...req,headers:{cookie:login.cookie.split(';')[0]}};
  assert.equal(auth.authorized(signed),true);
  assert.equal((await createAuth(directory,'1222',()=>clock)).authorized(signed),true);
  assert.equal((await createAuth(directory,'other',()=>clock)).authorized(signed),false);
  assert.equal(auth.authorized({...req,headers:{cookie:signed.headers.cookie+'forged'}}),false);
  assert.equal(auth.authorized({...req,headers:{cookie:signed.headers.cookie+'.extra'}}),false);
  clock += 31*24*60*60*1000;
  assert.equal(auth.authorized(signed),false);
});

test('repeated failed logins are limited, expire, and HTTPS cookies are secure', async t => {
  const directory = await mkdtemp(join(tmpdir(),'stock8-limit-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let clock = 0;
  const auth = await createAuth(directory,'1222',()=>clock);
  const req = {socket:{remoteAddress:'test-ip'},headers:{'x-forwarded-proto':'https'}};
  for (let i=0;i<10;i++) assert.equal(auth.login(req,'wrong').status,401);
  assert.equal(auth.login(req,'1222').status,429);
  clock = 60001;
  assert.match(auth.login(req,'1222').cookie,/; Secure$/);
});
