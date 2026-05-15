import type { Env } from "../env.js";
import { handleIncoming } from "./pipeline.js";

export async function emailHandler(
  message: ForwardableEmailMessage,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  ctx.waitUntil(
    (async () => {
      try {
        await handleIncoming(message, env);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error("email pipeline failed:", reason);
      }
    })()
  );
}
