import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LicenseCheck, LicenseSnapshot } from "../types";

export function useLicense() {
  const [license, setLicense] = useState<LicenseSnapshot | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState("");

  const licenseOk = useMemo(() => Boolean(license?.cached_valid), [license]);

  const hydrateLicense = useCallback((snapshot: LicenseSnapshot) => {
    setLicense(snapshot);
    setLicenseKey(String(snapshot.state.license_key ?? ""));
    setLicenseMessage(snapshot.status_text);
  }, []);

  const applyLicenseCheck = useCallback((result: LicenseCheck) => {
    setLicense({
      state: result.state,
      status_text: result.message,
      cached_valid: result.ok,
    });
    setLicenseMessage(result.message);
    setLicenseKey((current) => String(result.state.license_key ?? current));
  }, []);

  const activateLicense = useCallback(async () => {
    setLicenseBusy(true);
    try {
      const result = await invoke<LicenseCheck>("activate_license", { licenseKey });
      applyLicenseCheck(result);
      return result;
    } finally {
      setLicenseBusy(false);
    }
  }, [applyLicenseCheck, licenseKey]);

  const validateLicenseOnline = useCallback(async () => {
    setLicenseBusy(true);
    try {
      const result = await invoke<LicenseCheck>("validate_license", { forceOnline: true });
      applyLicenseCheck(result);
      return result;
    } finally {
      setLicenseBusy(false);
    }
  }, [applyLicenseCheck]);

  return {
    license,
    licenseKey,
    setLicenseKey,
    licenseBusy,
    licenseMessage,
    licenseOk,
    hydrateLicense,
    applyLicenseCheck,
    activateLicense,
    validateLicenseOnline,
  };
}
