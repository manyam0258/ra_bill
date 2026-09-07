/**
 * Utility functions for parsing Frappe server errors and making API calls.
 * Extracts clean, human-readable error messages from _server_messages, exception,
 * and responses, while suppressing generic SDK fallbacks like
 * "There was an error while updating the document."
 */

const GENERIC_SDK_FALLBACKS = [
	"There was an error while updating the document.",
	"There was an error while creating the document.",
	"There was an error while fetching the document.",
	"There was an error while fetching the documents.",
	"There was an error while deleting the document.",
	"There was an error while submitting the document.",
	"There was an error while cancelling the document.",
	"There was an error while getting the count.",
	"There was an error while getting the value.",
	"There was an error while setting the value.",
	"There was an error while uploading the file.",
	"There was an error.",
	"Network Error",
];

export function stripHtml(html: string): string {
	if (!html || typeof html !== "string") return "";
	return html
		.replace(/<br\s*[\/]?>/gi, "\n")
		.replace(/<\/p>/gi, "\n")
		.replace(/<\/div>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&mdash;/gi, "—")
		.replace(/&ndash;/gi, "–")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function cleanExceptionString(exc: string): string {
	if (!exc || typeof exc !== "string") return "";
	let cleaned = exc.replace(
		/^[a-zA-Z0-9_.]*(?:ValidationError|MandatoryError|PermissionError|LinkValidationError|DoesNotExistError|DuplicateEntryError|Error|Exception):\s*/i,
		""
	);
	return stripHtml(cleaned);
}

export interface ParsedFrappeError {
	title: string;
	message: string;
	indicator?: "red" | "orange" | "blue" | "green" | string;
}

export function parseFrappeError(err: any, fallbackTitle: string = "Validation Error"): ParsedFrappeError {
	if (!err) {
		return { title: fallbackTitle, message: "An unexpected error occurred. Please try again." };
	}

	const serverMessages = err._server_messages ?? err.response?.data?._server_messages;
	const exception = err.exception ?? err.response?.data?.exception ?? err.exc_type ?? err.response?.data?.exc_type;
	const message = err.message ?? err.response?.data?.message;

	// If err is a string that might be JSON
	if (typeof err === "string") {
		const trimmed = err.trim();
		if (trimmed.startsWith("{") || trimmed.includes('{"') || trimmed.includes("{\\\"")) {
			try {
				const startIdx = trimmed.indexOf("{");
				const parsed = JSON.parse(trimmed.slice(startIdx));
				return parseFrappeError(parsed, fallbackTitle);
			} catch (_) {}
		}
		const cleanedStr = trimmed
			.replace(/^Frappe API Error:\s*/i, "")
			.replace(/^Error:\s*/i, "");
		return {
			title: fallbackTitle,
			message: cleanExceptionString(cleanedStr) || "An unexpected error occurred.",
		};
	}

	// If err.message is a string containing JSON
	if (typeof message === "string" && (message.startsWith("{") || message.includes('{"') || message.includes("{\\\""))) {
		try {
			const startIdx = message.indexOf("{");
			const parsed = JSON.parse(message.slice(startIdx));
			return parseFrappeError(parsed, fallbackTitle);
		} catch (_) {}
	}

	// 1. Check _server_messages first (authoritative Frappe message_log from frappe.throw/msgprint)
	if (serverMessages) {
		let msgsArray: any[] = [];
		if (typeof serverMessages === "string") {
			try {
				msgsArray = JSON.parse(serverMessages);
			} catch (_) {
				msgsArray = [serverMessages];
			}
		} else if (Array.isArray(serverMessages)) {
			msgsArray = serverMessages;
		}

		const extractedMessages: string[] = [];
		let extractedTitle = "";
		let extractedIndicator = "";

		for (const item of msgsArray) {
			if (!item) continue;
			if (typeof item === "string") {
				try {
					const parsedItem = JSON.parse(item);
					if (parsedItem && typeof parsedItem === "object") {
						if (parsedItem.message) extractedMessages.push(stripHtml(parsedItem.message));
						if (parsedItem.title && parsedItem.title !== "Message") extractedTitle = parsedItem.title;
						if (parsedItem.indicator) extractedIndicator = parsedItem.indicator;
					} else {
						extractedMessages.push(stripHtml(item));
					}
				} catch (_) {
					extractedMessages.push(stripHtml(item));
				}
			} else if (typeof item === "object") {
				if (item.message) extractedMessages.push(stripHtml(item.message));
				if (item.title && item.title !== "Message") extractedTitle = item.title;
				if (item.indicator) extractedIndicator = item.indicator;
			}
		}

		if (extractedMessages.length > 0) {
			return {
				title: extractedTitle || fallbackTitle,
				message: extractedMessages.join("\n\n"),
				indicator: extractedIndicator || "red",
			};
		}
	}

	// 2. Check exception
	if (exception && typeof exception === "string") {
		const cleaned = cleanExceptionString(exception);
		if (cleaned) {
			return {
				title: fallbackTitle,
				message: cleaned,
				indicator: "red",
			};
		}
	}

	// 3. Check message (only if NOT a generic SDK fallback)
	if (message && typeof message === "string") {
		const trimmedMsg = message.trim();
		const isGeneric = GENERIC_SDK_FALLBACKS.some(
			(fb) =>
				trimmedMsg.toLowerCase() === fb.toLowerCase() ||
				trimmedMsg.toLowerCase().startsWith("there was an error while")
		);
		if (!isGeneric && trimmedMsg.length > 0) {
			return {
				title: fallbackTitle,
				message: cleanExceptionString(trimmedMsg),
				indicator: "red",
			};
		}
	}

	// 4. Try exc traceback if present
	const exc = err.exc ?? err.response?.data?.exc;
	if (exc && typeof exc === "string") {
		const lines = exc.trim().split("\n");
		const lastLine = lines[lines.length - 1];
		if (lastLine && lastLine.includes(":")) {
			const cleaned = cleanExceptionString(lastLine);
			if (cleaned) {
				return {
					title: fallbackTitle,
					message: cleaned,
					indicator: "red",
				};
			}
		}
	}

	// 5. Final fallback
	const fallbackMsg =
		typeof err.message === "string" && !GENERIC_SDK_FALLBACKS.includes(err.message)
			? cleanExceptionString(err.message)
			: "Validation failed on the server. Please check the entered quantities, deduction rates, or document details.";

	return {
		title: fallbackTitle,
		message: fallbackMsg,
		indicator: "red",
	};
}

export function getFrappeCSRFToken(): string {
	const fromFrappe = (window as any).frappe?.csrf_token;
	if (fromFrappe && fromFrappe !== "Guest") return fromFrappe;
	const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
	if (match) return decodeURIComponent(match[1]);
	return "";
}

export async function callFrappeMethod(method: string, args: Record<string, any>): Promise<any> {
	const csrfToken = getFrappeCSRFToken();
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"Accept": "application/json",
	};
	if (csrfToken) {
		headers["X-Frappe-CSRF-Token"] = csrfToken;
	}

	const res = await fetch(`/api/method/${method}`, {
		method: "POST",
		headers,
		body: JSON.stringify(args),
		credentials: "same-origin",
	});

	const text = await res.text();
	let json: any = null;
	try {
		json = JSON.parse(text);
	} catch (_) {
		json = null;
	}

	if (!res.ok) {
		const parsedErr = parseFrappeError(json || text, `Method ${method} Failed`);
		const error: any = new Error(parsedErr.message);
		if (json && typeof json === "object") {
			Object.assign(error, json);
		}
		error.parsedTitle = parsedErr.title;
		error.parsedIndicator = parsedErr.indicator;
		throw error;
	}

	if (json?._error_message || json?.exc) {
		const parsedErr = parseFrappeError(json, `Method ${method} Failed`);
		const error: any = new Error(parsedErr.message);
		Object.assign(error, json);
		error.parsedTitle = parsedErr.title;
		error.parsedIndicator = parsedErr.indicator;
		throw error;
	}

	return json?.message ?? json;
}
