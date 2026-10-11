(() => {
  const form = document.getElementById('world-hunt-form');
  const status = document.getElementById('hunt-status');
  if (!form || !status) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const values = new FormData(form);
    const lines = [
      `Search: ${values.get('huntType')}`,
      `Edition/version: ${values.get('version') || 'Not sure'}`,
      '',
      'What I am hoping to find:',
      values.get('details'),
    ];
    if (values.get('reference')) lines.push('', `Reference: ${values.get('reference')}`);

    const subject = encodeURIComponent('A world hunt for the Seed Shed');
    const body = encodeURIComponent(lines.join('\n'));
    status.textContent = 'Your email draft is ready. Check it, then send it from your mail app.';
    window.location.href = `mailto:admin@rabbet.lol?subject=${subject}&body=${body}`;
  });
})();
