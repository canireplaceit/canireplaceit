/**
 * The submit form mails the maintainer free text from strangers: none of it may
 * render as markup or add a header, and a reply must go to the sender.
 *
 *   bun test apps/backend/tests/suggest-mail.test.ts
 */

import { expect, test } from "bun:test";
import { suggestionMail } from "../src/mail";

test("sender text is escaped and replies go to the sender", () => {
	const m = suggestionMail({
		email: "someone@example.com",
		title: "AppFlowy\r\nBcc: victim@example.com",
		replaces: "<img src=x onerror=alert(1)>",
		description: "works well",
		link: 'https://example.com/"><script>',
	});
	expect(m.replyTo).toBe("someone@example.com");
	expect(m.subject).not.toMatch(/[\r\n]/);
	expect(m.html).not.toContain("<img");
	expect(m.html).not.toContain('"><script');
});
