/**
 * AI dispatch abstraction.
 *
 * Local:  spawns the `claude` CLI subprocess (claude -p "prompt").
 * Cloud:  TODO — replace callCloud() with Claude API call.
 *
 * Set AI_MODE=cloud to switch (cloud throws until implemented).
 * Set AI_MODEL to override the model (default: claude-haiku-4-5-20251001).
 */

const { spawnSync } = require("child_process");

const AI_MODE       = process.env.AI_MODE    || "local";
const AI_MODEL      = process.env.AI_MODEL   || "claude-haiku-4-5-20251001";
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || "60000", 10);

/**
 * Call the AI with a plain-text prompt and return the text response.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function callAI(prompt) {
	if (AI_MODE === "local") {
		return callLocal(prompt);
	}
	// TODO: Cloud dispatch
	// return callCloud(prompt);
	throw new Error(`AI_MODE "${AI_MODE}" not implemented. Only "local" is supported.`);
}

function callLocal(prompt) {
	const args = ["-p", prompt];
	if (AI_MODEL) args.push("--model", AI_MODEL);
	const result = spawnSync("claude", args, {
		encoding: "utf8",
		timeout: AI_TIMEOUT_MS,
		maxBuffer: 10 * 1024 * 1024,
	});

	if (result.error) {
		throw new Error(`Failed to spawn claude subprocess: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`claude subprocess exited with code ${result.status}: ${result.stderr?.trim()}`
		);
	}

	return result.stdout.trim();
}

// TODO: Cloud dispatch
// async function callCloud(prompt) {
//   const Anthropic = require("@anthropic-ai/sdk");
//   const client = new Anthropic();
//   const message = await client.messages.create({
//     model: AI_MODEL || "claude-haiku-4-5-20251001",
//     max_tokens: 1024,
//     messages: [{ role: "user", content: prompt }],
//   });
//   return message.content[0].text;
// }

module.exports = { callAI };
