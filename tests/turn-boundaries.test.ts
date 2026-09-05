import {test,expect} from "bun:test";
import {yieldedEntries} from "./turn-boundaries";
const assistant={type:"message",timestamp:"2026-01-01T00:00:00Z",message:{role:"assistant",stopReason:"toolUse",content:[{type:"toolCall",id:"a"},{type:"toolCall",id:"b"}]}};
const result=(id:string,yielded:boolean,second:number,isError=false)=>({type:"message",timestamp:"2026-01-01T00:00:0"+second+"Z",message:{role:"toolResult",toolCallId:id,isError,details:yielded?{handoff:"Progress"}:{}}});
test("only a complete all-yield batch is a control boundary",()=>{
  const a=result("a",true,1), b=result("b",true,2);
  expect(yieldedEntries([assistant,a])).toEqual([]);
  expect(yieldedEntries([assistant,a,result("b",false,2)])).toEqual([]);
  expect(yieldedEntries([assistant,a,result("b",true,2,true)])).toEqual([]);
  expect(yieldedEntries([assistant,a,b])).toEqual([b]);
  const stop={type:"message",message:{role:"assistant",stopReason:"stop",content:[]}};
  expect(yieldedEntries([stop])).toEqual([stop]);
});
