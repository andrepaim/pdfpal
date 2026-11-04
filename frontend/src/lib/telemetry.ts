import { initializeApp } from "firebase/app";
import {
  initializeAnalytics,
  isSupported as analyticsSupported,
  logEvent,
  setAnalyticsCollectionEnabled,
  setConsent,
  type Analytics,
} from "firebase/analytics";
import {
  getPerformance,
  trace,
  type FirebasePerformance,
  type PerformanceTrace,
} from "firebase/performance";
let analytics: Analytics | undefined, perf: FirebasePerformance | undefined;
let diagnostics = false,
  usage = false,
  epoch = 0;
const active = new Map<string, PerformanceTrace>();
export async function configureTelemetry(consent: {
  diagnostics: boolean;
  usage: boolean;
}) {
  const generation = ++epoch;
  diagnostics = consent.diagnostics;
  usage = consent.usage;
  if (analytics) setAnalyticsCollectionEnabled(analytics, usage);
  if (perf) perf.dataCollectionEnabled = diagnostics;
  if (!diagnostics) {
    for (const item of active.values()) item.stop();
    active.clear();
  }
  if (!usage && analytics)
    setConsent({
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  if (!diagnostics && !usage) return;
  const res = await fetch("/api/telemetry/config");
  if (!res.ok) return;
  const config = await res.json();
  if (!config.appId || generation !== epoch) return;
  const app = initializeApp(config, "pdfpal-telemetry");
  if (
    usage &&
    config.measurementId &&
    (await analyticsSupported()) &&
    generation === epoch
  ) {
    setConsent({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    analytics ??= initializeAnalytics(app, {
      config: {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        page_location: location.origin,
        page_referrer: "",
        page_title: "pdfpal",
      },
    });
    setAnalyticsCollectionEnabled(analytics, true);
  }
  if (diagnostics && typeof indexedDB !== "undefined" && generation === epoch) {
    perf ??= getPerformance(app);
    perf.instrumentationEnabled = false;
    perf.dataCollectionEnabled = true;
  }
}
export function beginOperation(name: "search" | "pdf_import" | "sync_batch") {
  const id = crypto.randomUUID();
  try {
    if (diagnostics && perf) {
      const item = trace(perf, name);
      item.start();
      active.set(id, item);
    }
  } catch {}
  return (outcome: "completed" | "failed") => {
    try {
      const item = active.get(id);
      active.delete(id);
      if (item && diagnostics) {
        item.putAttribute("outcome", outcome);
        item.stop();
      }
      if (usage && analytics)
        logEvent(analytics, name === "search" ? "library_search" : name, {
          outcome,
        });
    } catch {}
  };
}
