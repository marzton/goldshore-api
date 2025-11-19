import { z } from "zod";

/**
 * Core domain schemas
 */

export const UserId = z.string().uuid();
export const ProjectId = z.string().uuid();

export const User = z.object({
  id: UserId,
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(["admin", "client"]),
  createdAt: z.string().datetime(),
});

export const Project = z.object({
  id: ProjectId,
  name: z.string().min(1),
  status: z.enum(["draft", "active", "archived"]),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof User>;
export type Project = z.infer<typeof Project>;
