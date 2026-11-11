let pendingCallback: false | ((file: string[]) => void) = false;

const inputFileElement = document.createElement('input');
inputFileElement.setAttribute('type', 'file');
inputFileElement.setAttribute('accept', '.json,application/json');

function settle(files: string[]) {
  const callback = pendingCallback;
  pendingCallback = false;
  if (callback) callback(files);
}

inputFileElement.addEventListener('change', async () => {
  const { files } = inputFileElement;
  settle(files ? await Promise.all([...files].map((file) => file.text())) : []);
});

// Dismissing the picker settles the promise too, with no files, rather than
// leaving every cancelled import waiting forever.
inputFileElement.addEventListener('cancel', () => settle([]));

/** Ask for a file and resolve with its text; empty when the picker is cancelled. */
export function uploadBlob(): Promise<string[]> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      // A picker that was abandoned without a cancel event (older Safari).
      settle([]);
      pendingCallback = resolve;
      // "change" only fires when the selection changes, so without this,
      // choosing the same file twice in a row did nothing the second time.
      inputFileElement.value = '';
      inputFileElement.click();
    });
  });
}

export function downloadBlob(
  name = 'file.txt',
  data: BlobPart,
  type = 'application/octet-stream'
) {
  const blob = new Blob([data], { type });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = name;
  document.body.appendChild(link);
  link.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    })
  );
  document.body.removeChild(link);
  // Not synchronously: the click only queues the download, and a URL revoked
  // before the browser reads it saves an empty file in Safari.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}
