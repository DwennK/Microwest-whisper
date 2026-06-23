import { Check, FileAudio, RefreshCw, ShieldCheck, Sparkles, Loader2 } from "lucide-react";
import { SectionTitle } from "../components/ui";
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
  return (
    <section className={licenseOk ? "screen two-column license-compact" : "screen two-column"}>
      <div className="primary-panel">
        <SectionTitle icon={<ShieldCheck size={20} />} title="Licence IA Swiss" />
        <p className="muted">{licenseOk ? "Licence active." : license?.status_text ?? "Validation de la licence au lancement..."}</p>
        {!licenseOk && (
          <>
            <label className="field">
              <span>Clé de licence</span>
              <input
                value={licenseKey}
                placeholder="MW-XXXXX-XXXXX-XXXXX-XXXXX"
                onChange={(event) => onLicenseKeyChange(event.target.value)}
              />
            </label>
            <div className="action-row">
              <button className="primary" type="button" disabled={licenseBusy || !licenseKey.trim()} onClick={onActivate}>
                {licenseBusy ? <Loader2 className="spin" size={17} /> : <Check size={17} />}
                Activer
              </button>
              <button type="button" disabled={licenseBusy || !license?.state?.license_key} onClick={onValidateOnline}>
                <RefreshCw size={17} />
                Vérifier
              </button>
            </div>
          </>
        )}
        {licenseOk && (
          <div className="action-row">
            <button type="button" disabled={licenseBusy || !license?.state?.license_key} onClick={onValidateOnline}>
              {licenseBusy ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
              Revérifier
            </button>
            <button className="primary" type="button" onClick={onContinue}>
              <FileAudio size={17} />
              Continuer
            </button>
          </div>
        )}
        {licenseMessage && <p className="inline-status">{licenseMessage}</p>}
      </div>
      <div className="secondary-panel">
        <SectionTitle icon={<Sparkles size={20} />} title="Contrat licence" />
        <dl className="details">
          <div>
            <dt>API</dt>
            <dd>https://iaswiss.com/api/licenses</dd>
          </div>
          <div>
            <dt>Abonnement</dt>
            <dd>{String(license?.state?.subscription_status ?? "non vérifié")}</dd>
          </div>
          <div>
            <dt>Validité locale</dt>
            <dd>{String(license?.state?.valid_until ?? "aucune")}</dd>
          </div>
          <div>
            <dt>Etat local</dt>
            <dd>{licenseOk ? "valide" : "à vérifier"}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
