const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const hpp = require("hpp");
const routes = require("./routes/index");
const cron = require("./services/cron");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(hpp());

app.use(
	rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 1_000_00,
		standardHeaders: true,
		legacyHeaders: false,
	})
);

app.use("/", routes);

app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
	cron.startCron();
});
