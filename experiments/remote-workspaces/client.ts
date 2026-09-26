import { connectUnixTestClient } from "@earendil-works/pi-server/testing";
import { identityCode, finishCode } from "./scenario";
export const serverId = "3414a9f1-78cf-4986-a48e-8adca1f06b4e";
export async function attach(socket: string) {
  const client = await connectUnixTestClient(socket);
  await client.hello();
  const response = await client.attach(serverId, "workspace");
  unwrap(response);
  return client;
}
function unwrap(response: any): any {
  if (response.error) throw Error(JSON.stringify(response.error));
  return response.result;
}
export async function call(client: Awaited<ReturnType<typeof attach>>, member: string, args: any[] = []) {
  return unwrap(await client.requestSessionService(serverId, "workspace", { serviceId: "probe", member, args }));
}
export async function detach(client: Awaited<ReturnType<typeof attach>>) {
  unwrap(await client.requestService({ serverId }, { serviceId: "pi.session-management", member: "detach", args: [] }));
  await client.close();
}
if (import.meta.main) {
  const [socket, command, id = "B-turn-1"] = process.argv.slice(2);
  const client = await attach(socket!);
  try {
    const member = command === "start-B" || command === "finish-B" ? "execute" : command!;
    const args =
      command === "start-B"
        ? [id, identityCode]
        : command === "finish-B"
          ? [id, finishCode("B")]
          : command === "inspect"
            ? [id]
            : [];
    console.log(JSON.stringify(await call(client, member, args), null, 2));
  } finally {
    await detach(client);
  }
}
