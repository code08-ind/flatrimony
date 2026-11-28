// Maestro (GraalJS): approve the mock DigiLocker consent page the app just opened. The emulator's
// browser cannot reach the API on the host (localhost there is the emulator), so the host does what
// a tester would: find the newest waiting consent page (a local-only, loopback-only dev route) and
// post "Allow" with an identity whose first name matches the profile (FR-VER-03).
// The app may still be starting the session: ask again for up to about 15 s.
let latest = null;
const until = Date.now() + 15000;
do {
  latest = http.post(API_URL + '/dev/digilocker-latest', {
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
} while (latest.status === 404 && Date.now() < until);
if (latest.status !== 200)
  throw new Error('No DigiLocker session is waiting (status ' + latest.status + ')');
const consentPath = json(latest.body).consentPath;
const id = 'DL-maestro-' + Math.random().toString(36).slice(2, 12);
const form =
  'action=approve&name=' +
  encodeURIComponent(NAME) +
  '&dateOfBirth=1998-08-15&gender=female' +
  '&digilockerId=' +
  id;
const res = http.post(API_URL + consentPath, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: form,
});
if (res.status !== 200)
  throw new Error('The consent page refused the approval (status ' + res.status + ')');
