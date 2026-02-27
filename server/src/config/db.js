const { Pool } = require("pg");

const pool = new Pool({
	host:     process.env.DB_HOST     || "localhost",
	port:     parseInt(process.env.DB_PORT || "5432", 10),
	database: process.env.DB_NAME     || "rag",
	user:     process.env.DB_USER     || "rag",
	password: process.env.DB_PASSWORD || "rag",
	connectionTimeoutMillis: 5000,  // fail fast if DB is unreachable
});

module.exports = pool;
