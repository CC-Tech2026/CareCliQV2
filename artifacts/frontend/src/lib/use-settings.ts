import { useEffect, useRef, useState } from "react";
import { useGetPractitionerSettings } from "@workspace/api-client-react";

const SETTINGS_CACHE_KEY = "practitioner_settings_v1";

export interface ProviderInfo {
  businessName?: string | null;
  abn?: string | null;
}

export interface SessionDefaults {
  defaultDuration?: number | null;
  autoStartTimer?: boolean | null;
  enableVoice?: boolean | null;
}

export interface ComplianceSettings {
  requireActivity?: boolean | null;
  requireNotes?: boolean | null;
  requireDuration?: boolean | null;
  physicalExamSessionTypes?: string[] | null;
}

export interface PractitionerSettingsFull {
  name?: string | null;
  credentials?: string | null;
  signature?: string | null;
  avatarId?: string | null;
  provider?: ProviderInfo | null;
  sessionDefaults?: SessionDefaults | null;
  compliance?: ComplianceSettings | null;
}

function loadCached(): PractitionerSettingsFull | null {
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PractitionerSettingsFull;
  } catch {
    return null;
  }
}

function saveCache(settings: PractitionerSettingsFull): void {
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function useSettings(): {
  settings: PractitionerSettingsFull | null;
  isLoading: boolean;
} {
  const cached = useRef<PractitionerSettingsFull | null>(loadCached());
  const [settings, setSettings] = useState<PractitionerSettingsFull | null>(
    cached.current
  );

  const { data: serverSettings, isLoading } = useGetPractitionerSettings();

  useEffect(() => {
    if (isLoading || !serverSettings) return;
    const full: PractitionerSettingsFull = {
      name: serverSettings.name ?? null,
      credentials: serverSettings.credentials ?? null,
      signature: serverSettings.signature ?? null,
      avatarId: serverSettings.avatarId ?? null,
      provider: (serverSettings.provider as ProviderInfo | null) ?? null,
      sessionDefaults: (serverSettings.sessionDefaults as SessionDefaults | null) ?? null,
      compliance: (serverSettings.compliance as ComplianceSettings | null) ?? null,
    };
    setSettings(full);
    saveCache(full);
  }, [serverSettings, isLoading]);

  return { settings, isLoading: isLoading && !cached.current };
}
