/** Explicit paid, synthetic Live diagnostic. Run from repo root: bun wisdom/live/main-orchestrator-gemini-probe.ts --paid
 * Dependencies already installed by project; never install for this probe. No actual execute runtime or user jobs.
 * Output is sanitized event metadata; no key, private prompts, code, or raw provider frames.
 */
import { GoogleGenAI, Modality, Behavior } from "@google/genai";
import { createPromptPreview } from "../../src/prompt-preview";
import { createDefaultLiveCredentialService } from "../../src/live/credentials";
if (process.argv[2] !== "--paid") throw Error("Explicit --paid required");
const preview = await createPromptPreview({rootMode: "normal", message: "Synthetic diagnostic only."});
const execute = preview.tools.find(t => t.name === "execute");
if (preview.tools.length !== 1 || !execute) throw Error("Production preview was not execute-only");
const params = execute.parameters as Record<string, unknown>;
console.log(JSON.stringify({event:"offline_preview", promptChars:preview.systemPrompt.length, toolDescriptionChars:execute.description.length, parameterKeys:Object.keys(params.properties as object), required:params.required, additionalProperties:params.additionalProperties, excluded:preview.preview.excluded.length}));
let key: string;
try { key = await (await createDefaultLiveCredentialService()).loadKey(); } catch { console.log(JSON.stringify({event:"credential_unavailable",source:"existing app credential loader",provider:"google"})); process.exit(0); }
const events: Record<string,unknown>[] = [];
const log = (event:string, detail:Record<string,unknown>={}) => {const row={event,...detail}; events.push(row); console.log(JSON.stringify(row));};
let session: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | undefined;
let count=0, turns=0, audioChunks=0, markerSeen=false;
let done: (()=>void) | undefined;
const wake=()=>{done?.(); done=undefined;};
const wait=(ms:number)=>new Promise<void>(resolve=>{const timer=setTimeout(()=>{done=undefined; resolve()},ms); done=()=>{clearTimeout(timer);resolve()}});
const deadline=setTimeout(()=>{log("deadline");session?.close();wake()},25000);
try {
 session=await new GoogleGenAI({apiKey:key}).live.connect({model:"gemini-3.8-live",config:{systemInstruction:preview.systemPrompt,responseModalities:[Modality.AUDIO],inputAudioTranscription:{},outputAudioTranscription:{},tools:[{functionDeclarations:[{name:"execute",description:execute.description,parametersJsonSchema:params,behavior:Behavior.NON_BLOCKING}]}]},callbacks:{
 onopen:()=>log("socket_open"),onerror:()=>{log("socket_error");wake()},onclose:(e)=>{log("socket_close",{code:e.code});wake()},
 onmessage:(m)=>{
  if(m.setupComplete)log("setup_complete");
  if(m.toolCall?.functionCalls)for(const call of m.toolCall.functionCalls){
   count++; const code=call.args?.code;
   log("tool_call",{idPresent:!!call.id,name:call.name,codeType:typeof code,codeChars:typeof code==="string"?code.length:0});
   // Deliberately DO NOT evaluate generated code. This is a synthetic delayed result, not die's execute runtime.
   setTimeout(()=>{try{session?.sendToolResponse({functionResponses:[{id:call.id,name:call.name??"execute",response:{result:"Synthetic fixture ORBIT-17: no code ran and no job exists."},scheduling:"WHEN_IDLE" as any}]});log("simulated_tool_response",{idPresent:!!call.id});wake()}catch{log("tool_response_error");wake()}},1100);
  }
  if(m.serverContent?.modelTurn?.parts)for(const part of m.serverContent.modelTurn.parts){if(part.inlineData) audioChunks++; if(part.text)log("model_text",{chars:part.text.length});}
  if(m.serverContent?.outputTranscription?.text){const text=m.serverContent.outputTranscription.text; markerSeen ||= /orbit[ -]?17/i.test(text); log("output_transcription",{chars:text.length,syntheticMarkerSeen:markerSeen});}
  if(m.serverContent?.turnComplete){turns++;log("turn_complete",{turns,audioChunks});wake()}
 }
 }});
 log("connected");
 session.sendClientContent({turns:[{role:"user",parts:[{text:"Synthetic test: use execute to compute 2+3, then tell me the result you actually got. Do not claim execution if only a fixture responded."}]}],turnComplete:true});
 await wait(800);
 log("before_followup",{calls:count,turns,audioChunks});
 session.sendClientContent({turns:[{role:"user",parts:[{text:"Synthetic follow-up: are you still responsive? Reply briefly; distinguish any simulated tool result from actual execution."}]}],turnComplete:true});
 await wait(9500);
 log("final",{calls:count,turns,audioChunks,syntheticMarkerSeen:markerSeen});
} catch(e){log("failure",{kind:e instanceof Error?e.name:"unknown"});} finally {clearTimeout(deadline);session?.close();}
