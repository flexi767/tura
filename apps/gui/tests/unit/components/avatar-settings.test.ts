import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AVATAR_SETTINGS,
  avatarSettingsFromConfigValue,
  normalizeAvatarDisplayMode,
} from "../../../app/src/components/avatar/agent-avatar-settings";

describe("avatar display settings", () => {
  test("defaults to hidden when no workspace preference exists", () => {
    expect(DEFAULT_AVATAR_SETTINGS.display_mode).toBe("hidden");
    expect(avatarSettingsFromConfigValue(undefined).display_mode).toBe("hidden");
    expect(normalizeAvatarDisplayMode(undefined)).toBe("hidden");
  });

  test("retains explicit show modes", () => {
    expect(normalizeAvatarDisplayMode("static")).toBe("static");
    expect(normalizeAvatarDisplayMode("dynamic")).toBe("dynamic");
  });
});
