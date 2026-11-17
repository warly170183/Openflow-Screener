import { InternalScreenerService } from "./screenerService";

export type ScreenerRuntime = InternalScreenerService;

const globalForScreener = globalThis as typeof globalThis & {
  __orderflowScreenerRuntime?: InternalScreenerService;
};

export function getScreenerServiceInstance(): InternalScreenerService {
  if (!globalForScreener.__orderflowScreenerRuntime) {
    globalForScreener.__orderflowScreenerRuntime = new InternalScreenerService();
  }
  return globalForScreener.__orderflowScreenerRuntime;
}

export async function getScreenerRuntime(): Promise<InternalScreenerService> {
  const service = getScreenerServiceInstance();
  await service.ready;
  return service;
}
