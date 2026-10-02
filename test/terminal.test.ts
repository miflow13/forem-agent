import assert from "node:assert/strict";
import test from "node:test";
import { describeError } from "../src/ui/terminal.js";

test("describeError surfaces the network cause hidden behind fetch failed", () => {
  const error = new TypeError("fetch failed", {
    cause: new Error("connect ECONNREFUSED 127.0.0.1:9"),
  });

  assert.equal(
    describeError(error),
    "fetch failed (connect ECONNREFUSED 127.0.0.1:9)",
  );
});

test("describeError falls back to a cause code and avoids repeating details", () => {
  const coded = Object.assign(new Error(""), { code: "ENOTFOUND" });
  assert.equal(
    describeError(new Error("fetch failed", { cause: coded })),
    "fetch failed (ENOTFOUND)",
  );

  assert.equal(
    describeError(
      new Error("Request failed: timeout", { cause: new Error("timeout") }),
    ),
    "Request failed: timeout",
  );
  assert.equal(describeError(new Error("plain")), "plain");
  assert.equal(describeError("not an error"), "not an error");
});
