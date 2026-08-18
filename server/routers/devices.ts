import { z } from "zod";
import { COOKIE_NAME, DEVICE_COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { adminProcedure, router } from "../_core/trpc";
import { listOwnerDevices, revokeAllOwnerDevices, revokeOwnerDevice, updateOwnerDeviceCountry } from "../db";

function clearSessionCookies(ctx: { req: Parameters<typeof getSessionCookieOptions>[0]; res: { clearCookie: (name: string, options: object) => unknown } }) {
  const options = getSessionCookieOptions(ctx.req);
  ctx.res.clearCookie(COOKIE_NAME, { ...options, maxAge: -1 });
  ctx.res.clearCookie(DEVICE_COOKIE_NAME, { ...options, maxAge: -1 });
}

export const devicesRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const devices = await listOwnerDevices(ctx.user.openId);
    return {
      devices: devices.map(({ deviceToken: _deviceToken, ...device }) => device),
      currentDeviceId: devices.find(device => device.deviceToken === ctx.user.deviceToken)?.id ?? null,
    };
  }),
  reportCountry: adminProcedure.input(z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/).refine(value => value !== "XX" && value !== "T1") })).mutation(async ({ ctx, input }) => {
    if (!ctx.user.deviceToken) return { success: false } as const;
    await updateOwnerDeviceCountry(ctx.user.openId, ctx.user.deviceToken, input.countryCode);
    return { success: true } as const;
  }),
  remove: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const devices = await listOwnerDevices(ctx.user.openId);
    const removed = devices.find(device => device.id === input.id);
    await revokeOwnerDevice(ctx.user.openId, input.id);
    if (removed?.deviceToken === ctx.user.deviceToken) clearSessionCookies(ctx);
    return { success: true } as const;
  }),
  removeAll: adminProcedure.mutation(async ({ ctx }) => {
    await revokeAllOwnerDevices(ctx.user.openId);
    clearSessionCookies(ctx);
    return { success: true } as const;
  }),
});
