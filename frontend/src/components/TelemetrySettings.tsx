import { useEffect, useState } from "react";
import { configureTelemetry } from "../lib/telemetry";
export default function TelemetrySettings() {
  const [consent, setConsent] = useState({ diagnostics: false, usage: false }),
    [open, setOpen] = useState(false),
    [saving, setSaving] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/telemetry/consent")
      .then((r) => r.json())
      .then((c) => {
        setConsent(c);
        return configureTelemetry(c);
      })
      .catch(() => {})
      .finally(() => setSaving(false));
  }, []);
  async function update(next: typeof consent) {
    const previous = consent;
    setConsent(next);
    setSaving(true);
    try {
      const res = await fetch("/api/telemetry/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw Error();
      setConsent(next);
      await configureTelemetry(next).catch(() => {});
      setError("");
    } catch {
      setConsent(previous);
      setError("Could not update diagnostic settings");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="privacy-control">
      <button className="privacy-launcher" onClick={() => setOpen(!open)}>Privacy</button>
      {open && (
        <section
          aria-label="Privacy settings"
          style={{
            position: "fixed", bottom: 56, left: 12, zIndex: 991,
            padding: 16,
            background: "var(--panel,#171717)",
            color: "#eee",
            width: "min(310px, calc(100vw - 24px))",
            border: "1px solid #555",
          }}
        >
          <p>
            Optional diagnostics and usage measurements exclude your document
            contents.
          </p>
          <label>
            <input
              type="checkbox"
              disabled={saving}
              checked={consent.diagnostics}
              onChange={(e) =>
                void update({ ...consent, diagnostics: e.target.checked })
              }
            />{" "}
            Diagnostic reporting
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              disabled={saving}
              checked={consent.usage}
              onChange={(e) =>
                void update({ ...consent, usage: e.target.checked })
              }
            />{" "}
            Usage analytics
          </label>
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
