import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { createClientPolicyTemplate, deleteClientPolicyTemplate, listClientPolicyTemplates, updateClientPolicyTemplate } from "../db";

const speedLimitInput = z.number().int().min(-1).max(100_000).refine(value => value === -1 || value >= 1, "Speed limit must be -1 or at least 1 Mbps");
const connectionLimitInput = z.number().int().min(-1).max(10_000).refine(value => value === -1 || value >= 1, "Connection limit must be -1 or at least 1");
const policyTemplateInput = z.object({
  name: z.string().trim().min(1).max(120),
  trafficLimitBytes: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  dayLimit: z.number().int().min(-1).max(3650),
  speedLimitMbps: speedLimitInput,
  connectionLimit: connectionLimitInput,
});

export const templatesRouter = router({
  list: adminProcedure.query(() => listClientPolicyTemplates()),
  create: adminProcedure.input(policyTemplateInput).mutation(({ input }) => createClientPolicyTemplate(input)),
  update: adminProcedure.input(policyTemplateInput.extend({ id: z.number().int().positive() })).mutation(({ input }) => {
    const { id, ...policy } = input;
    return updateClientPolicyTemplate(id, policy);
  }),
  remove: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    await deleteClientPolicyTemplate(input.id);
    return { success: true } as const;
  }),
});
