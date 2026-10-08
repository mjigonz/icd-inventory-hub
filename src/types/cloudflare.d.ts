/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

declare module 'cloudflare:node' {
  export function httpServerHandler(
    server: any
  ): {
    fetch: (request: Request, env?: any, ctx?: any) => Promise<Response>;
  } & ((request: Request, env?: any, ctx?: any) => Promise<Response>);
}

interface WorkerEnv {
  DB: import('../db/d1Types').D1Database;
  ASSETS?: {
    fetch: (request: Request | string, init?: RequestInit) => Promise<Response>;
  };
  [key: string]: any;
}

type Env = WorkerEnv;
