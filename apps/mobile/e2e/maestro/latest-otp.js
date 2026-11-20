// Maestro (GraalJS): the code the mock SMS provider "sent" to output.phone, from the API's dev
// outbox (local only; never available in production). Maestro runs this on the host, not in the
// emulator, so the API is at localhost.
const res = http.post(API_URL + '/dev/sms-outbox/latest', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: output.phone }),
});
const otp = json(res.body).otp;
if (!/^\d{6}$/.test(otp || ''))
  throw new Error('No OTP in the dev outbox (status ' + res.status + ')');
for (let i = 0; i < 6; i++) output['o' + i] = otp[i];
