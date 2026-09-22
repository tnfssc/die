#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const here=path.dirname(new URL(import.meta.url).pathname);
const require=createRequire(import.meta.url);
const { chromium }=require(path.join(here,'.runtime/upstream/apps/desktop/node_modules/playwright-core'));
const result=JSON.parse(fs.readFileSync(path.join(here,'.runtime/integrated-real-result.json'),'utf8'));
const projections=Object.values(result.projections);
const parent=projections.find(p=>p.thread.lineage.parentThreadId===null);
if(!parent) throw new Error('integrated result has no root projection');
const children=projections.filter(p=>p.thread.lineage.parentThreadId===parent.thread.id);
if(children.length<1) throw new Error('integrated result has no direct child projection');
const strings=x=>{const out=[];const walk=v=>{if(typeof v==='string')out.push(v);else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')Object.values(v).forEach(walk)};walk(x);return out};
const target=children.find(p=>strings(p).some(x=>x.includes('INTEGRATED_REAL_RESULT_7bde9d'))) ?? children[0];
const markers=['INTEGRATED_CHILD_TOOL_EVENT','INTEGRATED_REAL_RESULT_7bde9d'];
if(!markers.includes('INTEGRATED_REAL_RESULT_7bde9d')) throw new Error('expected actual integrated marker absent from target projection');
const log=fs.readFileSync(path.join(here,'.runtime/browser-live-dev.log'),'utf8');
const matches=log.split('\n').flatMap(line=>{const marker='pairingUrl: ';const i=line.indexOf(marker);return i<0?[]:[line.slice(i+marker.length).trim()]});
if(!matches.length) throw new Error('browser-live pairing URL not found');
const pair=matches.at(-1), origin=new URL(pair).origin;
const profile=path.join(here,'.runtime/browser-live-profile-final');
const pairedMarker=path.join(profile,'.t3-browser-live-paired');
const context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1440,height:1000}});
try {
const page=await context.newPage();
page.on('console',m=>console.log('browser console',m.type(),m.text()));
page.on('pageerror',e=>console.log('browser error',e.message));
page.on('requestfailed',r=>console.log('request failed',r.url(),r.failure()?.errorText));
page.on('response',r=>{if(r.status()>=400)console.log('response',r.status(),r.url())});
await page.goto(fs.existsSync(pairedMarker)?origin:pair,{waitUntil:'domcontentloaded',timeout:30000}); await page.waitForTimeout(4000);
if(page.url().includes('/pair')){const c=page.getByRole('button',{name:'Continue'});if(await c.count()){await c.click();await page.waitForTimeout(4000)}}
if(!(await page.locator('body').innerText()).trim()){await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(8000)}
if(!page.url().includes('/pair'))fs.writeFileSync(pairedMarker,'paired session; no credentials');
await page.waitForTimeout(9000);
if(page.url().includes('/welcome')){const c=page.getByRole('button',{name:'Continue'});if(await c.count()){await c.click();await page.waitForTimeout(2500)}}
const esc=s=>[...s].map(c=>'\\.^$*+?()[]{}|'.includes(c)?'\\'+c:c).join('');
let parentButton=page.getByRole('button',{name:new RegExp(esc(parent.thread.title))}).first();
if(!(await parentButton.isVisible().catch(()=>false))){const settled=page.getByRole('button',{name:/Settled/});if(await settled.count()){await settled.click();await page.waitForTimeout(700)}}
parentButton=page.getByRole('button',{name:new RegExp(esc(parent.thread.title))}).first();
console.log('BEFORE_PARENT_URL',page.url()); console.log('BEFORE_PARENT_TEXT',(await page.locator('body').innerText()).slice(0,4000)); console.log('BEFORE_PARENT_BUTTONS',await page.getByRole('button').allTextContents());
await parentButton.waitFor({state:'visible',timeout:5000}); await parentButton.click(); await page.waitForTimeout(2500);
const parentUrl=page.url();
if(!decodeURIComponent(parentUrl).includes(parent.thread.id)) throw new Error('did not render actual parent: '+parentUrl);
await page.screenshot({path:path.join(here,'browser-live-parent.png'),fullPage:true});
const previous=page.getByRole('button',{name:/Previous agents/}); if(await previous.count()) {await previous.click();await page.waitForTimeout(700)}
const displayTail=target.thread.title.split('/').filter(Boolean).at(-1)??target.thread.title;
let childButton=page.getByRole('button',{name:new RegExp(esc(displayTail),'i')}).first();
if(!(await childButton.isVisible().catch(()=>false))){
 const panel=page.locator('[data-thread-relationships-panel]');
 const buttons=panel.getByRole('button');
 console.log('RELATIONSHIP_BUTTONS',await buttons.allTextContents());
 const candidates=[];for(let i=0;i<await buttons.count();i++){const b=buttons.nth(i);const t=(await b.innerText()).trim();if(t&&!/Previous agents|More thread actions/i.test(t))candidates.push(b)}
 if(candidates.length!==1) throw new Error('could not uniquely identify target child button: '+displayTail);
 childButton=candidates[0];
}
const clickedLabel=(await childButton.innerText()).trim(); await childButton.click(); await page.waitForTimeout(2500);
const childUrl=page.url();
if(!decodeURIComponent(childUrl).includes(target.thread.id)) throw new Error('relationship click did not navigate to exact actual child '+target.thread.id+': '+childUrl);
// Prove durable reconnect/rendering, not only the first navigation frame.
await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(3500);
if(!decodeURIComponent(page.url()).includes(target.thread.id)) throw new Error('child route lost on refresh');
const worked=page.getByRole('button',{name:/Worked for/});
if(await worked.count()) { await worked.first().click(); await page.waitForTimeout(700); }
let bodyText=await page.locator('body').innerText();
if(!bodyText.includes('INTEGRATED_CHILD_TOOL_EVENT')) {
  const execute=page.getByRole('button',{name:/execute/i});
  if(await execute.count()) { await execute.first().click(); await page.waitForTimeout(700); }
  bodyText=await page.locator('body').innerText();
}
console.log('CHILD_RENDERED_BUTTONS',await page.getByRole('button').allTextContents());
for(const marker of markers) if(!bodyText.includes(marker)) throw new Error('rendered child transcript marker missing: '+marker);
await page.evaluate(({parentId,childId,markers})=>{const n=document.createElement('div');n.id='t3-browser-live-proof-marker';n.textContent='BROWSER PROOF \u2022 closed real-engine SQLite snapshot; provider stopped \u2022 parentThreadId='+parentId+' \u2022 exact childThreadId='+childId+' \u2022 refreshed transcript verified';Object.assign(n.style,{position:'fixed',left:'16px',right:'16px',bottom:'16px',zIndex:'2147483647',padding:'12px',background:'#052e16',color:'#dcfce7',border:'3px solid #22c55e',font:'bold 13px monospace',overflowWrap:'anywhere'});document.body.appendChild(n)},{parentId:parent.thread.id,childId:target.thread.id,markers});
await page.screenshot({path:path.join(here,'browser-live-child-navigation.png'),fullPage:true});
const engineProof=JSON.parse(fs.readFileSync(path.join(here,'integrated-process-proof.json'),'utf8'));
if(engineProof.engine.successThreadId!==target.thread.id) throw new Error('browser input differs from captured engine/process proof');
const proof={label:'rendered closed real-engine SQLite snapshot, provider stopped',parentThreadId:parent.thread.id,childThreadId:target.thread.id,parentUrl,childUrl,clickedLabel,markers,markerCounts:Object.fromEntries(markers.map(marker=>[marker,bodyText.split(marker).length-1])),childCount:children.length,refreshed:true,sourceDatabaseSha256:createHash('sha256').update(fs.readFileSync(path.join(here,'.runtime/integrated-real-state.sqlite'))).digest('hex'),sourceResultSha256:createHash('sha256').update(fs.readFileSync(path.join(here,'.runtime/integrated-real-result.json'))).digest('hex')};
fs.writeFileSync(path.join(here,'browser-live-proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof,null,2));
} finally { await context.close(); }
