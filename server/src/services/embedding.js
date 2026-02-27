const ENABLE_EMBEDDINGS = process.env.ENABLE_EMBEDDINGS === "true";

let _pipeline = null;

async function getPipeline() {
	if (_pipeline) return _pipeline;
	const { pipeline } = await import("@huggingface/transformers");
	_pipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
	return _pipeline;
}

/**
 * Generate a 384-dim embedding for a single text string.
 * Returns an array of numbers, or null if embeddings are disabled.
 */
async function generateEmbedding(text) {
	if (!ENABLE_EMBEDDINGS) return null;
	const pipe = await getPipeline();
	const output = await pipe(text, { pooling: "mean", normalize: true });
	return Array.from(output.data);
}

/**
 * Generate embeddings for multiple texts in a batch.
 * Returns an array of (array or null) in the same order.
 */
async function generateEmbeddings(texts) {
	if (!ENABLE_EMBEDDINGS) return texts.map(() => null);
	const pipe = await getPipeline();
	const results = [];
	for (const text of texts) {
		const output = await pipe(text, { pooling: "mean", normalize: true });
		results.push(Array.from(output.data));
	}
	return results;
}

/**
 * Convert a raw embedding array to a pgvector literal string, e.g. "[0.1,0.2,...]".
 * Returns null if embedding is null.
 */
function pgVector(embedding) {
	if (!embedding) return null;
	return `[${embedding.join(",")}]`;
}

module.exports = { generateEmbedding, generateEmbeddings, pgVector };
