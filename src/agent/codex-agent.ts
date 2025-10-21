import { requireAccess } from "../lib/access";
import { bad, ok, unauthorized } from "../lib/util";
import { callChatCompletion } from "./utils/ai";
import { writeSystemLog } from "./utils/log";
import type { Env } from "../types";

interface CommandRequestBody {
  command?: string;
  args?: Record<string, unknown>;
}

const SUPPORTED_COMMANDS = ["status", "generate-cover"];

export async function handleCodexAgent(
  request: Request,
  env: Env,
  cors: Headers
): Promise<Response> {
  const access = await requireAccess(request, env);
  if (!access.authorized) {
    const headers = new Headers(cors);
    headers.set("WWW-Authenticate", 'Bearer realm="Cloudflare Access"');
    return unauthorized(headers);
  }

  let payload: CommandRequestBody;
  try {
    const body = (await request.json()) as CommandRequestBody;
    payload = body ?? {};
  } catch (_err) {
    return bad("INVALID_INPUT", 400, cors, "Request body must be JSON");
  }

  const command = typeof payload.command === "string" ? payload.command : "";
  const args = typeof payload.args === "object" && payload.args ? payload.args : {};

  if (!command) {
    return bad("INVALID_INPUT", 400, cors, "Provide command string");
  }

  let responseData: Record<string, unknown>;

  try {
    switch (command) {
      case "status":
        responseData = {
          service: env.SERVICE_NAME ?? "GoldShore Agent",
          model: env.AI_MODEL ?? "gpt-4o-mini",
          timestamp: new Date().toISOString(),
          public_admin: env.PUBLIC_ADMIN ?? null
        };
        break;
      case "generate-cover": {
        const role = typeof args.role === "string" && args.role.trim().length > 0 ? args.role.trim() : "an engineering role";
        const prompt = `Generate a concise, 3-sentence technical cover letter for ${role} using Robert Marston's profile skills. Focus on impact, automation, and Cloudflare expertise.`;
        const text = await callChatCompletion(env, [
          { role: "user", content: prompt }
        ]);
        responseData = { text };
        break;
      }
      default:
        return bad("UNKNOWN_COMMAND", 400, cors, `Supported commands: ${SUPPORTED_COMMANDS.join(", ")}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await writeSystemLog(env, {
      type: "codex-agent",
      command,
      status: "error",
      message,
      timestamp: new Date().toISOString()
    });
    return bad("COMMAND_FAILED", 502, cors, message);
  }

  const result = ok({ ok: true, command, data: responseData }, cors);

  await writeSystemLog(env, {
    type: "codex-agent",
    command,
    status: "ok",
    data: responseData,
    identity: access.identity ?? null,
    timestamp: new Date().toISOString()
  });

  return result;
}
