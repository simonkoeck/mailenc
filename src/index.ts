import { emailHandler } from "./email/handler.js";
import type { Env } from "./env.js";
import { route } from "./api/routes.js";

export { SessionDO } from "./session/do.js";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return await route(req, env);
  },
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    await emailHandler(message, env, ctx);
  },
} satisfies ExportedHandler<Env>;
