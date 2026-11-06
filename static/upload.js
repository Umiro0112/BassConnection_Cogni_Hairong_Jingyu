const form = document.querySelector('#upload-form');
const input = document.querySelector('#photo');
const preview = document.querySelector('#preview');
const message = document.querySelector('#message');
const submit = document.querySelector('#submit');

input.addEventListener('change', () => {
  const file = input.files[0];
  if (!file) return;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  message.textContent = '';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!input.files[0]) return;
  submit.disabled = true;
  submit.textContent = 'Processing…';
  message.textContent = 'Finding the postcard edges.';
  const body = new FormData();
  body.append('photo', input.files[0]);
  try {
    const response = await fetch(document.body.dataset.uploadUrl, { method: 'POST', body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed.');
    message.textContent = `Added to the tree. ${result.detail}`;
    form.reset();
    preview.hidden = true;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Upload postcard';
  }
});
