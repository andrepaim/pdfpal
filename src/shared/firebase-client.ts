// Public identifiers only. API keys are loaded from Firebase Hosting at runtime.
export const firebaseClient = {
  projectId: "pdfpal-cloud-20261104",
  appId: "1:834297766058:web:3968a4200a873ffa2230d3",
  authDomain: "pdfpal-cloud-20261104.firebaseapp.com",
  messagingSenderId: "834297766058",
} as const;

export interface FirebaseClientConfiguration {
  projectId: string;
  apiKey: string;
  appId: string;
  authDomain: string;
  messagingSenderId?: string;
}

export async function loadFirebaseClient(
  projectId: string = firebaseClient.projectId,
): Promise<FirebaseClientConfiguration> {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId))
    throw Error("Invalid Firebase project");
  try {
    const response = await fetch(
      `https://${projectId}.web.app/__/firebase/init.json`,
      {
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw Error("Configuration unavailable");
    const value = await response.json();
    if (
      value.projectId !== projectId ||
      typeof value.apiKey !== "string" || !value.apiKey ||
      typeof value.appId !== "string" || !value.appId ||
      typeof value.authDomain !== "string" || !value.authDomain
    ) throw Error("Invalid configuration");
    return {
      projectId, apiKey: value.apiKey, appId: value.appId,
      authDomain: value.authDomain,
      ...(typeof value.messagingSenderId === "string" ? { messagingSenderId: value.messagingSenderId } : {}),
    };
  } catch {
    throw Error("Firebase sign-in configuration is unavailable; check your connection and retry");
  }
}
