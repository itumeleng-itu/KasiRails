import { networkInterfaces } from 'node:os';

const VIRTUAL_ADAPTER = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|Loopback|Bluetooth/i;

/** This machine's IPv4 LAN addresses, real adapters (e.g. Wi-Fi) first. */
export function lanAddresses(): string[] {
  const found: { ip: string; virtual: boolean }[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      found.push({ ip: a.address, virtual: VIRTUAL_ADAPTER.test(name) });
    }
  }
  return found.sort((a, b) => Number(a.virtual) - Number(b.virtual)).map((f) => f.ip);
}

/** The URL phones should use to reach this server: PUBLIC_URL if set, else the first LAN address. */
export function publicUrl(port: number, configured?: string): string {
  if (configured) return configured.replace(/\/+$/, '');
  const [ip] = lanAddresses();
  return `http://${ip ?? 'localhost'}:${port}`;
}
