import { connect } from "node:tls";
import { result, type CheckResult } from "../types.ts";

/** Days until the certificate of `host:443` expires. */
export function certificateDaysLeft(host: string, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: 443, servername: host, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert?.valid_to) return reject(new Error("no certificate"));
      resolve((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
    });
    socket.on("timeout", () => socket.destroy(new Error("TLS timeout")));
    socket.on("error", reject);
  });
}

/** Certificates renew automatically on Vercel; this catches a broken renewal early (NFR availability). */
export function checkCertificate(host: string, daysLeft: number): CheckResult {
  const days = Math.floor(daysLeft);
  const ref = "NFR availability";
  if (days < 7) return result(`tls.${host}`, "fail", `certificate expires in ${days} days`, { ref, target: host });
  if (days < 14) return result(`tls.${host}`, "warn", `certificate expires in ${days} days`, { ref, target: host });
  return result(`tls.${host}`, "pass", `${days} days left`, { ref, target: host });
}
