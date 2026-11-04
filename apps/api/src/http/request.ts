import type { Request } from 'express';

export function requestIp(req: Request): string | undefined {
  return req.ip || req.socket.remoteAddress;
}

export function requestUserAgent(req: Request): string | undefined {
  const value = req.get('user-agent');
  return value ? value.slice(0, 512) : undefined;
}
