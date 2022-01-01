export function uploadBlob() {
  return new Promise((resolve) => {
    const inputFileElement = document.createElement('input');
    inputFileElement.setAttribute('type', 'file');
    inputFileElement.setAttribute('multiple', false);
    inputFileElement.setAttribute('accept', '.json');

    inputFileElement.addEventListener(
      'change',
      async (event) => {
        const { files } = event.target;
        if (!files) {
          return;
        }

        const filePromises = [...files].map((file) => file.text());

        resolve(await Promise.all(filePromises));
      },
      false
    );
    window.requestAnimationFrame(() => {
      inputFileElement.click();
    });
  });
}

export function downloadBlob(name = 'file.txt', data) {
  const blob = new Blob([data]);

  // Convert your blob into a Blob URL (a special url that points to an object in the browser's memory)
  const blobUrl = URL.createObjectURL(blob);

  // Create a link element
  const link = document.createElement('a');

  // Set link's href to point to the Blob URL
  link.href = blobUrl;
  link.download = name;

  // Append link to the body
  document.body.appendChild(link);

  // Dispatch click event on the link
  // This is necessary as link.click() does not work on the latest firefox
  link.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    })
  );

  // Remove link from body
  document.body.removeChild(link);
}
