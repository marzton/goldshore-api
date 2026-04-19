import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { User } from "@goldshore/schema";
import type { Env } from "./types";

export const createApp = (env: Env) => {
  const app = new OpenAPIHono<{ Bindings: Env }>();

  // OpenAPI JSON endpoint
  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "GoldShore API",
      version: "0.1.0",
    },
    servers: [{ url: env.API_PUBLIC_URL }],
  });


  // Example: GET /users/:id
  const getUserRoute = createRoute({
    method: "get",
    path: "/users/{id}",
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ example: "d290f1ee-6c54-4b01-90e6-d701748f0851" })
      })
    },
    responses: {
      200: {
        description: "User found",
        content: {
          "application/json": {
            schema: z.custom<User>().openapi("User")
          }
        }
      },
      404: {
        description: "User not found"
      }
    }
  });

  app.openapi(getUserRoute, async c => {
    const id = c.req.param("id");
    // ... fetch from KV/DB
    const user: User = {
      id,
      email: "test@example.com",
      name: "Test User",
      role: "admin",
      createdAt: new Date().toISOString()
    };
    return c.json(user);
  });

  return app;
}
