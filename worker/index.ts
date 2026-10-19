import { Hono } from "hono";
import type { AppBindings, Env } from "./env.ts";
import { ApiError, fail } from "./lib/http.ts";
import { csrf, loadSession, requestContext } from "./middleware/index.ts";
import { publicRoutes } from "./routes/public.ts";
import { accountRoutes } from "./routes/account.ts";
import { adminRoutes } from "./routes/admin.ts";
import { scheduledRefresh } from "./services/sports/ingestion.ts";

export const app = new Hono<AppBindings>();

app.use("/api/*", requestContext);
app.use("/api/*", csrf);
app.use("/api/*", loadSession);

const v1 = new Hono<AppBindings>();
v1.route("/", publicRoutes);
v1.route("/", accountRoutes);
v1.route("/admin", adminRoutes);
app.route("/api/v1", v1);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return fail(c, new ApiError(404, "NOT_FOUND", "Endpoint not found."));
  return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text("Not found", 404);
});

app.onError((err, c) => {
  if (err instanceof ApiError) return fail(c, err);
  // Never leak internals or secrets; log a sanitised message with the request id.
  console.error(JSON.stringify({ level: "error", request_id: c.get("requestId"), path: c.req.path, message: String(err?.message ?? err).slice(0, 300) }));
  return fail(c, new ApiError(500, "INTERNAL", "Something went wrong. Please try again."));
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      scheduledRefresh(env).then((r) => console.log(JSON.stringify({ level: "info", cron: "ingestion", result: r }))),
    );
  },
} satisfies ExportedHandler<Env>;
