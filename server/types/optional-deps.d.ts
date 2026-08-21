// Type stubs for optional dependencies that may not be installed.
// These are dynamically imported with .catch() fallbacks at runtime.
declare module "@sentry/node" {
  export function captureException(error: unknown, options?: Record<string, unknown>): string;
  export function captureMessage(message: string, level?: string): string;
}

declare module "ws" {
  import { Server as HttpServer } from "http";

  export class WebSocketServer {
    constructor(options: { server: HttpServer; path?: string });
    on(event: string, callback: (...args: any[]) => void): void;
  }

  export class WebSocket {
    static readonly OPEN: number;
    readyState: number;
    send(data: string): void;
    on(event: string, callback: (...args: any[]) => void): void;
  }
}
