import { adminProcedure, router } from "../_core/trpc";
import { sdk } from "../_core/sdk";

export const terminalRouter = router({
  authorize: adminProcedure.query(async ({ ctx }) => {
    return {
      permitted: true,
      socketPath: "/api/terminal/socket" as const,
      terminalTicket: await sdk.createSessionToken(ctx.user.openId, {
        name: ctx.user.name || ctx.user.openId,
        expiresInMs: 15 * 60 * 1000,
      }),
    } as const;
  }),
});
