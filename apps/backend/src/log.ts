import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const log = pino({
	level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
	serializers: { err: pino.stdSerializers.err },
	redact: {
		paths: [
			"req.headers.authorization",
			"req.headers.cookie",
			'res.headers["set-cookie"]',
			...[
				"password",
				"secret",
				"token",
				"apiKey",
				"authorization",
				"cookie",
				"stripeSecretKey",
				"webhookSecret",
				"smtpPass",
				"umamiPassword",
				"client_secret",
				"payment_method",
			].flatMap((field) => [field, `*.${field}`]),
		],
		censor: "[redacted]",
	},
	...(isProduction
		? {}
		: {
				transport: {
					target: "pino-pretty",
					options: { colorize: true, ignore: "pid,hostname" },
				},
			}),
});
