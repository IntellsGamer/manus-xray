import { writeFile } from "node:fs/promises";
import { getVlessProfile, listGatewayClients } from "./server/db";
import { clientWebSocketPaths, gatewayWebSocketPaths, shadowsocks2022Method } from "./server/vless";

function clientConfig(address: string, port: number, path: string, password: string, socksPort: number) {
  return {
    log: { loglevel: "warning" },
    inbounds: [{ listen: "127.0.0.1", port: socksPort, protocol: "socks", settings: { auth: "noauth", udp: false } }],
    outbounds: [{
      protocol: "shadowsocks",
      settings: { servers: [{ address, port, method: shadowsocks2022Method, password }] },
      streamSettings: { network: "ws", security: "tls", tlsSettings: { serverName: address }, wsSettings: { path, headers: { Host: address } } },
    }],
  };
}

const profile = await getVlessProfile();
if (!profile) throw new Error("Gateway profile was not found");
const named = (await listGatewayClients()).find(client => client.enabled);
if (!named) throw new Error("No enabled named client was found");
const globalPath = gatewayWebSocketPaths(profile).shadowsocks;
const namedPath = clientWebSocketPaths(profile, named).shadowsocks;
await writeFile("/tmp/xray-production-ss-global.json", JSON.stringify(clientConfig(profile.serverAddress, profile.port, globalPath, `${profile.shadowsocksServerKey}:${profile.shadowsocksUserKey}`, 14080), null, 2));
await writeFile("/tmp/xray-production-ss-named.json", JSON.stringify(clientConfig(profile.serverAddress, profile.port, namedPath, `${profile.shadowsocksServerKey}:${named.shadowsocksUserKey}`, 14081), null, 2));
await writeFile("/tmp/xray-production-vless-control.json", JSON.stringify({
  log: { loglevel: "warning" },
  inbounds: [{ listen: "127.0.0.1", port: 14082, protocol: "socks", settings: { auth: "noauth", udp: false } }],
  outbounds: [{
    protocol: "vless",
    settings: { vnext: [{ address: profile.serverAddress, port: profile.port, users: [{ id: profile.uuid, encryption: "none" }] }] },
    streamSettings: { network: "ws", security: "tls", tlsSettings: { serverName: profile.serverAddress }, wsSettings: { path: gatewayWebSocketPaths(profile).vless, headers: { Host: profile.serverAddress } } },
  }],
}, null, 2));
process.exit(0);
