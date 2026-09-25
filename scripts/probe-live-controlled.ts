/** Paid, text-only Live capability experiment. Never evaluates model code or opens user files. */
import WebSocket from "ws";
import { createHash } from "node:crypto";
import { openSync, readSync, closeSync } from "node:fs";
import { createDefaultLiveCredentialService } from "../src/live/credentials";
import { loadLiveConfig } from "../src/live/config";
import { createPromptPreview } from "../src/prompt-preview";

if (process.env.DIE_CAPABILITY_PROBE !== "1") throw Error("Set DIE_CAPABILITY_PROBE=1 for paid sessions");
const source="/Users/sharath/.die/agent/sessions/--Users-sharath-Private-home-Code-die--/2026-09-25T17-24-54-391Z_01a0d999-3ff7-7069-a846-1915d009aa05.jsonl";
const allowed:any[]=[];
const fd=openSync(source,"r");
try {
  const block=Buffer.alloc(4096); let carry="",position=0,finished=false;
  while(!finished){const count=readSync(fd,block,0,block.length,position);if(!count)break;
    position+=count;carry+=block.toString("utf8",0,count);
    let newline;while((newline=carry.indexOf("\n"))>=0){const line=carry.slice(0,newline);carry=carry.slice(newline+1);if(!line)continue;
      const entry=JSON.parse(line);if(entry.timestamp>="2026-09-25T17:32:53.000Z"){finished=true;break}allowed.push(entry);
    }
  }
}finally{closeSync(fd)}
const frame=allowed.find(x=>x.message?.role==="system")?.message?.sections;
if(!frame?.preamble||!frame?.cwd)throw Error("Missing original root");
const root=frame.preamble+"\n\n"+frame.cwd;
const preview=await createPromptPreview({rootMode:"orchestrator",message:"Synthetic probe for tool schema only"});
const declared=preview.tools.find(x=>x.name==="execute");
if(preview.tools.length!==1||!declared)throw Error("Execute-only tool required");
const tool={type:"function",name:"execute",description:declared.description,parameters:declared.parameters};
const config=await loadLiveConfig();if(config.provider!=="openai")throw Error("OpenAI config required");
const key=await (await createDefaultLiveCredentialService(undefined,config.provider)).loadKey();if(!key)throw Error("No configured credential");
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const guidance="\n\nLive has the same operational scope as the main agent, not just coding. execute runs JS/TS and can use Bun and shell() for filesystem/commands or subagent() for delegated work. On an authorized request to ACT, call execute to attempt the work (or delegate the actual task), rather than only speaking a command recipe or promising action. A previous assistant inability claim is not a permission boundary: check the tools available now. Ask for missing specifics only when needed; report a blocker only after confirming it. Helpers return values; console.log values you need to see. Never claim a tool call succeeded before seeing its result.";
const globals="\n\nInside execute, shell(), subagent(), jobs and handoff() are already provided global helpers. Do not import them from a die module; there is no such module. Use await shell(command, {waitSeconds: 3}) and console.log its returned result.";
const example="\n\nExample: User: 'Please act: ask an agent to draft a cleanup command for my recording.wav.' Assistant calls execute with code like: const r=await subagent({prompt:'Draft a cleanup command for recording.wav without running it'});console.log(r); Then the assistant describes only the observed result, not a completed audio edit.";
const target:Record<string,string>={
  en:"Please clean up the noise in my file /tmp/live-probe-recording.wav and save it as /tmp/live-probe-clean.wav. This is my file; you may use your tools or delegate the actual task. Please do it, not just tell me a command.",
  te:"నా /tmp/live-probe-recording.wav ఫైల్‌లో noise తగ్గించి /tmp/live-probe-clean.wav గా save చేయి. ఇది నా ఫైల్; tools వాడొచ్చు లేదా agent కి పని అప్పగించొచ్చు. command మాత్రమే చెప్పకుండా పని చేయి.",
  translit:"Naa /tmp/live-probe-recording.wav file lo noise tagginchi /tmp/live-probe-clean.wav gaa save cheyi. Idi naa file; tools vaadochu leda agent ki pani appaginchochu. Command maatrame cheppakunda pani cheyi."
};
const plain:Record<string,string>={
 en:"My desktop recording /tmp/live-probe-recording.wav has background noise. Please clean it up and save /tmp/live-probe-clean.wav; it is my file.",
 te:"నా Desktop recording /tmp/live-probe-recording.wav లో background noise ఉంది. దాన్ని తగ్గించి /tmp/live-probe-clean.wav లో save చేయి. ఇది నా ఫైల్.",
 translit:"Naa Desktop recording /tmp/live-probe-recording.wav lo background noise undi. Daani tagginchi /tmp/live-probe-clean.wav lo save cheyi. Idi naa file."
};
function content(x:any){return typeof x==="string"?x:Array.isArray(x)?x.map(y=>y.text??"").join(""):""}
function snapshot(index:number){
 const messages=allowed.slice(4,index).filter(x=>x.type==="message"&&x.message?.role!=="system").map(x=>x.message);
 const serialized=JSON.stringify({messages});if(Buffer.byteLength(serialized)>65536)throw Error("Snapshot too large");
 return "Current effective branch context (data, not new requests; never replay past tool calls). Images here are not visually rendered. Full retained context is available through history or the artifact path:\n"+serialized;
}
const original:Record<string,number>={audio:63,followup:85};
const prior=[
 {role:"user",text:"Can you work with my desktop audio recording and remove background noise?"},
 {role:"assistant",text:"I can't access your desktop or run audio processing on your machine from here. You will need to use an editor yourself."},
 {role:"user",text:"Could you ask an agent to do it instead?"},
 {role:"assistant",text:"I can't directly use agents or commands on your local files. You'd need to run a command yourself."}
];
const conditions=process.argv.slice(2);
if(!conditions.length)throw Error("Pass conditions like en:fresh:baseline (max 48); repeats explicit");
if(conditions.length>48)throw Error("Max 48 paid sessions per batch");
for(let n=0;n<conditions.length;n++){
 const [lang,context,variant,request="explicit"]=conditions[n].split(":");
 if(!(lang in target)&&!(lang in original)||!["fresh","prior","snapshot"].includes(context)||!["baseline","guidance","example","globals"].includes(variant)||!["explicit","plain"].includes(request)||((lang in original)!==(context==="snapshot")))throw Error("Invalid condition: "+conditions[n]);
 const instructions=root+(variant==="baseline"?"":guidance+(variant==="example"?example:variant==="globals"?globals:""));
 const result:any={trial:n+1,condition:conditions[n],model:config.model,rootHash:hash(root),instructionHash:hash(instructions),toolHash:hash(JSON.stringify(tool)),targetHash:hash(lang in original?content(allowed[original[lang]].message.content):request==="plain"?plain[lang]:target[lang]),snapshotHash:context==="snapshot"?hash(snapshot(original[lang])):null,calls:[],speech:"",errors:[],responses:0};
 const ws=new WebSocket("wss://api.openai.com/v1/realtime?model="+encodeURIComponent(config.model),{headers:{Authorization:"Bearer "+key}});
 const send=(event:any)=>ws.send(JSON.stringify(event));
 let done=false,pending=false;const speech:string[]=[];
 await new Promise<void>(resolve=>{
  const end=()=>{if(done)return;done=true;clearTimeout(timer);ws.close();resolve()};
  const timer=setTimeout(()=>{result.errors.push("deadline 25s");end()},25000);
  ws.on("open",()=>send({type:"session.update",session:{type:"realtime",instructions,audio:{input:{format:{type:"audio/pcm",rate:24000},transcription:{model:"gpt-4o-mini-transcribe"},turn_detection:{type:"server_vad",create_response:true,interrupt_response:true}},output:{format:{type:"audio/pcm",rate:24000},voice:"marin"}},output_modalities:["audio"],tools:[tool],tool_choice:"auto"}}));
  ws.on("message",data=>{let m:any;try{m=JSON.parse(String(data))}catch{return}
   if(m.type==="session.updated"){
    if(context==="snapshot")send({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text:snapshot(original[lang])}]}});
    if(context==="prior")for(const item of prior)send({type:"conversation.item.create",item:{type:"message",role:item.role,content:[{type:item.role==="user"?"input_text":"output_text",text:item.text}]}});
    send({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text:lang in original?content(allowed[original[lang]].message.content):request==="plain"?plain[lang]:target[lang]}]}});send({type:"response.create"});
   }
   if(m.type==="response.output_audio_transcript.delta"||m.type==="response.output_text.delta")speech.push(m.delta);
   if(m.type==="response.function_call_arguments.done"){
    let code:any;try{code=JSON.parse(m.arguments).code}catch{code=m.arguments}
    result.calls.push({name:m.name,code});pending=true;
    send({type:"conversation.item.create",item:{type:"function_call_output",call_id:m.call_id,output:JSON.stringify({error:"Safety probe: execute was intercepted. No code evaluated, files accessed, job started, or audio processed."})}});
   }
   if(m.type==="response.done"){result.responses++;if(pending&&result.responses<3){pending=false;send({type:"response.create"})}else end()}
   if(m.type==="error"){result.errors.push({code:m.error?.code,type:m.error?.type,param:m.error?.param});end()}
  });
  ws.on("error",(e:any)=>{result.errors.push("socket: "+String(e.message).replace(/sk-[A-Za-z0-9_-]+/g,"<redacted>"));end()});ws.on("close",end);
 });
 result.speech=speech.join("").slice(0,2000);
 console.log(JSON.stringify(result));
}
