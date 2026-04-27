import { describe, expect, it } from "vitest";
import { ok, bad, unauthorized, notFound, serverError } from "./util";

describe("util responses", () => {
  describe("ok", () => {
    it("returns a 200 response with JSON data", async () => {
      const data = { foo: "bar" };
      const res = ok(data);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
      expect(await res.json()).toEqual(data);
    });

    it("includes custom headers", () => {
      const res = ok({}, { "X-Custom": "value" });
      expect(res.headers.get("X-Custom")).toBe("value");
    });
  });

  describe("bad", () => {
    it("returns a 400 response by default", async () => {
      const res = bad("error message");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "error message" });
    });

    it("returns a custom status code", () => {
      const res = bad("error message", 422);
      expect(res.status).toBe(422);
    });

    it("includes custom headers", () => {
      const res = bad("error", 400, { "X-Error": "true" });
      expect(res.headers.get("X-Error")).toBe("true");
    });
  });

  describe("unauthorized", () => {
    it("returns a 401 response", async () => {
      const res = unauthorized();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "UNAUTHORIZED" });
    });
  });

  describe("notFound", () => {
    it("returns a 404 response with plain text", async () => {
      const res = notFound();
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    });

    it("includes custom headers", () => {
      const res = notFound({ "X-Not-Found": "true" });
      expect(res.headers.get("X-Not-Found")).toBe("true");
    });
  });

  describe("serverError", () => {
    it("returns a 500 response with error message from Error object", async () => {
      const res = serverError(new Error("something went wrong"));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ ok: false, error: "something went wrong" });
    });

    it("returns a 500 response with default message for unknown error type", async () => {
      const res = serverError("string error");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ ok: false, error: "Internal Error" });
    });

    it("includes custom headers", () => {
      const res = serverError(new Error("error"), { "X-Server-Error": "true" });
      expect(res.headers.get("X-Server-Error")).toBe("true");
    });
  });
});
