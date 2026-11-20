// Maestro (GraalJS): a fresh Indian mobile number for this run, digit by digit for the keypad.
// The digits are exported one by one because flow steps cannot loop over a string.
const national = '98' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
output.phone = '+91' + national;
for (let i = 0; i < national.length; i++) output['p' + i] = national[i];
