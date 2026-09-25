/** Bounded synthetic provider protocol probe. No microphone, Pi jobs or code execution. */
import { createDefaultLiveCredentialService } from '../../src/live/credentials';
import { dieSystemPrompt } from '../../src/prompts';
const mode = process.argv[2];
if (!['realtime','live-tools','live-delegation'].includes(mode)) throw Error('mode');
const key = await (await createDefaultLiveCredentialService(undefined,'openai')).loadKey();
const live = mode !== 'realtime';
const url = live ? 'wss://api.openai.com/v1/live/sessions' : 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1';
const ws = new WebSocket(url, {headers:{Authorization:'Bearer '+key}} as any);
const schema={type:'object',properties:{code:{type:'string'},timeoutSeconds:{type:'number',minimum:0.1},outputByteLimit:{type:'number',minimum:0,maximum:Number.MAX_SAFE_INTEGER}},required:['code'],additionalProperties:false};
const tool={type:'function',name:'execute',description:'Run JS/TS in current directory. Probe only: simulated output; no code is executed.',parameters:schema};
let step=0, calls=0, timer=setTimeout(()=>{ console.log('deadline', {step,calls});ws.close();},12000);
const send=(e:any)=>ws.send(JSON.stringify(e));
ws.addEventListener('open',()=>{
 console.log('open');
 if(live) send({type:'session.start',event_id:'probe_start',session:{model:'gpt-live-1',instructions:dieSystemPrompt()+'\n\nSynthetic test only: call execute with code console.log(2+2) before answering. The client will simulate a result.',audio:{format:{type:'audio/pcm',rate:24000},output:{voice:'marin'}},delegation:{type:'client'},...(mode==='live-tools'?{tools:[tool],tool_choice:'required'}:{})}});
 else send({type:'session.update',session:{type:'realtime',instructions:dieSystemPrompt()+'\n\nSynthetic test only: call execute with code console.log(2+2) before answering. The client will simulate a result.',audio:{input:{format:{type:'audio/pcm',rate:24000},turn_detection:null},output:{format:{type:'audio/pcm',rate:24000},voice:'marin'}},output_modalities:['text'],tools:[tool],tool_choice:'required'}});
});
ws.addEventListener('message',(ev:any)=>{let m:any;try{m=JSON.parse(ev.data)}catch{return};let type=m.type;let log:any={type};if(type==='error') log.error={type:m.error?.type,code:m.error?.code,param:m.error?.param,message: typeof m.error?.message==='string'?m.error.message.replaceAll(key,'[redacted]').slice(0,220):undefined};if(type==='session.started'||type==='session.updated')log.session={model:m.session?.model,toolNames:m.session?.tools?.map((x:any)=>x.name),delegation:m.session?.delegation?.type};if(type==='response.output_item.done'||type==='response.output_item.added')log.item={type:m.item?.type,name:m.item?.name,call_id:!!m.item?.call_id};if(type==='response.done')log.response={status:m.response?.status,outputTypes:m.response?.output?.map((x:any)=>x.type)};if(type==='session.delegation.created')log.delegation={target:m.delegation?.target,id:!!m.delegation?.id};if(['error','session.started','session.updated','response.output_item.done','response.output_item.added','response.done','session.delegation.created','session.closed'].includes(type))console.log(JSON.stringify(log));
 if(type==='session.updated'&&!live&&step++===0)send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic test. Call execute now and then report its simulated result.'}]}}),send({type:'response.create',response:{output_modalities:['text']}});
 // GPT-Live documentation specifies input_audio.append, not synthetic text input. Do not invent a text-input event.
 // A silent session cannot establish whether delegation executes a client tool.

 if(type==='response.output_item.done'&&m.item?.type==='function_call'&&m.item?.name==='execute'){calls++;send({type:'conversation.item.create',item:{type:'function_call_output',call_id:m.item.call_id,output:JSON.stringify({output:'4 (simulated)'})}});send({type:'response.create',response:{output_modalities:['text']}})}
 if(type==='response.done'&&calls){clearTimeout(timer);ws.close()}
});
ws.addEventListener('close',()=>{clearTimeout(timer);console.log('close')});ws.addEventListener('error',()=>console.log('transport_error'));
