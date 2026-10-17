/* ct-password-reset.js — "Forgot password" for every public page (2026-10-17)
 *
 * Calls our own sendPasswordReset Cloud Function (super-fortnight
 * functions/passwordReset.js) instead of Firebase's sendPasswordResetEmail().
 * The Firebase reset template is locked on this project and still carries the
 * old Cricket Times name, reply-to and cricketimes.com link; the function sends
 * a Grass Bank email through Resend whose link opens
 * thegrassbank.com/login.html?mode=resetPassword&oobCode=…, which login.html
 * already handles.
 *
 * Usage:  await window.ctSendPasswordReset(email)
 *   Resolves for any well-formed address — including one with no account,
 *   so the page can't reveal who has one. Rejects with err.code:
 *     'reset/invalid-argument'  malformed address
 *     'reset/unavailable'       the email couldn't be sent; try again later
 *     'reset/network'           the function couldn't be reached
 *   err.message is reader-ready text.
 *
 * Plain fetch using the callable protocol, so pages need no Functions SDK.
 * The admin pages (super-fortnight admin-pages/) carry an inline copy.
 */
(function () {
  'use strict';
  var ENDPOINT = 'https://us-central1-hitwicket-cba02.cloudfunctions.net/sendPasswordReset';

  window.ctSendPasswordReset = async function (email) {
    var res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { email: String(email || '').trim() } })
      });
    } catch (e) {
      var netErr = new Error("Couldn't reach the server. Check your connection and try again.");
      netErr.code = 'reset/network';
      throw netErr;
    }
    var body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok || (body && body.error)) {
      var e = (body && body.error) || {};
      var err = new Error(e.message || "We couldn't send the email just now. Please try again in a few minutes.");
      err.code = 'reset/' + String(e.status || 'unavailable').toLowerCase().replace(/_/g, '-');
      throw err;
    }
    return body && body.result;
  };
})();
