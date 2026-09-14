import { isCompiledInvocation } from "../src/update";

console.log(JSON.stringify({ url: import.meta.url, compiled: isCompiledInvocation() }));
