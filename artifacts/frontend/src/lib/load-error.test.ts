import { expect, it } from "vitest";
import { LoadError, loadErrorFrom, loadErrorHint } from "./load-error";

it("says when the server doesn't have the feature yet", () => {
  expect(loadErrorHint(new LoadError("Not Found", 404))).toMatch(/needs redeploying/);
});

it("passes on the server's own message for server errors", async () => {
  const res = new Response(JSON.stringify({ detail: "Billing figures couldn't be loaded." }), { status: 502 });
  const error = await loadErrorFrom(res);
  expect(error.status).toBe(502);
  expect(loadErrorHint(error)).toBe("Server error (502): Billing figures couldn't be loaded.");
});

it("keeps a bare server error short", async () => {
  const error = await loadErrorFrom(new Response("oops", { status: 500 }));
  expect(loadErrorHint(error)).toBe("Server error (500).");
});

it("recognises a network failure", () => {
  expect(loadErrorHint(new TypeError("Failed to fetch"))).toMatch(/Couldn't reach the server/);
});
