import { message, t } from "../lib/i18n";
import { useEffect, useRef } from "react";

export function UnsavedChangesDialog({ busy, error, onSave, onDiscard, onStay }: {
  busy: boolean; error: string; onSave: () => void; onDiscard: () => void; onStay: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { previous?.focus(); };
  }, []);
  return (
    <dialog ref={dialog} className="unsaved-dialog" aria-labelledby="unsaved-title" aria-describedby="unsaved-description"
      onCancel={(event) => { event.preventDefault(); if (!busy) onStay(); }}>
      <h2 id="unsaved-title">{t("Enregistrer vos corrections ?")}</h2>
      <p id="unsaved-description">{t("Cette action remplace la transcription affichée. Enregistrez vos corrections dans les fichiers complets pour les conserver.")}</p>
      {error && <p className="notice error" role="alert">{message(error)}</p>}
      <div className="action-row">
        <button type="button" autoFocus disabled={busy} onClick={onStay}>{t("Rester")}</button>
        <button type="button" disabled={busy} onClick={onDiscard}>{t("Abandonner les corrections")}</button>
        <button className="primary" type="button" disabled={busy} onClick={onSave}>{busy ? t("Enregistrement…") : t("Enregistrer et continuer")}</button>
      </div>
    </dialog>
  );
}
