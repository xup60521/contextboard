import { describe, expect, test } from "bun:test";
import {
	DEVICE_CODE_PREFIX,
	USER_CODE_ALPHABET,
	USER_CODE_LENGTH,
	deviceTokenName,
	formatUserCode,
	generateDeviceCode,
	generateUserCode,
	hashDeviceCode,
	normalizeUserCode,
} from "./device-codes";

describe("device-code helpers", () => {
	test("generate a high-entropy device code and a valid user code", () => {
		const deviceCode = generateDeviceCode();
		const userCode = generateUserCode();

		expect(deviceCode).toStartWith(DEVICE_CODE_PREFIX);
		expect(deviceCode.length).toBeGreaterThan(DEVICE_CODE_PREFIX.length + 40);
		expect(hashDeviceCode(deviceCode)).toMatch(/^[0-9a-f]{64}$/);
		expect(userCode).toHaveLength(USER_CODE_LENGTH);
		expect([...userCode].every((character) => USER_CODE_ALPHABET.includes(character))).toBe(
			true,
		);
	});

	test("the user-code alphabet contains no ambiguous digits or vowels", () => {
		expect(USER_CODE_ALPHABET).not.toMatch(/[0-9AEIOUaeiou]/);
	});

	test("normalizes common formatted forms and formats codes for people", () => {
		expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDFGHJK");
		expect(normalizeUserCode("BCDF GHJK")).toBe("BCDFGHJK");
		expect(normalizeUserCode("bcdfghjk")).toBe("BCDFGHJK");
	expect(formatUserCode("bcdfghjk")).toBe("BCDF-GHJK");
	});

	test("rejects invalid user-code characters and lengths", () => {
		expect(() => normalizeUserCode("BCDF-GHJI")).toThrow("Invalid user code");
		expect(() => normalizeUserCode("BCDF-GHJK-QRST")).toThrow("Invalid user code");
		expect(() => normalizeUserCode("BCDF-GH7K")).toThrow("Invalid user code");
		expect(() => normalizeUserCode("BCDF-GHJK1")).toThrow("Invalid user code");
	});

	test("composes a bounded name accepted by agent-token parsing", () => {
		const name = deviceTokenName(
			"contextboard-cli",
			"a-device-name-that-is-long-enough-to-require-truncation-0123456789",
		);
		expect(name).toHaveLength(64);
		expect(name).toStartWith("contextboard-cli (");
	});
});
