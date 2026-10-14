import test from 'node:test';
import assert from 'node:assert/strict';
import {sessions} from '../server/session.mjs';
import {loadConfig} from '../server/config.mjs';
import {engine,tracks} from '../server/engine.mjs';
const secret='test-session-secret-'.repeat(3);
test('signed device sessions cannot be substituted or modified',()=>{const session=sessions({sessionSecret:secret,publicOrigin:'https://speedway.test'}),headers={},owner=session.get({headers:{}},{setHeader(k,v){headers[k]=v}}),cookie=headers['Set-Cookie'];assert.equal(session.read(cookie),owner);assert.ok(cookie.includes('HttpOnly')&&cookie.includes('Secure'));assert.equal(session.read(cookie.replace(owner,owner.slice(0,-1)+'x')),null);assert.equal(session.read(cookie.replace(/\.[^;]+/,'.invalid')),null)});
test('configuration rejects missing secret and malformed limits',()=>{assert.throws(()=>loadConfig({}),/SESSION_SECRET/);const env={SESSION_SECRET:secret,MARIADB_USER:'speedway',MARIADB_DATABASE:'speedway'};assert.equal(loadConfig(env).snapshotHz,20);assert.throws(()=>loadConfig({...env,MAX_ROOMS:'NaN'}),/MAX_ROOMS/);assert.throws(()=>loadConfig({...env,REDIS_PREFIX:'bad prefix'}),/REDIS_PREFIX/)});
test('every random course completes using unchanged authoritative physics',()=>{for(const track of tracks){const w=engine.create({track,seed:548,members:[],createdAt:0,lightOffAt:5000});for(let time=0;time<130000&&w.phase!=='result';time+=125)engine.advance(w,time);assert.equal(w.phase,'result',track);assert.equal(w.reason,'finished');assert.ok(w.racers.every(r=>r.finish!==null));assert.ok(w.racers.every(r=>Number.isFinite(r.x+r.y+r.progress)))}});
