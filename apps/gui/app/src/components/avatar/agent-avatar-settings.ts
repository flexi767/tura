import type { AgentAvatarConfig } from "@tura/gateway-sdk";

export type AvatarRenderSettings = AgentAvatarConfig;
export type AvatarDisplayMode = NonNullable<AgentAvatarConfig["display_mode"]>;
export const AVATAR_WORKSPACE_CONFIG_KEY = "agent_avatar";

export const DEFAULT_AVATAR_SETTINGS: AvatarRenderSettings = {
  role: "tura",
  display_mode: "hidden",
  pixel_size: 20,
  threshold: 160,
};

export const AVATAR_SETTING_LIMITS = {
  pixelSize: { min: 10, max: 30 },
  threshold: { min: 100, max: 200 },
};

export function normalizeAvatarSettings(
  value?: Partial<AvatarRenderSettings> | null,
): AvatarRenderSettings {
  return {
    role: value?.role || DEFAULT_AVATAR_SETTINGS.role,
    persona_id: value?.persona_id,
    display_mode: normalizeAvatarDisplayMode(value?.display_mode),
    pixel_size: clamp(
      Number(value?.pixel_size ?? DEFAULT_AVATAR_SETTINGS.pixel_size),
      AVATAR_SETTING_LIMITS.pixelSize.min,
      AVATAR_SETTING_LIMITS.pixelSize.max,
    ),
    threshold: clamp(
      Number(value?.threshold ?? DEFAULT_AVATAR_SETTINGS.threshold),
      AVATAR_SETTING_LIMITS.threshold.min,
      AVATAR_SETTING_LIMITS.threshold.max,
    ),
  };
}

export function normalizeAvatarDisplayMode(value: unknown): AvatarDisplayMode {
  return value === "static" || value === "dynamic" ? value : "hidden";
}

export function avatarSettingsFromConfigValue(value: unknown): AvatarRenderSettings {
  if (!value) {
    return normalizeAvatarSettings({
      ...DEFAULT_AVATAR_SETTINGS,
      persona_id: DEFAULT_AVATAR_SETTINGS.role,
    });
  }
  if (typeof value === "string") {
    try {
      return avatarSettingsFromConfigValue(JSON.parse(value));
    } catch {
      return normalizeAvatarSettings({
        ...DEFAULT_AVATAR_SETTINGS,
        persona_id: DEFAULT_AVATAR_SETTINGS.role,
      });
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return normalizeAvatarSettings({
      ...DEFAULT_AVATAR_SETTINGS,
      persona_id: DEFAULT_AVATAR_SETTINGS.role,
    });
  }
  const settings = normalizeAvatarSettings(value as Partial<AvatarRenderSettings>);
  return {
    ...settings,
    persona_id: settings.persona_id ?? settings.role,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
