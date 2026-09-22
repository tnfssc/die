#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const here=path.dirname(new URL(import.meta.url).pathname);
const require=createRequire(import.meta.url);
const { chromium }=require(path.join(here,'.runtime/upstream/apps/desktop/node_modules/playwright-core'));
const log=fs.readFileSync(path.join(here,'.runtime/browser-dev.log'),'utf8');
const matches = log.split('\n').flatMap(line => { const marker = 'pairingUrl: '; const i = line.indexOf(marker); return i < 0 ? [] : [line.slice(i + marker.length).trim()]; });
if(!matches.length) throw new Error('pairing URL not found');
const pair=matches.at(-1);
const profile=path.join(here,'.runtime/browser-profile');
const context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1440,height:1000}});
const page=await context.newPage();
page.on('console',m=>console.log('browser console',m.type(),m.text()));
page.on('pageerror',e=>console.log('browser error',e.message));
page.on('requestfailed',r=>console.log('request failed',r.url(),r.failure()?.errorText));
page.on('response',r=>{if(r.status()>=400) console.log('response',r.status(),r.url())});
const origin=new URL(pair).origin;
await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(1500);
if(page.url().includes('/pair')) await page.goto(pair,{waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(10000);
if(page.url().includes('/welcome')) { const c=page.getByRole('button',{name:'Continue'}); if(await c.count()) { await c.click(); await page.waitForTimeout(3000); } }
const parent=page.getByRole('button',{name:/Replay fixture: subagent_v2_nested/});
if(!(await parent.isVisible().catch(()=>false))){const settled=page.getByRole('button',{name:/Settled/});if(await settled.count()){await settled.click();await page.waitForTimeout(700);}}
try{await parent.waitFor({state:'visible',timeout:3000});await parent.click();await page.waitForTimeout(2500);}catch{}
const agents=page.getByRole('button',{name:/Previous agents/}); if(await agents.count() && !await page.getByText('Hello Agent',{exact:true}).isVisible().catch(()=>false)){await agents.click();await page.waitForTimeout(1000);}
const parentUrl=page.url();
await page.screenshot({path:path.join(here,'browser-parent.png'),fullPage:true});
const childLink=page.getByRole('button',{name:/Hello Agent/}).first();
await childLink.click(); await page.waitForTimeout(2500);
const childUrl=page.url(); const childId='thread:provider:codex:native-thread:native-v2-nested-child-thread';
if(!decodeURIComponent(childUrl).includes(childId)) throw new Error('relationship click did not navigate to expected child: '+childUrl);
const bodyText=await page.locator('body').innerText();
if(!bodyText.includes('Subagent says: “Hello.”')) throw new Error('child transcript marker missing');
await page.evaluate(({parentUrl,childId})=>{const n=document.createElement('div');n.id='t3-browser-proof-marker';n.textContent='BROWSER PROOF • deterministic upstream replay fixture (not live provider) • parent→child navigation • childThreadId='+childId+' • marker: Subagent says “Hello.”';Object.assign(n.style,{position:'fixed',top:'0',left:'0',right:'0',zIndex:'2147483647',background:'#ffe500',color:'#111',font:'bold 14px monospace',padding:'10px',borderBottom:'3px solid #111'});document.body.appendChild(n);},{parentUrl,childId});
console.log('PARENT_URL',parentUrl); console.log('CHILD_URL',childUrl);
console.log('URL',page.url());
console.log('TITLE',await page.title());
console.log('TEXT', (await page.locator('body').innerText()).slice(0,4000));
console.log('BUTTONS',await page.getByRole('button').allTextContents());
await page.screenshot({path:path.join(here,'browser-child-navigation.png'),fullPage:true});
await context.close();
