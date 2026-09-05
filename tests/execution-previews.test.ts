import { test, expect } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { foldedRows, executeInputPreview, executeOutputPreview, completionPreview } from "../src/ui/execution-previews";
const theme={fg:(_color:string,text:string)=>text} as any;
test("execute shows the input head and output tail with explicit ellipses", () => {
  const code=Array.from({length:30},(_,i)=>"INPUT_"+i).join("\n");
  const output=Array.from({length:30},(_,i)=>"OUTPUT_"+i).join("\n");
  const call=executeInputPreview(code,false,theme).render(100);
  expect(call).toHaveLength(5);
  expect(call.join("\n")).toContain("INPUT_0");
  expect(call.join("\n")).not.toContain("INPUT_10");
  expect(call.join("\n")).toContain("…");
  const result={content:[{type:"text",text:"Execution completed with exit code 0.\n\nstdout:\n"+output}],details:{stdout:output,stderr:""}};
  const rendered=executeOutputPreview(result,false,false,theme).render(100);
  expect(rendered).toHaveLength(7);
  expect(rendered[0]).toContain("completed");
  expect(rendered.join("\n")).toContain("OUTPUT_29");
  expect(rendered.join("\n")).not.toContain("OUTPUT_10");
  expect(executeInputPreview(code,true,theme).render(100).join("\n")).toContain("INPUT_10");
  expect(executeOutputPreview(result,true,false,theme).render(100).join("\n")).toContain("OUTPUT_10");
});
test("completion notifications collapse by rendered rows and expand unchanged", () => {
  const message="1 task completed\n"+Array.from({length:40},(_,i)=>"LINE_"+i).join("\n");
  const compact=completionPreview(message,false,theme).render(80);
  expect(compact).toHaveLength(7);
  expect(compact.join("\n")).toContain("…");
  expect(compact.join("\n")).not.toContain("LINE_20");
  expect(compact.join("\n")).toContain("LINE_39");
  expect(completionPreview(message,true,theme).render(80).join("\n")).toContain("LINE_20");
});
test("long single lines and narrow terminals stay bounded", () => {
  for(const width of [1,5,20,80]) {
    const lines=foldedRows("x".repeat(10000)+"END",width,2,3,false);
    expect(lines.length).toBeLessThanOrEqual(6);
    for(const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
  expect(foldedRows("text",0,3,3,false)).toEqual([]);
});
test("small results, errors, empty input, and images remain readable", () => {
  expect(foldedRows("short",80,3,3,false)).toEqual(["short"]);
  expect(executeInputPreview(undefined,false,theme).render(80)).toEqual(["Execute · TypeScript"]);
  const failure=executeOutputPreview({content:[{type:"text",text:"Execution failed\n\nstderr:\nERROR_LAST"}]},false,true,theme).render(80).join("\n");
  expect(failure).toContain("Execution failed");expect(failure).toContain("ERROR_LAST");
  const image=executeOutputPreview({content:[{type:"image"}],details:{stdout:"",stderr:"",images:[{}]}},false,false,theme).render(80).join("\n");
  expect(image).toContain("Images: 1");
});
test("terminal controls are stripped from previews and data is not mutated", () => {
  const text="safe\x1b[2J\x1b]0;bad\x07\nlast";
  const result={content:[{type:"text",text}]};const before=JSON.stringify(result);
  expect(executeOutputPreview(result,true,false,theme).render(80).join("\n")).not.toContain("\x1b");
  expect(JSON.stringify(result)).toBe(before);
});
