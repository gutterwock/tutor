/**
 * Lightweight wrapper around the tutor.ai REST API.
 * All MCP tools use this instead of connecting to the database directly.
 *
 * Configure with API_URL env var (default: http://localhost:3000).
 */

const API_URL = (process.env.API_URL || "http://localhost:3000").replace(/\/$/, "");

async function apiFetch(method, path, body) {
	const opts = {
		method,
		headers: { "Content-Type": "application/json" },
	};
	if (body !== undefined) opts.body = JSON.stringify(body);

	const res = await fetch(`${API_URL}${path}`, opts);
	const text = await res.text();

	let data;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`API ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
	}

	if (!res.ok) {
		throw new Error(data?.error ?? `API ${method} ${path} → ${res.status}`);
	}

	return data;
}

const api = {
	get:    (path)        => apiFetch("GET",    path),
	post:   (path, body)  => apiFetch("POST",   path, body),
	patch:  (path, body)  => apiFetch("PATCH",  path, body),
	delete: (path)        => apiFetch("DELETE", path),
};

module.exports = api;
