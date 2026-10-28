/**
 * Conservative controls for the optional SDK live tail.
 *
 * Hideki can keep the WebSocket connection alive while its historical
 * eth_getLogs path is unavailable. The SDK cannot safely hydrate a stale tail
 * in that state, so recovery must be bounded and must not turn into a tight
 * reconnect loop.
 */
export const sdkMaxIndexerLagBlocks=2_000n;
export const sdkRecoveryBaseMs=30_000;
export const sdkRecoveryMaxMs=5*60_000;

export function sdkIndexerLagIsAcceptable(lagBlocks:bigint|null) {
  return lagBlocks!==null&&lagBlocks>=0n&&lagBlocks<=sdkMaxIndexerLagBlocks;
}

export function sdkRecoveryDelayMs(failures:number) {
  const exponent=Math.max(0,Math.min(Math.floor(failures)-1,4));
  return Math.min(sdkRecoveryMaxMs,sdkRecoveryBaseMs*2**exponent);
}
