import { SignJWT } from "jose";
import WebSocket from "ws";

const host = "nginxadmin-kw4zek2d.manus.space";
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const now = Math.floor(Date.now() / 1000);
const ticket = await new SignJWT({
  openId: process.env.OWNER_OPEN_ID,
  appId: process.env.VITE_APP_ID,
  name: "terminal-probe",
})
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setIssuedAt(now)
  .setExpirationTime(now + 60)
  .sign(secret);

const websocket = new WebSocket(`wss://${host}/api/terminal/socket?terminalTicket=${encodeURIComponent(ticket)}`, {
  origin: `https://${host}`,
});

const timeout = setTimeout(() => {
  console.error("terminal WebSocket probe timed out");
  websocket.terminate();
  process.exitCode = 1;
}, 10_000);

websocket.once("message", raw => {
  clearTimeout(timeout);
  const frame = JSON.parse(String(raw));
  if (frame.type !== "ready") {
    console.error("terminal WebSocket did not send a ready frame");
    process.exitCode = 1;
  } else {
    console.log("terminal WebSocket ticket handshake succeeded");
  }
  websocket.close();
});

websocket.once("error", error => {
  clearTimeout(timeout);
  console.error(`terminal WebSocket probe failed: ${error.message}`);
  process.exitCode = 1;
});
