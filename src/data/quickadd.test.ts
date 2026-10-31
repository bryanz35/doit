import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuickAdd } from "./quickadd.ts";

const TODAY = "2026-10-30"; // a Friday

test("sigils fan out and the rest is the title", () => {
  const q = parseQuickAdd("ship it @fri #api #api /Work =1h30m", TODAY);
  assert.equal(q.title, "ship it");
  assert.equal(q.due, "2026-11-06"); // next Friday, strictly after today
  assert.deepEqual(q.tags, ["api"]);
  assert.equal(q.list, "Work");
  assert.equal(q.estimateMinutes, 90);
});

test("no @ means today, @someday means unscheduled", () => {
  assert.equal(parseQuickAdd("a", TODAY).due, TODAY);
  assert.equal(parseQuickAdd("a @someday", TODAY).due, null);
});

test("day offsets cross month ends", () => {
  assert.equal(parseQuickAdd("a @+3", TODAY).due, "2026-11-02");
  assert.equal(parseQuickAdd("a @tomorrow", "2026-12-31").due, "2027-01-01");
});

test("unknown sigils are reported, not kept in the title", () => {
  const q = parseQuickAdd("a @tmrrw =abc", TODAY);
  assert.equal(q.title, "a");
  assert.deepEqual(q.unknown, ["@tmrrw", "=abc"]);
});
