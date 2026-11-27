// Asks before a command that cannot be taken back (end the match, start values back).
// A native <dialog>: it traps focus, closes with Escape and gives the focus back.

export function confirmAction(options: { title: string; text: string; confirm: string }): Promise<boolean> {
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm';
  const title = document.createElement('h2');
  title.textContent = options.title;
  const text = document.createElement('p');
  text.textContent = options.text;
  const actions = document.createElement('form');
  actions.method = 'dialog';
  actions.className = 'confirm-actions';
  const cancel = document.createElement('button');
  cancel.value = 'cancel';
  cancel.textContent = 'Vazgeç';
  const ok = document.createElement('button');
  ok.value = 'ok';
  ok.className = 'danger';
  ok.textContent = options.confirm;
  actions.append(cancel, ok);
  dialog.append(title, text, actions);
  dialog.setAttribute('aria-labelledby', (title.id = `confirm-${Date.now()}`));
  document.body.append(dialog);
  return new Promise((resolve) => {
    // Answer at once on the button or Escape; the `close` event is only a fallback, because a
    // browser may deliver it late (a hidden tab), and the dialog must not stay in the page.
    let done = false;
    const finish = (answer: boolean) => {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close(answer ? 'ok' : 'cancel');
      dialog.remove();
      resolve(answer);
    };
    actions.addEventListener('submit', (event) => {
      event.preventDefault();
      finish((event.submitter as HTMLButtonElement | null)?.value === 'ok');
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('close', () => finish(dialog.returnValue === 'ok'), { once: true });
    dialog.showModal();
    cancel.focus(); // the safe choice is focused first
  });
}
