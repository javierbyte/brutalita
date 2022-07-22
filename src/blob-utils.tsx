let pendingCallback: false | ((file: string[]) => void) = false;

const inputFileElement = document.createElement('input');
inputFileElement.setAttribute('type', 'file');
inputFileElement.setAttribute('multiple', 'false');
inputFileElement.setAttribute('accept', '.json');

inputFileElement.addEventListener(
  'change',
  async (event: Event) => {
    const { files } = event.target as HTMLInputElement;
    if (!files) {
      return;
    }

    const filePromises = [...files].map((file) => file.text());

    if (pendingCallback) {
      pendingCallback(await Promise.all(filePromises));
    }
  },
  false
);

export function uploadBlob() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      pendingCallback = resolve;
      inputFileElement.click();
    });
  });
}

export function downloadBlob(name = 'file.txt', data: string) {
  const blob = new Blob([data]);
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
}
