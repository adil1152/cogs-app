import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { INVALID_PROFILE_MESSAGE, validateAuthProfile } from "../lib/auth-profile";

const validUser = {
  id: "legacy-fixture",
  email: "valid@example.com",
  firstName: "Test",
  lastName: null,
  mobile: null,
  profileImageUrl: null,
  role: "user",
};

test("profile response validation returns controlled HTTP errors without mutating data", async () => {
  let user: unknown = validUser;
  const app = express();
  app.get("/auth/user", (_req, res) => {
    const response = validateAuthProfile(user, res);
    if (response) res.json(response);
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/auth/user`;
  try {
    for (const [field, value] of [
      ["email", "invalid-private-value"],
      ["email", ""],
      ["email", 123],
      ["firstName", {}],
      ["lastName", 123],
      ["mobile", []],
      ["profileImageUrl", false],
      ["role", "unknown"],
      ["id", null],
      ["email", undefined],
    ] as const) {
      user = Object.freeze({ ...validUser, [field]: value });
      const before = JSON.stringify(user);
      const response = await fetch(url);
      assert.equal(response.status, 409, field);
      assert.deepEqual(await response.json(), { error: INVALID_PROFILE_MESSAGE });
      assert.equal(JSON.stringify(user), before, "must not repair stored values");
    }
    for (const account of [
      validUser,
      { ...validUser, role: "admin" },
      { ...validUser, email: null, firstName: null },
      { ...validUser, mobile: "+1 free-form", profileImageUrl: "legacy-path" },
      null,
    ]) {
      user = account;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { user: account });
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});