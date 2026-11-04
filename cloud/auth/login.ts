import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  setPersistence,
  inMemoryPersistence,
  signOut,
  type Auth,
} from "firebase/auth";
import { loadFirebaseClient } from "../../src/shared/firebase-client";
const button = document.querySelector<HTMLButtonElement>("#login")!,
  status = document.querySelector<HTMLElement>("#status")!;
const params = new URLSearchParams(location.hash.slice(1)),
  state = params.get("state") ?? "",
  port = params.get("port") ?? "";
history.replaceState(null, "", location.pathname);
if (
  !/^[a-zA-Z0-9_-]{43}$/.test(state) ||
  !/^\d{1,5}$/.test(port) ||
  Number(port) < 1 ||
  Number(port) > 65535
) {
  status.textContent =
    "Open Google sign-in from the pdfpal desktop app to continue.";
} else {
  let auth: Auth | undefined;
  void loadFirebaseClient()
    .then(config => {
      auth = getAuth(initializeApp(config));
      return setPersistence(auth, inMemoryPersistence);
    })
    .then(() => {
      button.disabled = false;
      status.textContent =
        "Your account credentials return only to pdfpal on this computer.";
    })
    .catch(() => {
      status.textContent =
        "Your browser could not start sign-in. Try again in a regular browser window.";
    });
  button.addEventListener("click", async () => {
    if (!auth) return;
    button.disabled = true;
    status.textContent = "Choose your Google account in the sign-in window.";
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken(),
        refreshToken = result.user.refreshToken;
      const form = document.createElement("form");
      form.method = "POST";
      form.action = `http://127.0.0.1:${port}/api/cloud/auth/browser`;
      for (const [name, value] of Object.entries({
        state,
        idToken,
        refreshToken,
      })) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
      }
      await signOut(auth);
      document.body.append(form);
      status.textContent = "Returning to pdfpal…";
      form.submit();
    } catch (error) {
      button.disabled = false;
      const code = (error as { code?: string }).code;
      status.textContent =
        code === "auth/popup-closed-by-user"
          ? "Sign-in was cancelled. Try again when ready."
          : code === "auth/popup-blocked"
            ? "Allow the sign-in popup, then try again."
            : "Google sign-in could not finish. Please try again.";
    }
  });
}
