#!/usr/bin/env node
import { buildReviewRequest, normalizeOptions, parseArgs, writeReviewPacket } from "./quality_llm_common.mjs";

async function main() {
  const options = normalizeOptions(parseArgs());
  const review = await buildReviewRequest(options);

  if (!review.request.reviewedTargetCount) {
    console.log(
      `No LLM review targets for env=${review.request.env}, scope=${review.request.scope}. ` +
        "Default scope only reviews changed production topic files.",
    );
    return;
  }

  const paths = await writeReviewPacket(review);
  console.log(`LLM review packet created:`);
  console.log(`- request: ${paths.markdownPath}`);
  console.log(`- data: ${paths.jsonPath}`);
  console.log(`- expected report: ${paths.reportPath}`);
  console.log("");
  console.log("Run an external non-interactive review CLI, for example:");
  console.log(`  npm run quality:llm:run -- --env=${options.env} --scope=${options.scope} --cli <qwen|claude|gemini|opencode>`);
  console.log("Or ask your local CLI/agent to read the request file and write the JSON report.");
  console.log(`After review, stage the report file and run: npm run quality:llm:verify -- --env=${options.env} --scope=${options.scope}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
