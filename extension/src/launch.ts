// Capture pdfpal's project hint before the reader replaces its URL.
function captureLaunch() {
  const launch = new URL(location.href);
  const parameters = new URLSearchParams(launch.hash.slice(1));
  const projectId = parameters.get('pdfpal_project'), base = parameters.get('pdfpal_server');
  if (projectId && base) {
    void chrome.runtime.sendMessage({ type: 'book-launch', projectId, base }).catch(() => {});
    parameters.delete('pdfpal_project'); parameters.delete('pdfpal_server');
    launch.hash = parameters.toString();
    history.replaceState(history.state, '', launch.href);
  }
}
captureLaunch();
addEventListener('hashchange', captureLaunch);
