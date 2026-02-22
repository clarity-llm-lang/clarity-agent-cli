import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  answerQuestion,
  cancelQuestion,
  listQuestions,
  readQuestionState,
  submitQuestion,
  toSafeKey
} from "../pkg/hitl/broker.js";

test("broker question lifecycle (file mode)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-agent-cli-broker-"));
  const env = {
    ...process.env,
    CLARITY_HITL_DIR: "hitl"
  };
  const options = { env, cwd: root };

  assert.equal(toSafeKey("review step 3"), "review_step_3");

  const created = await submitQuestion(
    {
      key: "review-step-3",
      question: "Does this look correct?",
      timestamp: 1708608000000,
      pid: 12345
    },
    options
  );

  assert.match(created.path, /review-step-3\.question$/);

  const listed = await listQuestions(options);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].key, "review-step-3");
  assert.equal(listed[0].answered, false);

  await answerQuestion("review-step-3", "Looks good", options);

  const answeredState = await readQuestionState("review-step-3", options);
  assert.equal(answeredState.status, "answered");
  assert.equal(answeredState.response, "Looks good");

  const cancelled = await cancelQuestion("review-step-3", options);
  assert.equal(cancelled.removed, true);

  const missingState = await readQuestionState("review-step-3", options);
  assert.equal(missingState.status, "missing");
});
