import { message, t } from "../lib/i18n";
import { Check, FileAudio, RefreshCw, ShieldCheck, FileCheck2, Loader2 } from "lucide-react";
import { SectionTitle } from "../components/ui";
import { formatDate } from "../lib/format";
import type { LicenseSnapshot } from "../types";

interface LicenseScreenProps {
  license: LicenseSnapshot | null;
  licenseKey: string;
  licenseBusy: boolean;
  licenseMessage: string;
  licenseOk: boolean;
  onLicenseKeyChange: (value: string) => void;
  onActivate: () => void;
  onValidateOnline: () => void;
  onContinue: () => void;
}

export function LicenseScreen({
  license,
  licenseKey,
  licenseBusy,
  licenseMessage,
  licenseOk,
  onLicenseKeyChange,
  onActivate,
  onValidateOnline,
  onContinue,
}: LicenseScreenProps) {
  if (license?.state.development_mode === true) return (
    <section className="screen license-screen license-development"><div className="primary-panel">
      <div className="license-symbol"><ShieldCheck size={34} strokeWidth={1.5} /></div>
      <SectionTitle icon={<ShieldCheck size={20} />} title={t("Mode développement")} />
      <p className="muted">{t("La vérification de licence est désactivée pour cette session de développement. Aucune licence n’est enregistrée.")}</p>
      <p className="muted">{t("Les builds de production nécessitent une licence active.")}</p>
      <button className="primary" type="button" onClick={onContinue}><FileAudio size={17} />{t("Continuer")}</button>
    </div></section>
  );
  return (
    <section className={licenseOk ? "screen two-column license-screen license-compact" : "screen two-column license-screen"}>
      <div className="primary-panel">
        <div className="license-symbol"><ShieldCheck size={34} strokeWidth={1.5} /></div>
        <SectionTitle icon={<ShieldCheck size={20} />} title={t("Licence IA Swiss")} />
        <p className="muted">{licenseOk ? t("Licence active.") : message(license?.status_text) || t("Validation de la licence au lancement...")}</p>
        {!licenseOk && (
          <>
            <label className="field">
              <span>{t("Clé de licence")}</span>
              <input
                value={licenseKey}
                placeholder="MW-XXXXX-XXXXX-XXXXX-XXXXX"
                onChange={(event) => onLicenseKeyChange(event.target.value)}
              />
            </label>
            <div className="action-row">
              <button className="primary" type="button" disabled={licenseBusy || !licenseKey.trim()} onClick={onActivate}>
                {licenseBusy ? <Loader2 className="spin" size={17} /> : <Check size={17} />}
                {t("Activer")}
              </button>
              <button type="button" disabled={licenseBusy || !license?.state?.license_key} onClick={onValidateOnline}>
                <RefreshCw size={17} />
                {t("Vérifier")}
              </button>
            </div>
          </>
        )}
        {licenseOk && (
          <div className="action-row">
            <button type="button" disabled={licenseBusy || !license?.state?.license_key} onClick={onValidateOnline}>
              {licenseBusy ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
              {t("Revérifier")}
            </button>
            <button className="primary" type="button" onClick={onContinue}>
              <FileAudio size={17} />
              {t("Continuer")}
            </button>
          </div>
        )}
        {licenseMessage && <p className="inline-status">{message(licenseMessage)}</p>}
      </div>
      <div className="secondary-panel">
        <SectionTitle icon={<FileCheck2 size={20} />} title={t("Votre licence")} />
        <dl className="details">
          <div>
            <dt>{t("Abonnement")}</dt>
            <dd>{message(String(license?.state?.subscription_status ?? "non vérifié"))}</dd>
          </div>
          <div>
            <dt>{t("Validité locale")}</dt>
            <dd>{formatDate(license?.state?.valid_until)}</dd>
          </div>
          <div>
            <dt>{t("État local")}</dt>
            <dd>{licenseOk ? t("valide") : t("à vérifier")}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
